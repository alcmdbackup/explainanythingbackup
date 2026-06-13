// Unit tests for the arena_only wipeout detector's pure classifier
// (fix_structured_judging_evolution_bugs_20260611). Back-tests the real 2026-05-02 and
// 2026-06-11 incident fingerprints and guards against flagging legitimate arena-only runs.

import { isArenaOnlyWipeout, detectWipeouts, type RunHealthRow } from './detectArenaOnlyWipeouts';

function row(overrides: Partial<RunHealthRow>): RunHealthRow {
  return {
    runId: 'r', status: 'completed', errorCode: null, stopReason: 'arena_only',
    generateInvocationCount: 100, variantCount: 0, totalCostUsd: 0, ...overrides,
  };
}

describe('isArenaOnlyWipeout', () => {
  it('flags the 2026-06-11 incident shape (completed/arena_only, 100 gens, 0 variants, 0 cost)', () => {
    expect(isArenaOnlyWipeout(row({ runId: '339ab3cc' }))).toBe(true);
  });

  it('flags the 2026-05-02 incident shape (same fingerprint)', () => {
    expect(isArenaOnlyWipeout(row({ runId: '90441b07', generateInvocationCount: 104 }))).toBe(true);
  });

  it('flags the post-D3 explicit failure shape (status=failed, error_code=all_generations_failed)', () => {
    expect(isArenaOnlyWipeout(row({ status: 'failed', errorCode: 'all_generations_failed' }))).toBe(true);
  });

  it('does NOT flag a legitimate arena-only run (ZERO generation invocations — the discriminator)', () => {
    expect(isArenaOnlyWipeout(row({ generateInvocationCount: 0 }))).toBe(false);
  });

  it('does NOT flag a healthy completed run (variants produced, real cost)', () => {
    expect(isArenaOnlyWipeout(row({ variantCount: 12, totalCostUsd: 0.03 }))).toBe(false);
  });

  it('does NOT flag a run that produced variants at zero cost (e.g. local model) but completed normally', () => {
    expect(isArenaOnlyWipeout(row({ variantCount: 33, totalCostUsd: 0, stopReason: 'completed' }))).toBe(false);
  });

  it('does NOT flag a failed run for an unrelated reason', () => {
    expect(isArenaOnlyWipeout(row({ status: 'failed', errorCode: 'finalize_empty_pool', stopReason: null }))).toBe(false);
  });
});

describe('detectWipeouts', () => {
  it('filters a mixed batch down to only the wipeouts', () => {
    const batch: RunHealthRow[] = [
      row({ runId: 'wipeout-1' }),
      row({ runId: 'healthy', variantCount: 10, totalCostUsd: 0.05 }),
      row({ runId: 'legit-arena', generateInvocationCount: 0 }),
      row({ runId: 'wipeout-2', status: 'failed', errorCode: 'all_generations_failed' }),
    ];
    expect(detectWipeouts(batch).map((r) => r.runId)).toEqual(['wipeout-1', 'wipeout-2']);
  });
});
