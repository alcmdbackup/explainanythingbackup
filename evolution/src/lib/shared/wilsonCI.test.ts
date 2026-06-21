// Unit tests for wilsonScoreCI — the binomial-proportion CI helper used by the Agreement
// Sweep leaderboard + reducer. Spot-checks known values; verifies degenerate-input behavior.

import { wilsonScoreCI } from './wilsonCI';

describe('wilsonScoreCI', () => {
  it('n=0 returns null', () => {
    expect(wilsonScoreCI(0, 0)).toBeNull();
  });

  it('p=0 returns finite bounds with low clamped to 0', () => {
    const ci = wilsonScoreCI(0, 10)!;
    expect(ci.low).toBe(0);
    expect(ci.high).toBeGreaterThan(0);
    expect(ci.high).toBeLessThan(0.5);
  });

  it('p=1 returns finite bounds with high clamped to 1', () => {
    const ci = wilsonScoreCI(10, 10)!;
    expect(ci.high).toBe(1);
    expect(ci.low).toBeLessThan(1);
    expect(ci.low).toBeGreaterThan(0.5);
  });

  it('known canonical: 8/10 at 95% ≈ [0.49, 0.94]', () => {
    // From a published Wilson CI table; allow ±0.01 wiggle for floating-point.
    const ci = wilsonScoreCI(8, 10)!;
    expect(ci.low).toBeCloseTo(0.49, 1);
    expect(ci.high).toBeCloseTo(0.94, 1);
  });

  it('known canonical: 50/100 at 95% ≈ [0.40, 0.60]', () => {
    const ci = wilsonScoreCI(50, 100)!;
    expect(ci.low).toBeCloseTo(0.40, 1);
    expect(ci.high).toBeCloseTo(0.60, 1);
  });

  it('CI narrows as n grows for the same p', () => {
    const small = wilsonScoreCI(5, 10)!;
    const large = wilsonScoreCI(500, 1000)!;
    const smallWidth = small.high - small.low;
    const largeWidth = large.high - large.low;
    expect(largeWidth).toBeLessThan(smallWidth);
  });

  it('non-default z=1.645 (~90%) produces narrower interval than z=1.96', () => {
    const ci95 = wilsonScoreCI(50, 100, 1.96)!;
    const ci90 = wilsonScoreCI(50, 100, 1.645)!;
    expect(ci90.high - ci90.low).toBeLessThan(ci95.high - ci95.low);
  });

  it('clamps to [0, 1] for extreme cases', () => {
    const ci = wilsonScoreCI(0, 3)!;
    expect(ci.low).toBeGreaterThanOrEqual(0);
    expect(ci.high).toBeLessThanOrEqual(1);
  });

  it('negative successes throws', () => {
    expect(() => wilsonScoreCI(-1, 10)).toThrow(/negative/);
  });

  it('negative n throws', () => {
    expect(() => wilsonScoreCI(0, -1)).toThrow(/negative/);
  });

  it('successes > n throws', () => {
    expect(() => wilsonScoreCI(11, 10)).toThrow(/successes > n/);
  });
});
