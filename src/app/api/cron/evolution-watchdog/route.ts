// Evolution watchdog cron endpoint — marks stale runs (heartbeat > threshold) as failed.
// Designed to be called by GitHub Actions every 15 minutes or via Vercel cron.
// Threshold configurable via EVOLUTION_STALENESS_THRESHOLD_MINUTES env var (default: 10).

import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';

const DEFAULT_STALE_THRESHOLD_MINUTES = 10;

function getStaleThresholdMinutes(): number {
  const envVal = process.env.EVOLUTION_STALENESS_THRESHOLD_MINUTES;
  if (!envVal) return DEFAULT_STALE_THRESHOLD_MINUTES;
  const parsed = parseInt(envVal, 10);
  if (isNaN(parsed) || parsed < 1) return DEFAULT_STALE_THRESHOLD_MINUTES;
  return parsed;
}

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const thresholdMinutes = getStaleThresholdMinutes();

  try {
    const supabase = await createSupabaseServiceClient();

    // Find stale claimed/running runs
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();

    const { data: staleRuns, error: fetchError } = await supabase
      .from('content_evolution_runs')
      .select('id, runner_id, last_heartbeat, current_iteration, phase, continuation_count')
      .in('status', ['claimed', 'running'])
      .lt('last_heartbeat', cutoff);

    if (fetchError) {
      logger.error('Watchdog fetch error', { error: fetchError.message });
      return NextResponse.json({ error: 'Failed to query stale runs' }, { status: 500 });
    }

    const markedFailed: string[] = [];
    const markedContinuation: string[] = [];

    for (const run of (staleRuns ?? [])) {
      const { data: recentCheckpoint } = await supabase
        .from('evolution_checkpoints')
        .select('created_at')
        .eq('run_id', run.id)
        .gt('created_at', run.last_heartbeat)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentCheckpoint) {
        const { error: updateError } = await supabase
          .from('content_evolution_runs')
          .update({
            status: 'continuation_pending',
            runner_id: null,
            continuation_count: (run.continuation_count ?? 0) + 1,
          })
          .eq('id', run.id)
          .in('status', ['running', 'claimed']);

        if (updateError) {
          logger.error('Watchdog continuation transition error', { runId: run.id, error: updateError.message });
        } else {
          markedContinuation.push(run.id);
          logger.info('Watchdog recovered stale run via checkpoint', { runId: run.id });
        }
      } else {
        const structuredError = JSON.stringify({
          message: `Run abandoned: no heartbeat for ${thresholdMinutes} minutes (likely serverless timeout)`,
          source: 'evolution-watchdog',
          lastIteration: run.current_iteration ?? null,
          lastPhase: run.phase ?? null,
          lastHeartbeat: run.last_heartbeat,
          threshold: `${thresholdMinutes}min`,
          timestamp: new Date().toISOString(),
        });

        const { error: updateError } = await supabase
          .from('content_evolution_runs')
          .update({
            status: 'failed',
            error_message: structuredError,
            runner_id: null,
          })
          .eq('id', run.id);

        if (updateError) {
          logger.error('Watchdog update error for run', { runId: run.id, error: updateError.message });
        } else {
          markedFailed.push(run.id);
        }
      }
    }

    // Find stale continuation_pending runs not resumed within 30 minutes
    const continuationCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data: staleContinuations } = await supabase
      .from('content_evolution_runs')
      .select('id, last_heartbeat')
      .eq('status', 'continuation_pending')
      .lt('last_heartbeat', continuationCutoff);

    const abandonedContinuations: string[] = [];
    for (const run of (staleContinuations ?? [])) {
      const { error: updateError } = await supabase
        .from('content_evolution_runs')
        .update({
          status: 'failed',
          error_message: JSON.stringify({
            message: 'Continuation run abandoned: not resumed within 30 minutes',
            source: 'evolution-watchdog',
            lastHeartbeat: run.last_heartbeat,
            timestamp: new Date().toISOString(),
          }),
        })
        .eq('id', run.id)
        .eq('status', 'continuation_pending'); // guard: only if still continuation_pending

      if (!updateError) {
        abandonedContinuations.push(run.id);
      }
    }

    const totalActions = markedFailed.length + markedContinuation.length + abandonedContinuations.length;

    if (totalActions > 0) {
      logger.warn('Watchdog processed stale runs', {
        markedFailed: markedFailed.length,
        recoveredViaContinuation: markedContinuation.length,
        abandonedContinuations: abandonedContinuations.length,
        thresholdMinutes,
      });
    }

    return NextResponse.json({
      status: 'ok',
      staleRunsFound: (staleRuns ?? []).length,
      markedFailed,
      recoveredViaContinuation: markedContinuation,
      abandonedContinuations,
      thresholdMinutes,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Watchdog unexpected error', { error: String(error) });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
