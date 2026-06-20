// Tests for the Phase 6 Stage 1 verifier. Focuses on argv-parsing safety (pre-DB
// UUID validation) and the structure of the 6 checks.

import { validateUuidArgs, STAGE_1_CHECKS } from './verifyBundleSplitStage1';

describe('validateUuidArgs (pre-DB UUID validation)', () => {
  it('accepts well-formed UUIDs', () => {
    expect(() =>
      validateUuidArgs([{ flag: 'experiment-id', value: 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f' }]),
    ).not.toThrow();
  });

  it('rejects an undefined value with a clear flag-named error', () => {
    expect(() =>
      validateUuidArgs([{ flag: 'control-strategy', value: undefined }]),
    ).toThrow(/Invalid UUID for --control-strategy/);
  });

  it('rejects a malformed UUID (truncated)', () => {
    expect(() =>
      validateUuidArgs([{ flag: 'treatment-strategy', value: 'a546b7e9-f066-403d-9589' }]),
    ).toThrow(/Invalid UUID for --treatment-strategy/);
  });

  it('rejects a UUID with non-hex characters', () => {
    expect(() =>
      validateUuidArgs([{ flag: 'experiment-id', value: 'a546b7e9-f066-403d-9589-f5e0d2c9fa4Z' }]),
    ).toThrow(/Invalid UUID for --experiment-id/);
  });

  it('accepts uppercase-hex UUIDs (case-insensitive)', () => {
    expect(() =>
      validateUuidArgs([{ flag: 'experiment-id', value: 'A546B7E9-F066-403D-9589-F5E0D2C9FA4F' }]),
    ).not.toThrow();
  });

  it('validates multiple flags, throws on the first invalid one', () => {
    expect(() =>
      validateUuidArgs([
        { flag: 'experiment-id', value: 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f' },
        { flag: 'control-strategy', value: 'not-a-uuid' },
      ]),
    ).toThrow(/Invalid UUID for --control-strategy/);
  });
});

describe('STAGE_1_CHECKS structure (Phase 6 acceptance gate)', () => {
  it('exposes exactly 6 checks (the count cited in the planning doc)', () => {
    expect(STAGE_1_CHECKS).toHaveLength(6);
  });

  it('names match the planning doc: no_failures, cost_under_ceiling, treatment_bypass_active, control_cap_fired, treatment_mostly_singletons, arena_sync_both_arms', () => {
    expect(STAGE_1_CHECKS.map((c) => c.name)).toEqual([
      'no_failures',
      'cost_under_ceiling',
      'treatment_bypass_active',
      'control_cap_fired',
      'treatment_mostly_singletons',
      'arena_sync_both_arms',
    ]);
  });

  it('every check has a run() function', () => {
    for (const check of STAGE_1_CHECKS) {
      expect(typeof check.run).toBe('function');
    }
  });
});
