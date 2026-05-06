// Detect stale evolution runs and mark them as failed; clean up orphaned reservations.
// V2: no checkpoints, no continuation — stale runs are simply failed.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSpendingGate } from '@/lib/services/llmSpendingGate';

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

  // Fetch runs with stale heartbeat OR null heartbeat (old claim function didn't set it)
  const { data: staleRuns, error: fetchError } = await supabase
    .from('evolution_runs')
    .select('id, runner_id, last_heartbeat, created_at')
    .in('status', ['claimed', 'running'])
    .or(`last_heartbeat.lt.${cutoff},and(last_heartbeat.is.null,created_at.lt.${cutoff})`);

  if (fetchError) {
    throw new Error(`Watchdog fetch error: ${fetchError.message}`);
  }

  const runs = staleRuns ?? [];
  const markedFailed: string[] = [];

  for (const run of runs) {
    const errorMessage = JSON.stringify({
      message: `Run abandoned: no heartbeat for ${threshold} minutes (likely runner crash)`,
      source: 'evolution-watchdog',
      lastHeartbeat: run.last_heartbeat,
      threshold: `${threshold}min`,
      timestamp: new Date().toISOString(),
    });

    // B060: avoid the read-then-update race by pinning the UPDATE to the
    // `last_heartbeat` value we just read. If another process has bumped the heartbeat
    // between the SELECT above and the UPDATE here (indicating the run recovered), the
    // predicate fails and we leave the row alone. This is a compare-and-set pattern on
    // a single column — stronger than the existing `.in('status', [...])` guard, which
    // lets a transition (e.g., to 'completed') through.
    const heartbeatPredicate = run.last_heartbeat == null
      ? supabase.from('evolution_runs').update({ status: 'failed', error_message: errorMessage, runner_id: null }).eq('id', run.id).is('last_heartbeat', null)
      : supabase.from('evolution_runs').update({ status: 'failed', error_message: errorMessage, runner_id: null }).eq('id', run.id).eq('last_heartbeat', run.last_heartbeat);

    // Additionally still gate on status so we never flip a run that raced to `completed`.
    // We use `.select('id')` to read back the actual updated rows rather than passing
    // count options (which Supabase update typings do not accept). If the predicate
    // fails to match, `updatedRows` is empty and we leave the original record alone.
    const { error: updateError, data: updatedRows } = await heartbeatPredicate
      .in('status', ['claimed', 'running'])
      .select('id');

    if (updateError) {
      console.error('Watchdog update error', { runId: run.id, error: updateError.message });
    } else if (Array.isArray(updatedRows) && updatedRows.length > 0) {
      markedFailed.push(run.id);
    } else {
      // Heartbeat or status changed between our read and update — run recovered or already finalized.
      // Not an error; just skip.
    }
  }

  return {
    staleRunsFound: runs.length,
    markedFailed,
  };
}

export async function cleanupOrphanedReservations(): Promise<void> {
  const gate = getSpendingGate();
  await gate.cleanupOrphanedReservations();
}
