// Unit tests for the seed-variant persist guard: happy path, retry, and the fail-closed split
// between a benign vanished-run (graceful RunDeletedDuringExecutionError) and a real fault (rethrow).

import type { SupabaseClient } from '@supabase/supabase-js';
import { persistSeedVariantRow, RunDeletedDuringExecutionError } from './persistSeedVariant';

const noopSleep = async (): Promise<void> => {};
const logger = { warn: (): void => {}, error: (): void => {} };

/** Fake Supabase: upsert returns the i-th error (last one repeats); run existence is fixed. */
function makeDb(opts: { upsertErrors: Array<{ message: string } | null>; runExists: boolean }): {
  db: SupabaseClient;
  calls: { upsert: number };
} {
  const calls = { upsert: 0 };
  const db = {
    from(table: string) {
      if (table === 'evolution_variants') {
        return {
          upsert: async () => {
            const e = opts.upsertErrors[Math.min(calls.upsert, opts.upsertErrors.length - 1)] ?? null;
            calls.upsert += 1;
            return { error: e };
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: opts.runExists ? { id: 'run-1' } : null }) }),
        }),
      };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const ROW = { id: 'v1', run_id: 'run-1' };

describe('persistSeedVariantRow', () => {
  it('resolves on first success (single upsert)', async () => {
    const { db, calls } = makeDb({ upsertErrors: [null], runExists: true });
    await expect(persistSeedVariantRow(db, 'run-1', ROW, logger, noopSleep)).resolves.toBeUndefined();
    expect(calls.upsert).toBe(1);
  });

  it('retries then succeeds', async () => {
    const { db, calls } = makeDb({ upsertErrors: [{ message: 'transient' }, null], runExists: true });
    await expect(persistSeedVariantRow(db, 'run-1', ROW, logger, noopSleep)).resolves.toBeUndefined();
    expect(calls.upsert).toBe(2);
  });

  it('GONE run → graceful RunDeletedDuringExecutionError (after exhausting retries)', async () => {
    const { db, calls } = makeDb({ upsertErrors: [{ message: 'fk violation' }], runExists: false });
    await expect(persistSeedVariantRow(db, 'run-1', ROW, logger, noopSleep)).rejects.toBeInstanceOf(
      RunDeletedDuringExecutionError,
    );
    expect(calls.upsert).toBe(3); // all attempts tried before the existence check
  });

  it('EXISTING run + persist error → rethrows a real fault (fail-closed, NOT swallowed)', async () => {
    const { db } = makeDb({ upsertErrors: [{ message: 'fk violation' }], runExists: true });
    await expect(persistSeedVariantRow(db, 'run-1', ROW, logger, noopSleep)).rejects.toThrow(
      /Seed variant persist failed after retries/,
    );
  });

  it('RunDeletedDuringExecutionError carries the runId', () => {
    const err = new RunDeletedDuringExecutionError('run-xyz', 'fk');
    expect(err.runId).toBe('run-xyz');
    expect(err.name).toBe('RunDeletedDuringExecutionError');
  });
});
