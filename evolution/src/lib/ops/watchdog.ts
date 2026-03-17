// Detect stale evolution runs and mark them as failed.
// V2: no checkpoints, no continuation — stale runs are simply failed.

import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_STALE_THRESHOLD_MINUTES = 10;

function getStaleThresholdMinutes(): number {
  const parsed = parseInt(process.env.EVOLUTION_STALENESS_THRESHOLD_MINUTES ?? '', 10);
  return parsed >= 1 ? parsed : DEFAULT_STALE_THRESHOLD_MINUTES;
}

export interface WatchdogResult {
  staleRunsFound: number;
  markedFailed: string[];
}

export async function runWatchdog(
  supabase: SupabaseClient,
  thresholdMinutes?: number,
): Promise<WatchdogResult> {
  const threshold = thresholdMinutes ?? getStaleThresholdMinutes();
  const cutoff = new Date(Date.now() - threshold * 60 * 1000).toISOString();

  const { data: staleRuns, error: fetchError } = await supabase
    .from('evolution_runs')
    .select('id, runner_id, last_heartbeat')
    .in('status', ['claimed', 'running'])
    .lt('last_heartbeat', cutoff);

  if (fetchError) {
    throw new Error(`Watchdog fetch error: ${fetchError.message}`);
  }

  const markedFailed: string[] = [];

  for (const run of (staleRuns ?? [])) {
    const errorMessage = JSON.stringify({
      message: `Run abandoned: no heartbeat for ${threshold} minutes (likely runner crash)`,
      source: 'evolution-watchdog',
      lastHeartbeat: run.last_heartbeat,
      threshold: `${threshold}min`,
      timestamp: new Date().toISOString(),
    });

    const { error: updateError } = await supabase
      .from('evolution_runs')
      .update({
        status: 'failed',
        error_message: errorMessage,
        runner_id: null,
      })
      .eq('id', run.id)
      .in('status', ['claimed', 'running']);

    if (updateError) {
      console.error('Watchdog update error', { runId: run.id, error: updateError.message });
    } else {
      markedFailed.push(run.id);
    }
  }

  return {
    staleRunsFound: (staleRuns ?? []).length,
    markedFailed,
  };
}
