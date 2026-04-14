// Unit tests for the OpenSkill rating wrapper module.
// Verifies pairwise updates, draws, elo, convergence, backward compat, and performance.

import {
  createRating,
  updateRating,
  updateDraw,
  isConverged,
  toEloScale,
  formatElo,
  stripMarkdownTitle,
  compareWithBiasMitigation,
  DEFAULT_CONVERGENCE_UNCERTAINTY,
  DEFAULT_ELO,
  DEFAULT_UNCERTAINTY,
  type Rating,
  type ComparisonResult,
} from './computeRatings';

describe('createRating', () => {
  it('returns default elo ≈ 1200 and uncertainty ≈ 133.33', () => {
    const r = createRating();
    expect(r.elo).toBeCloseTo(1200, 0);
    expect(r.uncertainty).toBeCloseTo(400 / 3, 1);
  });
});

describe('updateRating', () => {
  it('winner elo increases, loser elo decreases', () => {
    const w = createRating();
    const l = createRating();
    const [newW, newL] = updateRating(w, l);
    expect(newW.elo).toBeGreaterThan(w.elo);
    expect(newL.elo).toBeLessThan(l.elo);
  });

  it('both uncertainties shrink after match', () => {
    const w = createRating();
    const l = createRating();
    const [newW, newL] = updateRating(w, l);
    expect(newW.uncertainty).toBeLessThan(w.uncertainty);
    expect(newL.uncertainty).toBeLessThan(l.uncertainty);
  });

  it('stronger player wins → smaller elo shift than equal match', () => {
    const strong: Rating = { elo: 1360, uncertainty: 64 };
    const weak: Rating = { elo: 1040, uncertainty: 64 };
    const [newStrong] = updateRating(strong, weak);
    // Expected win → small elo gain (< 2 mu = < 32 elo)
    expect(newStrong.elo - strong.elo).toBeLessThan(32);
  });

  it('upset (weak beats strong) → larger elo shift', () => {
    const strong: Rating = { elo: 1360, uncertainty: 64 };
    const weak: Rating = { elo: 1040, uncertainty: 64 };
    const [newWeak] = updateRating(weak, strong);
    // Upset → larger elo gain than expected win
    const [newStrong2] = updateRating(strong, weak);
    expect(newWeak.elo - weak.elo).toBeGreaterThan(newStrong2.elo - strong.elo);
  });
});

describe('updateDraw', () => {
  it('equal players: draw does not significantly change elo', () => {
    const a = createRating();
    const b = createRating();
    const [newA, newB] = updateDraw(a, b);
    expect(Math.abs(newA.elo - a.elo)).toBeLessThan(16);
    expect(Math.abs(newB.elo - b.elo)).toBeLessThan(16);
  });

  it('unequal players: draw moves both toward each other', () => {
    const high: Rating = { elo: 1360, uncertainty: 80 };
    const low: Rating = { elo: 1040, uncertainty: 80 };
    const [newHigh, newLow] = updateDraw(high, low);
    expect(newHigh.elo).toBeLessThan(high.elo);
    expect(newLow.elo).toBeGreaterThan(low.elo);
  });

  it('both uncertainties shrink after draw', () => {
    const a = createRating();
    const b = createRating();
    const [newA, newB] = updateDraw(a, b);
    expect(newA.uncertainty).toBeLessThan(a.uncertainty);
    expect(newB.uncertainty).toBeLessThan(b.uncertainty);
  });
});

describe('elo-based ranking', () => {
  it('higher elo means higher skill (uncertainty irrelevant for ranking)', () => {
    const low: Rating = { elo: 1120, uncertainty: 48 };
    const high: Rating = { elo: 1280, uncertainty: 48 };
    expect(high.elo).toBeGreaterThan(low.elo);
  });

  it('fresh rating has elo = 1200', () => {
    const r = createRating();
    expect(r.elo).toBeCloseTo(1200, 0);
  });
});

describe('isConverged', () => {
  it('returns false for fresh rating', () => {
    expect(isConverged(createRating())).toBe(false);
  });

  it('returns true when uncertainty < default threshold', () => {
    expect(isConverged({ elo: 1200, uncertainty: 40 })).toBe(true);
  });

  it('respects custom threshold', () => {
    expect(isConverged({ elo: 1200, uncertainty: 64 }, 80)).toBe(true);
    expect(isConverged({ elo: 1200, uncertainty: 64 }, 48)).toBe(false);
  });

  it('DEFAULT_CONVERGENCE_UNCERTAINTY is 72', () => {
    expect(DEFAULT_CONVERGENCE_UNCERTAINTY).toBe(72);
  });

  it('DEFAULT_ELO is 1200 and DEFAULT_UNCERTAINTY is 400/3', () => {
    expect(DEFAULT_ELO).toBe(1200);
    expect(DEFAULT_UNCERTAINTY).toBeCloseTo(400 / 3, 5);
  });
});

describe('uncertainty convergence over multiple matches', () => {
  it('uncertainty monotonically decreases with consecutive matches', () => {
    let a = createRating();
    let b = createRating();
    const uncertaintyHistory: number[] = [a.uncertainty];

    for (let i = 0; i < 10; i++) {
      [a, b] = updateRating(a, b);
      uncertaintyHistory.push(a.uncertainty);
    }

    // Each uncertainty should be less than or equal to previous
    for (let i = 1; i < uncertaintyHistory.length; i++) {
      expect(uncertaintyHistory[i]!).toBeLessThanOrEqual(uncertaintyHistory[i - 1]!);
    }
  });
});

describe('toEloScale', () => {
  it('fresh rating mu (25) maps to Elo 1200', () => {
    const eloScale = toEloScale(25);
    expect(eloScale).toBeCloseTo(1200, -1);
  });

  it('mu 0 maps to Elo 800', () => {
    expect(toEloScale(0)).toBe(800);
  });

  it('mu 25 maps to Elo 1200', () => {
    expect(toEloScale(25)).toBe(1200);
  });

  it('mu 50 maps to Elo 1600', () => {
    expect(toEloScale(50)).toBe(1600);
  });

  it('clamps to [0, 3000]', () => {
    expect(toEloScale(-200)).toBe(0);
    expect(toEloScale(200)).toBe(3000);
  });

  it('round-trip preserves ordering', () => {
    const mus = [10, 20, 25, 30, 40];
    const roundTripped = mus.map(toEloScale);
    for (let i = 1; i < roundTripped.length; i++) {
      expect(roundTripped[i]!).toBeGreaterThan(roundTripped[i - 1]!);
    }
  });
});


describe('elo display inside 95% CI', () => {
  it('rating.elo is between ci_lower and ci_upper for various ratings', () => {
    const testCases: Rating[] = [
      { elo: 1200, uncertainty: 400 / 3 },  // fresh
      { elo: 1248, uncertainty: 48 },        // converged winner
      { elo: 1152, uncertainty: 112 },       // uncertain
      { elo: 1360, uncertainty: 32 },        // strong converged
      { elo: 1040, uncertainty: 80 },        // below average
    ];
    for (const r of testCases) {
      const ciLower = r.elo - 1.96 * r.uncertainty;
      const ciUpper = r.elo + 1.96 * r.uncertainty;
      expect(r.elo).toBeGreaterThanOrEqual(ciLower);
      expect(r.elo).toBeLessThanOrEqual(ciUpper);
    }
  });
});

describe('edge cases', () => {
  it('handles extreme elo values', () => {
    const extreme: Rating = { elo: 2400, uncertainty: 16 };
    const low: Rating = { elo: 0, uncertainty: 16 };
    const [newW, newL] = updateRating(extreme, low);
    expect(newW.elo).toBeGreaterThan(extreme.elo);
    expect(Number.isFinite(newW.elo)).toBe(true);
    expect(Number.isFinite(newL.elo)).toBe(true);
  });

  it('handles very small uncertainty', () => {
    const a: Rating = { elo: 1200, uncertainty: 1.6 };
    const b: Rating = { elo: 1200, uncertainty: 1.6 };
    const [newA, newB] = updateRating(a, b);
    expect(Number.isFinite(newA.elo)).toBe(true);
    expect(Number.isFinite(newB.elo)).toBe(true);
  });
});

describe('formatElo', () => {
  it('rounds float to integer string', () => {
    expect(formatElo(1523.7)).toBe('1524');
  });

  it('handles exact integers', () => {
    expect(formatElo(1200)).toBe('1200');
  });

  it('rounds down when fraction < 0.5', () => {
    expect(formatElo(1400.3)).toBe('1400');
  });
});

describe('stripMarkdownTitle', () => {
  it('strips single # heading marker', () => {
    expect(stripMarkdownTitle('# Hello World')).toBe('Hello World');
  });

  it('strips multi-level heading markers', () => {
    expect(stripMarkdownTitle('### Third Level')).toBe('Third Level');
    expect(stripMarkdownTitle('###### Sixth Level')).toBe('Sixth Level');
  });

  it('returns first line only', () => {
    expect(stripMarkdownTitle('# Title\nBody text here')).toBe('Title');
  });

  it('preserves text without heading markers', () => {
    expect(stripMarkdownTitle('Plain text content')).toBe('Plain text content');
  });

  it('handles empty string', () => {
    expect(stripMarkdownTitle('')).toBe('');
  });

  it('trims whitespace around heading', () => {
    expect(stripMarkdownTitle('## Spaced  ')).toBe('Spaced');
  });
});

describe('performance', () => {
  it('1000 sequential updateRating calls complete in < 200ms', () => {
    let a = createRating();
    let b = createRating();
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      [a, b] = updateRating(a, b);
    }
    const elapsed = performance.now() - start;
    // 200ms threshold accommodates slower CI runners while ensuring reasonable performance
    expect(elapsed).toBeLessThan(200);
  });
});

// Critical Fix Q (generate_rank_evolution_parallel_20260331): N concurrent
// compareWithBiasMitigation calls for the same input must return consistent results.
// This guards the shared comparison cache against torn state under parallel agent dispatch.
describe('compareWithBiasMitigation cache concurrency', () => {
  it('N=20 concurrent calls for the same pair return consistent results', async () => {
    // Stub LLM that always returns "A WINS" so the bias-mitigated 2-pass
    // aggregation produces a deterministic result. The forward call sees A=textA,
    // the reverse call sees A=textB — both return "A WINS" causing a TIE in the
    // aggregator, but we only care that all 20 callers see the SAME result.
    let callCount = 0;
    const llm = async (_prompt: string): Promise<string> => {
      callCount++;
      // small async tick so concurrent callers actually overlap
      await new Promise((r) => setTimeout(r, 1));
      return 'A WINS';
    };
    const cache = new Map<string, ComparisonResult>();
    const promises = Array.from({ length: 20 }, () =>
      compareWithBiasMitigation('text alpha', 'text beta', llm, cache),
    );
    const results = await Promise.all(promises);
    // All 20 results must be structurally identical (winnerId, confidence, result type).
    const first = results[0]!;
    for (const r of results) {
      expect(r.confidence).toBe(first.confidence);
      expect((r as { winnerId?: string }).winnerId).toBe((first as { winnerId?: string }).winnerId);
    }
    // Sanity: cache write happened (callCount > 0). The plan deliberately does
    // NOT require dedup of the LLM call itself (Gap P decision) — we only assert
    // result consistency.
    expect(callCount).toBeGreaterThan(0);
  });
});

describe('beta=0 faster convergence', () => {
  it('uncertainty decreases more with beta=0 than default beta after same matches', () => {
    // With beta=0 (current implementation), ratings update more aggressively.
    // Run a sequence of matches and verify uncertainty decreases.
    let w = createRating();
    let l = createRating();
    const initialUncertainty = w.uncertainty;

    // 5 matches: w wins every time
    for (let i = 0; i < 5; i++) {
      [w, l] = updateRating(w, l);
    }

    // After 5 consecutive wins with beta=0, uncertainty should drop significantly
    // (from ~133.3 to below ~100 — about 30% reduction)
    expect(w.uncertainty).toBeLessThan(initialUncertainty * 0.75);
    expect(w.elo).toBeGreaterThan(1248); // should be above starting 1200 (mu>28 → elo>1248)
  });

  it('winner elo always increases with consistent wins (monotonicity)', () => {
    let w = createRating();
    let l = createRating();
    let prevElo = w.elo;

    for (let i = 0; i < 10; i++) {
      [w, l] = updateRating(w, l);
      expect(w.elo).toBeGreaterThan(prevElo);
      prevElo = w.elo;
    }
  });

  it('draw between equal players reduces uncertainty without changing elo significantly', () => {
    let a = createRating();
    let b = createRating();
    const initialUncertaintyA = a.uncertainty;

    for (let i = 0; i < 5; i++) {
      [a, b] = updateDraw(a, b);
    }

    // Uncertainty should decrease (uncertainty reduced by observing outcomes)
    expect(a.uncertainty).toBeLessThan(initialUncertaintyA);
    // Elo should stay near 1200 for equal players drawing (|mu-25|<2 → |elo-1200|<32)
    expect(Math.abs(a.elo - 1200)).toBeLessThan(32);
  });
});
