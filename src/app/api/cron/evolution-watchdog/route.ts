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
  // Verify cron secret — fail closed when not configured
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const thresholdMinutes = getStaleThresholdMinutes();

  try {
    const supabase = await createSupabaseServiceClient();

    // Find and mark stale runs
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();

    const { data: staleRuns, error: fetchError } = await supabase
      .from('content_evolution_runs')
      .select('id, runner_id, last_heartbeat, current_iteration, phase')
      .in('status', ['claimed', 'running'])
      .lt('last_heartbeat', cutoff);

    if (fetchError) {
      logger.error('Watchdog fetch error', { error: fetchError.message });
      return NextResponse.json({ error: 'Failed to query stale runs' }, { status: 500 });
    }

    if (!staleRuns || staleRuns.length === 0) {
      return NextResponse.json({
        status: 'ok',
        staleRunsFound: 0,
        thresholdMinutes,
        timestamp: new Date().toISOString(),
      });
    }

    // Mark each stale run as failed with structured error messages
    for (const run of staleRuns) {
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
      }
    }

    const staleIds = staleRuns.map((r) => r.id);

    logger.warn('Watchdog marked stale runs as failed', {
      count: staleRuns.length,
      runIds: staleIds,
      thresholdMinutes,
    });

    return NextResponse.json({
      status: 'ok',
      staleRunsFound: staleRuns.length,
      markedFailed: staleIds,
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
