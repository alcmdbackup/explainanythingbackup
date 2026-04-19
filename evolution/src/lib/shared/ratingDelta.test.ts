import { bootstrapDeltaCI } from './ratingDelta';

// Simple LCG for deterministic tests (matches pattern used in experimentMetrics tests).
function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    s = s >>> 0;
    return s / 0x100000000;
  };
}

describe('bootstrapDeltaCI', () => {
  it('returns degenerate CI [delta, delta] when both uncertainties are 0', () => {
    const res = bootstrapDeltaCI(
      { elo: 1250, uncertainty: 0 },
      { elo: 1200, uncertainty: 0 },
    );
    expect(res.delta).toBe(50);
    expect(res.ci).toEqual([50, 50]);
  });

  it('CI contains the point estimate and reflects symmetric spread', () => {
    const rng = createSeededRng(42);
    const res = bootstrapDeltaCI(
      { elo: 1250, uncertainty: 40 },
      { elo: 1200, uncertainty: 30 },
      1000,
      rng,
    );
    expect(res.delta).toBe(50);
    expect(res.ci).not.toBeNull();
    const [lo, hi] = res.ci!;
    expect(lo).toBeLessThan(res.delta);
    expect(hi).toBeGreaterThan(res.delta);
    // CI should be wide but bounded — sqrt(40^2+30^2) = 50 → ±1.96σ ≈ ±98
    expect(lo).toBeGreaterThan(-70);
    expect(hi).toBeLessThan(170);
  });

  it('is deterministic with a seeded RNG', () => {
    const r1 = bootstrapDeltaCI(
      { elo: 1200, uncertainty: 50 },
      { elo: 1150, uncertainty: 40 },
      500,
      createSeededRng(123),
    );
    const r2 = bootstrapDeltaCI(
      { elo: 1200, uncertainty: 50 },
      { elo: 1150, uncertainty: 40 },
      500,
      createSeededRng(123),
    );
    expect(r1.ci).toEqual(r2.ci);
  });

  it('handles negative deltas correctly', () => {
    const res = bootstrapDeltaCI(
      { elo: 1100, uncertainty: 30 },
      { elo: 1250, uncertainty: 30 },
      1000,
      createSeededRng(1),
    );
    expect(res.delta).toBe(-150);
    expect(res.ci![0]).toBeLessThan(-150);
    expect(res.ci![1]).toBeGreaterThan(-150);
  });
});
