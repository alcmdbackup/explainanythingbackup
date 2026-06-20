// Unit tests for the reversal-audit metrics + per-pair confidence.

import { auditConsistency, pairConfidence, type ReplicatedPair } from './audit';
import type { PairObservation, Verdict3 } from './types';
import { flipPairVerdict } from './verdicts';

function obs(overall: Verdict3, dims: Record<string, Verdict3>): PairObservation {
  return { overall, dims };
}

describe('auditConsistency', () => {
  it('a position-biased rater (every verdict flips under reversal) → high bias, low consistency', () => {
    const replicas: ReplicatedPair[] = [];
    for (let i = 0; i < 20; i++) {
      const v: Verdict3 = i % 2 === 0 ? 'a' : 'b';
      const p0 = obs(v, { c1: v });
      // pass1 canonical verdict is the OPPOSITE (rater followed on-screen side)
      const p1 = obs(flipPairVerdict(v), { c1: flipPairVerdict(v) });
      replicas.push({ pass0: p0, pass1: p1 });
    }
    const audit = auditConsistency(replicas);
    expect(audit.overall.positionBiasRate).toBeCloseTo(1, 5);
    expect(audit.overall.selfConsistencyRate).toBeCloseTo(0, 5);
    expect(audit.perCriterion.c1!.positionBiasRate).toBeCloseTo(1, 5);
  });

  it('a consistent rater (verdict identical across passes) → consistency 1, bias 0', () => {
    const replicas: ReplicatedPair[] = [];
    for (let i = 0; i < 15; i++) {
      const v: Verdict3 = i % 3 === 0 ? 'tie' : i % 2 === 0 ? 'a' : 'b';
      const p = obs(v, { c1: v, c2: 'tie' });
      replicas.push({ pass0: p, pass1: { ...p, dims: { ...p.dims } } });
    }
    const audit = auditConsistency(replicas);
    expect(audit.overall.selfConsistencyRate).toBeCloseTo(1, 5);
    expect(audit.overall.positionBiasRate).toBeCloseTo(0, 5);
    expect(audit.perCriterion.c1!.selfConsistencyRate).toBeCloseTo(1, 5);
  });

  it('handles an empty replica set without NaN', () => {
    const audit = auditConsistency([]);
    expect(audit.overall.n).toBe(0);
    expect(audit.overall.positionBiasRate).toBe(0);
    expect(audit.overall.selfConsistencyRate).toBe(0);
  });
});

describe('pairConfidence', () => {
  it('agree → 1.0, disagree → 0.3, no-replica → base', () => {
    const agree: ReplicatedPair = { pass0: obs('a', {}), pass1: obs('a', {}) };
    const disagree: ReplicatedPair = { pass0: obs('a', {}), pass1: obs('b', {}) };
    expect(pairConfidence(agree)).toBe(1.0);
    expect(pairConfidence(disagree)).toBe(0.3);
    expect(pairConfidence(undefined)).toBe(1.0);
    expect(pairConfidence(undefined, 0.5)).toBe(0.5);
  });
});
