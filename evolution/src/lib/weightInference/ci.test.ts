// Unit tests for bootstrap weight CIs: determinism under a fixed seed, finite CIs on
// degenerate input, and value == point estimate.

import { createSeededRng } from '../metrics/experimentMetrics';
import { weightCIs } from './ci';
import type { PairObservation, Verdict3 } from './types';
import { signToVerdict, verdictToSign } from './verdicts';

function synth(weights: Record<string, number>, n: number, seed: number): PairObservation[] {
  const rng = createSeededRng(seed);
  const ids = Object.keys(weights);
  const out: PairObservation[] = [];
  let guard = 0;
  while (out.length < n && guard < n * 50) {
    guard++;
    const dims: Record<string, Verdict3> = {};
    let score = 0;
    for (const id of ids) {
      const r = rng();
      const v: Verdict3 = r < 0.2 ? 'tie' : r < 0.6 ? 'a' : 'b';
      dims[id] = v;
      score += weights[id]! * verdictToSign(v);
    }
    const overall = signToVerdict(score);
    if (overall === 'tie') continue;
    out.push({ overall, dims });
  }
  return out;
}

describe('weightCIs', () => {
  it('is deterministic for a fixed seed (byte-identical CIs across runs)', () => {
    const obs = synth({ clarity: 0.6, depth: 0.4 }, 80, 13);
    const a = weightCIs(obs, ['clarity', 'depth'], { seed: 123, iterations: 100 });
    const b = weightCIs(obs, ['clarity', 'depth'], { seed: 123, iterations: 100 });
    expect(a).toEqual(b);
  });

  it('produces finite CIs with value == point estimate and low <= value <= high', () => {
    const obs = synth({ clarity: 0.7, depth: 0.3 }, 90, 8);
    const cis = weightCIs(obs, ['clarity', 'depth'], { seed: 1, iterations: 150 });
    for (const ci of cis) {
      expect(Number.isFinite(ci.value)).toBe(true);
      expect(Number.isFinite(ci.ciLow)).toBe(true);
      expect(Number.isFinite(ci.ciHigh)).toBe(true);
      expect(ci.ciLow).toBeLessThanOrEqual(ci.value + 1e-9);
      expect(ci.ciHigh).toBeGreaterThanOrEqual(ci.value - 1e-9);
    }
  });

  it('never emits NaN on degenerate (all-tie) input', () => {
    const obs: PairObservation[] = [
      { overall: 'tie', dims: { x: 'tie', y: 'tie' } },
      { overall: 'tie', dims: { x: 'tie', y: 'tie' } },
    ];
    const cis = weightCIs(obs, ['x', 'y'], { seed: 2, iterations: 50 });
    for (const ci of cis) {
      expect(Number.isNaN(ci.value)).toBe(false);
      expect(Number.isNaN(ci.ciLow)).toBe(false);
      expect(Number.isNaN(ci.ciHigh)).toBe(false);
    }
  });

  it('returns zeroed CIs for empty input', () => {
    const cis = weightCIs([], ['x', 'y'], { seed: 1 });
    expect(cis).toHaveLength(2);
    expect(cis.every((c) => c.n === 0)).toBe(true);
  });
});
