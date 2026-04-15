// Unit tests for computeEloCutoff helper — top 15% eligibility cutoff computation.

import { computeEloCutoff } from './arenaCutoff';

describe('computeEloCutoff', () => {
  it('returns null for empty entries', () => {
    expect(computeEloCutoff([])).toBeNull();
  });

  it('returns null for 1-2 entries (below MIN_ENTRIES_FOR_CUTOFF)', () => {
    expect(computeEloCutoff([{ elo_score: 1200, uncertainty: 128 }])).toBeNull();
    expect(computeEloCutoff([{ elo_score: 1200, uncertainty: 128 }, { elo_score: 1280, uncertainty: 112 }])).toBeNull();
  });

  it('returns null when all entries have null elo_score/uncertainty', () => {
    expect(computeEloCutoff([
      { elo_score: null, uncertainty: null },
      { elo_score: null, uncertainty: null },
      { elo_score: null, uncertainty: null },
    ])).toBeNull();
  });

  it('returns null when all entries have identical elo (stdDev=0)', () => {
    expect(computeEloCutoff([
      { elo_score: 1200, uncertainty: 128 },
      { elo_score: 1200, uncertainty: 128 },
      { elo_score: 1200, uncertainty: 128 },
    ])).toBeNull();
  });

  it('computes cutoff for 3+ entries with varying elo', () => {
    const entries = [
      { elo_score: 1200, uncertainty: 128 },
      { elo_score: 1280, uncertainty: 112 },
      { elo_score: 1360, uncertainty: 96 },
    ];
    const cutoff = computeEloCutoff(entries);
    expect(cutoff).not.toBeNull();
    // Mean elo = (1200+1280+1360)/3 = 1280
    // Variance = ((1200-1280)^2 + (1280-1280)^2 + (1360-1280)^2)/3 = (6400+0+6400)/3 = 4266.67
    // StdDev = 65.32
    // Cutoff = 1280 + 1.04 * 65.32 = 1347.93
    expect(cutoff!).toBeCloseTo(1347.93, 0);
  });

  it('filters out entries with null elo_score/uncertainty', () => {
    const entries = [
      { elo_score: 1200, uncertainty: 128 },
      { elo_score: null, uncertainty: null },
      { elo_score: 1280, uncertainty: 112 },
      { elo_score: 1360, uncertainty: 96 },
    ];
    const cutoff = computeEloCutoff(entries);
    expect(cutoff).not.toBeNull();
    // Same as 3-entry case above (null entry filtered out)
    expect(cutoff!).toBeCloseTo(1347.93, 0);
  });

  it('returns null when valid entries < 3 after filtering nulls', () => {
    const entries = [
      { elo_score: 1200, uncertainty: 128 },
      { elo_score: null, uncertainty: null },
      { elo_score: 1280, uncertainty: 112 },
      { elo_score: null, uncertainty: null },
    ];
    expect(computeEloCutoff(entries)).toBeNull();
  });
});
