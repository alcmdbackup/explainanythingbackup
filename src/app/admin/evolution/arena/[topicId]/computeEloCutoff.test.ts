// Unit tests for computeEloCutoff helper — top 15% eligibility cutoff computation.

import { computeEloCutoff } from './arenaCutoff';

describe('computeEloCutoff', () => {
  it('returns null for empty entries', () => {
    expect(computeEloCutoff([])).toBeNull();
  });

  it('returns null for 1-2 entries (below MIN_ENTRIES_FOR_CUTOFF)', () => {
    expect(computeEloCutoff([{ mu: 25, sigma: 8 }])).toBeNull();
    expect(computeEloCutoff([{ mu: 25, sigma: 8 }, { mu: 30, sigma: 7 }])).toBeNull();
  });

  it('returns null when all entries have null mu/sigma', () => {
    expect(computeEloCutoff([
      { mu: null, sigma: null },
      { mu: null, sigma: null },
      { mu: null, sigma: null },
    ])).toBeNull();
  });

  it('returns null when all entries have identical mu (stdDev=0)', () => {
    expect(computeEloCutoff([
      { mu: 25, sigma: 8 },
      { mu: 25, sigma: 8 },
      { mu: 25, sigma: 8 },
    ])).toBeNull();
  });

  it('computes cutoff for 3+ entries with varying elo', () => {
    // mu=25 -> elo=1200, mu=30 -> elo=1280, mu=35 -> elo=1360
    const entries = [
      { mu: 25, sigma: 8 },
      { mu: 30, sigma: 7 },
      { mu: 35, sigma: 6 },
    ];
    const cutoff = computeEloCutoff(entries);
    expect(cutoff).not.toBeNull();
    // Mean elo = (1200+1280+1360)/3 = 1280
    // Variance = ((1200-1280)^2 + (1280-1280)^2 + (1360-1280)^2)/3 = (6400+0+6400)/3 = 4266.67
    // StdDev = 65.32
    // Cutoff = 1280 + 1.04 * 65.32 = 1347.93
    expect(cutoff!).toBeCloseTo(1347.93, 0);
  });

  it('filters out entries with null mu/sigma', () => {
    const entries = [
      { mu: 25, sigma: 8 },
      { mu: null, sigma: null },
      { mu: 30, sigma: 7 },
      { mu: 35, sigma: 6 },
    ];
    const cutoff = computeEloCutoff(entries);
    expect(cutoff).not.toBeNull();
    // Same as 3-entry case above (null entry filtered out)
    expect(cutoff!).toBeCloseTo(1347.93, 0);
  });

  it('returns null when valid entries < 3 after filtering nulls', () => {
    const entries = [
      { mu: 25, sigma: 8 },
      { mu: null, sigma: null },
      { mu: 30, sigma: 7 },
      { mu: null, sigma: null },
    ];
    expect(computeEloCutoff(entries)).toBeNull();
  });
});
