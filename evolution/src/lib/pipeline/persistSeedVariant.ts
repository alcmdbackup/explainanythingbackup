// Persists the seed variant row with bounded retry + a fail-closed concurrent-deletion guard.
// If the parent evolution_runs row vanished mid-persist (e.g. a parallel test's global-teardown
// deleted it — the evolution_variants_run_id_fkey RESTRICT race), abort gracefully with a typed
// error; if the run still exists, a persist failure is a REAL fault and is re-thrown (never
// swallowed — fail-closed, per the repo's data-integrity principle and the B008 warning).

import type { SupabaseClient } from '@supabase/supabase-js';

/** Thrown when the parent evolution_runs row was deleted while its pipeline was still persisting
 *  variants — a benign concurrency/teardown race, NOT data corruption. Classified distinctly
 *  (`run_deleted_during_execution`) so triage can tell it apart from a genuine persist fault. */
export class RunDeletedDuringExecutionError extends Error {
  constructor(
    public readonly runId: string,
    public readonly underlying?: string,
  ) {
    super(`Run deleted during execution: ${runId}${underlying ? ` (${underlying})` : ''}`);
    this.name = 'RunDeletedDuringExecutionError';
  }
}

interface PersistLogger {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const MAX_ATTEMPTS = 3;
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Upsert the seed variant (synced_to_arena=true, generation_method='seed') with exponential
 * backoff. On permanent failure, re-assert the run still exists:
 *  - run GONE  → throw RunDeletedDuringExecutionError (graceful abort; the run is the terminal state,
 *                nothing left to persist or mark).
 *  - run EXISTS → throw a generic "Seed variant persist failed after retries" error (real fault; the
 *                caller's outer catch classifies it `seed_variant_persist_failed` and marks the run).
 * `sleep` is injectable so unit tests run without real backoff delay.
 */
export async function persistSeedVariantRow(
  db: SupabaseClient,
  runId: string,
  seedRow: Record<string, unknown>,
  logger: PersistLogger,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { error } = await db
      .from('evolution_variants')
      .upsert({ ...seedRow, synced_to_arena: true, generation_method: 'seed' }, { onConflict: 'id' });
    if (!error) return;
    lastError = error;
    logger.warn('Seed variant persist failed (will retry)', {
      phaseName: 'seed_generation', attempt, error: error.message.slice(0, 500),
    });
    // Exponential backoff: 200ms, 800ms (skipped after the final attempt).
    if (attempt < MAX_ATTEMPTS - 1) await sleep(200 * Math.pow(4, attempt));
  }

  const { data: runStillExists } = await db
    .from('evolution_runs').select('id').eq('id', runId).maybeSingle();
  if (!runStillExists) {
    logger.warn('Run row vanished during seed-variant persist (concurrent deletion) — aborting gracefully', {
      phaseName: 'seed_generation', runId, error: lastError?.message.slice(0, 500),
    });
    throw new RunDeletedDuringExecutionError(runId, lastError?.message.slice(0, 200));
  }
  // Fail-closed: run exists but the seed won't persist — a real fault; never swallow.
  logger.error('Seed variant persist failed after retries (run still exists) — failing run', {
    phaseName: 'seed_generation', runId, error: lastError?.message.slice(0, 500),
  });
  throw new Error(`Seed variant persist failed after retries: ${lastError?.message ?? 'unknown'}`);
}
