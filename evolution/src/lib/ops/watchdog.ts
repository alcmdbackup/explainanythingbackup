// Detect stale evolution runs and recover via checkpoint or mark failed.

import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_STALE_THRESHOLD_MINUTES = 10;

function getStaleThresholdMinutes(): number {
  const parsed = parseInt(process.env.EVOLUTION_STALENESS_THRESHOLD_MINUTES ?? '', 10);
  return parsed >= 1 ? parsed : DEFAULT_STALE_THRESHOLD_MINUTES;
}

export interface WatchdogResult {
  staleRunsFound: number;
  markedFailed: string[];
  recoveredViaContinuation: string[];
  abandonedContinuations: string[];
}

export async function runWatchdog(
  supabase: SupabaseClient,
  thresholdMinutes?: number,
): Promise<WatchdogResult> {
  const threshold = thresholdMinutes ?? getStaleThresholdMinutes();

  // Find stale claimed/running runs
  const cutoff = new Date(Date.now() - threshold * 60 * 1000).toISOString();

  const { data: staleRuns, error: fetchError } = await supabase
    .from('evolution_runs')
    .select('id, runner_id, last_heartbeat, current_iteration, phase, continuation_count')
    .in('status', ['claimed', 'running'])
    .lt('last_heartbeat', cutoff);

  if (fetchError) {
    throw new Error(`Watchdog fetch error: ${fetchError.message}`);
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
        .from('evolution_runs')
        .update({
          status: 'continuation_pending',
          runner_id: null,
          continuation_count: (run.continuation_count ?? 0) + 1,
        })
        .eq('id', run.id)
        .in('status', ['running', 'claimed']);

      if (updateError) {
        console.error('Watchdog continuation transition error', { runId: run.id, error: updateError.message });
      } else {
        markedContinuation.push(run.id);
        console.log('Watchdog recovered stale run via checkpoint', { runId: run.id });
      }
    } else {
      const structuredError = JSON.stringify({
        message: `Run abandoned: no heartbeat for ${threshold} minutes (likely runner crash)`,
        source: 'evolution-watchdog',
        lastIteration: run.current_iteration ?? null,
        lastPhase: run.phase ?? null,
        lastHeartbeat: run.last_heartbeat,
        threshold: `${threshold}min`,
        timestamp: new Date().toISOString(),
      });

      const { error: updateError } = await supabase
        .from('evolution_runs')
        .update({
          status: 'failed',
          error_message: structuredError,
          runner_id: null,
        })
        .eq('id', run.id);

      if (updateError) {
        console.error('Watchdog update error for run', { runId: run.id, error: updateError.message });
      } else {
        markedFailed.push(run.id);
      }
    }
  }

  // Find stale continuation_pending runs not resumed within 30 minutes
  const continuationCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: staleContinuations } = await supabase
    .from('evolution_runs')
    .select('id, last_heartbeat')
    .eq('status', 'continuation_pending')
    .lt('last_heartbeat', continuationCutoff);

  const abandonedContinuations: string[] = [];
  for (const run of (staleContinuations ?? [])) {
    const { error: updateError } = await supabase
      .from('evolution_runs')
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

  return {
    staleRunsFound: (staleRuns ?? []).length,
    markedFailed,
    recoveredViaContinuation: markedContinuation,
    abandonedContinuations,
  };
}
