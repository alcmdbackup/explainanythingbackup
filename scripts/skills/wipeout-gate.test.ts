/**
 * @jest-environment node
 */
// Tests for wipeout-gate.ts — the HARD GATE orchestration consumed by
// /run_experiment_analysis Step 3. A regression here silently disables the
// arena-only-wipeout detection that motivated the whole project (Decision #13).

import { parseWipeoutDetectorOutput, shouldFireHardGate } from './wipeout-gate';

describe('parseWipeoutDetectorOutput', () => {
  it('returns [] for empty wipeouts envelope', () => {
    const envelope = JSON.stringify({ target: 'staging', sinceHours: 24, count: 0, wipeouts: [] });
    expect(parseWipeoutDetectorOutput(envelope)).toEqual([]);
  });

  it('returns the .wipeouts array from a populated envelope', () => {
    const wipeouts = [
      { run_id: 'r1', variant_count: 0, generate_invocation_count: 5, total_cost: 0 },
      { run_id: 'r2', error_code: 'all_generations_failed' },
    ];
    const envelope = JSON.stringify({ target: 'staging', sinceHours: null, count: 2, wipeouts });
    expect(parseWipeoutDetectorOutput(envelope)).toEqual(wipeouts);
  });

  it('returns [] for malformed JSON (no throw)', () => {
    expect(parseWipeoutDetectorOutput('not json {{{')).toEqual([]);
  });

  it('returns [] for empty/null/undefined input', () => {
    expect(parseWipeoutDetectorOutput('')).toEqual([]);
    expect(parseWipeoutDetectorOutput(null as unknown as string)).toEqual([]);
    expect(parseWipeoutDetectorOutput(undefined as unknown as string)).toEqual([]);
  });

  it('returns [] when envelope is missing .wipeouts (back-compat for unexpected shapes)', () => {
    expect(parseWipeoutDetectorOutput(JSON.stringify({ target: 'staging' }))).toEqual([]);
  });

  it('returns [] when JSON is a primitive, not an object', () => {
    expect(parseWipeoutDetectorOutput('null')).toEqual([]);
    expect(parseWipeoutDetectorOutput('42')).toEqual([]);
    expect(parseWipeoutDetectorOutput('"string"')).toEqual([]);
  });

  it('handles the detector-exit-1 || true case (output present + non-zero exit consumed by `|| true`)', () => {
    // The skill's invocation: WIPEOUT_JSON=$(npx tsx ... --json || true)
    // The detector still wrote its envelope to stdout; the || true consumed the exit-1.
    // From the skill's view, $WIPEOUT_JSON is the same envelope it would get from a
    // success-with-wipeouts run. The function MUST treat exit-code-1 output identically.
    const envelope = JSON.stringify({
      target: 'staging',
      sinceHours: null,
      count: 1,
      wipeouts: [{ run_id: 'r1' }],
    });
    expect(parseWipeoutDetectorOutput(envelope)).toHaveLength(1);
  });
});

describe('shouldFireHardGate', () => {
  it('returns false when no wipeouts', () => {
    expect(shouldFireHardGate([])).toBe(false);
  });

  it('returns true when ≥1 wipeout', () => {
    expect(shouldFireHardGate([{ run_id: 'r1' }])).toBe(true);
    expect(shouldFireHardGate([{ run_id: 'r1' }, { run_id: 'r2' }])).toBe(true);
  });
});
