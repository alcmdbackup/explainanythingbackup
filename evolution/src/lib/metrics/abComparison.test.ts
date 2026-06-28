// Unit tests for the between-arm comparison helper (Decision H).
import {
  median,
  percentile,
  pBestAnalysis,
  vsBaselineHolm,
  holmCorrect,
} from './abComparison';

describe('median / percentile', () => {
  it('median of odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it('percentile is nearest-rank and clamped', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
  });
});

describe('holmCorrect', () => {
  it('step-down adjusts and is monotone non-decreasing in p-rank', () => {
    const adj = holmCorrect({ a: 0.01, b: 0.02, c: 0.04 });
    // a: 3*0.01=0.03, b: max(0.03, 2*0.02=0.04)=0.04, c: max(0.04,1*0.04)=0.04
    expect(adj.a!).toBeCloseTo(0.03, 6);
    expect(adj.b!).toBeCloseTo(0.04, 6);
    expect(adj.c!).toBeCloseTo(0.04, 6);
    expect(adj.a!).toBeLessThanOrEqual(adj.b!);
    expect(adj.b!).toBeLessThanOrEqual(adj.c!);
  });
  it('K=1 degenerate case: adjusted == raw', () => {
    expect(holmCorrect({ only: 0.03 }).only!).toBeCloseTo(0.03, 6);
  });
  it('caps at 1', () => {
    expect(holmCorrect({ a: 0.6, b: 0.7 }).a!).toBeLessThanOrEqual(1);
    expect(holmCorrect({ a: 0.6, b: 0.7 }).b!).toBeLessThanOrEqual(1);
  });
});

describe('pBestAnalysis', () => {
  it('a clearly-dominant arm gets P(best) ≈ 1', () => {
    const r = pBestAnalysis({
      strong: [100, 105, 98, 102, 101],
      weak: [10, 12, 9, 11, 8],
    }, { iterations: 500, threshold: 40, seed: 1 });
    expect(r.pBest.strong!).toBeGreaterThan(0.95);
    expect(r.pBest.weak!).toBeLessThan(0.05);
    // pBest sums to 1.
    expect(r.pBest.strong! + r.pBest.weak!).toBeCloseTo(1, 6);
  });
  it('near-tied arms split P(best) and both sit in the top tier', () => {
    const r = pBestAnalysis({
      a: [50, 52, 48, 51, 49],
      b: [49, 51, 47, 50, 48],
    }, { iterations: 1000, threshold: 40, seed: 2 });
    expect(r.pBest.a!).toBeGreaterThan(0.2);
    expect(r.pBest.b!).toBeGreaterThan(0.2);
    // within 40 Elo of each other → both ~always in the top tier.
    expect(r.pWithinThreshold.a!).toBeGreaterThan(0.9);
    expect(r.pWithinThreshold.b!).toBeGreaterThan(0.9);
  });
  it('is deterministic under a fixed seed', () => {
    const arms = { a: [1, 2, 3], b: [2, 3, 4] };
    expect(pBestAnalysis(arms, { seed: 7 })).toEqual(pBestAnalysis(arms, { seed: 7 }));
  });
});

describe('vsBaselineHolm', () => {
  it('flags an arm clearly above baseline as significant with positive effect', () => {
    const r = vsBaselineHolm({
      generate: [10, 12, 9, 11, 8],
      strong: [60, 62, 58, 61, 59],
      meh: [11, 9, 12, 10, 8],
    }, 'generate', { iterations: 500, alpha: 0.05, seed: 3 });
    expect(r.strong!.effect).toBeGreaterThan(40);
    expect(r.strong!.significant).toBe(true);
    expect(r.strong!.ci[0]).toBeGreaterThan(0); // CI excludes 0
    // 'meh' ~ baseline → not significant.
    expect(r.meh!.significant).toBe(false);
  });
  it('baseline must exist', () => {
    expect(() => vsBaselineHolm({ a: [1] }, 'nope')).toThrow();
  });
  it('is deterministic under a fixed seed', () => {
    const arms = { generate: [1, 2, 3], x: [4, 5, 6] };
    expect(vsBaselineHolm(arms, 'generate', { seed: 9 })).toEqual(vsBaselineHolm(arms, 'generate', { seed: 9 }));
  });
});
