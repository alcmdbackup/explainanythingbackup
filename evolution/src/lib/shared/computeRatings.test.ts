// Unit tests for the OpenSkill rating wrapper module.
// Verifies pairwise updates, draws, mu, convergence, backward compat, and performance.

import {
  createRating,
  updateRating,
  updateDraw,
  isConverged,
  toEloScale,
  formatElo,
  stripMarkdownTitle,
  DEFAULT_CONVERGENCE_SIGMA,
  type Rating,
} from './computeRatings';

describe('createRating', () => {
  it('returns default mu ≈ 25 and sigma ≈ 8.333', () => {
    const r = createRating();
    expect(r.mu).toBeCloseTo(25, 0);
    expect(r.sigma).toBeCloseTo(25 / 3, 1);
  });
});

describe('updateRating', () => {
  it('winner mu increases, loser mu decreases', () => {
    const w = createRating();
    const l = createRating();
    const [newW, newL] = updateRating(w, l);
    expect(newW.mu).toBeGreaterThan(w.mu);
    expect(newL.mu).toBeLessThan(l.mu);
  });

  it('both sigmas shrink after match', () => {
    const w = createRating();
    const l = createRating();
    const [newW, newL] = updateRating(w, l);
    expect(newW.sigma).toBeLessThan(w.sigma);
    expect(newL.sigma).toBeLessThan(l.sigma);
  });

  it('stronger player wins → smaller mu shift than equal match', () => {
    const strong: Rating = { mu: 35, sigma: 4 };
    const weak: Rating = { mu: 15, sigma: 4 };
    const [newStrong] = updateRating(strong, weak);
    // Expected win → small mu gain
    expect(newStrong.mu - strong.mu).toBeLessThan(2);
  });

  it('upset (weak beats strong) → larger mu shift', () => {
    const strong: Rating = { mu: 35, sigma: 4 };
    const weak: Rating = { mu: 15, sigma: 4 };
    const [newWeak] = updateRating(weak, strong);
    // Upset → larger mu gain than expected win
    const [newStrong2] = updateRating(strong, weak);
    expect(newWeak.mu - weak.mu).toBeGreaterThan(newStrong2.mu - strong.mu);
  });
});

describe('updateDraw', () => {
  it('equal players: draw does not significantly change mu', () => {
    const a = createRating();
    const b = createRating();
    const [newA, newB] = updateDraw(a, b);
    expect(Math.abs(newA.mu - a.mu)).toBeLessThan(1);
    expect(Math.abs(newB.mu - b.mu)).toBeLessThan(1);
  });

  it('unequal players: draw moves both toward each other', () => {
    const high: Rating = { mu: 35, sigma: 5 };
    const low: Rating = { mu: 15, sigma: 5 };
    const [newHigh, newLow] = updateDraw(high, low);
    expect(newHigh.mu).toBeLessThan(high.mu);
    expect(newLow.mu).toBeGreaterThan(low.mu);
  });

  it('both sigmas shrink after draw', () => {
    const a = createRating();
    const b = createRating();
    const [newA, newB] = updateDraw(a, b);
    expect(newA.sigma).toBeLessThan(a.sigma);
    expect(newB.sigma).toBeLessThan(b.sigma);
  });
});

describe('mu-based ranking', () => {
  it('higher mu means higher skill (sigma irrelevant for ranking)', () => {
    const low: Rating = { mu: 20, sigma: 3 };
    const high: Rating = { mu: 30, sigma: 3 };
    expect(high.mu).toBeGreaterThan(low.mu);
  });

  it('fresh rating has mu = 25', () => {
    const r = createRating();
    expect(r.mu).toBeCloseTo(25, 0);
  });
});

describe('isConverged', () => {
  it('returns false for fresh rating', () => {
    expect(isConverged(createRating())).toBe(false);
  });

  it('returns true when sigma < default threshold', () => {
    expect(isConverged({ mu: 25, sigma: 2.5 })).toBe(true);
  });

  it('respects custom threshold', () => {
    expect(isConverged({ mu: 25, sigma: 4 }, 5)).toBe(true);
    expect(isConverged({ mu: 25, sigma: 4 }, 3)).toBe(false);
  });

  it('DEFAULT_CONVERGENCE_SIGMA is 3.0', () => {
    expect(DEFAULT_CONVERGENCE_SIGMA).toBe(3.0);
  });
});

describe('sigma convergence over multiple matches', () => {
  it('sigma monotonically decreases with consecutive matches', () => {
    let a = createRating();
    let b = createRating();
    const sigmaHistory: number[] = [a.sigma];

    for (let i = 0; i < 10; i++) {
      [a, b] = updateRating(a, b);
      sigmaHistory.push(a.sigma);
    }

    // Each sigma should be less than or equal to previous
    for (let i = 1; i < sigmaHistory.length; i++) {
      expect(sigmaHistory[i]!).toBeLessThanOrEqual(sigmaHistory[i - 1]!);
    }
  });
});

describe('toEloScale', () => {
  it('fresh rating mu (25) maps to Elo 1200', () => {
    const r = createRating();
    const eloScale = toEloScale(r.mu);
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


describe('mu-based Elo is always inside 95% CI', () => {
  it('toEloScale(mu) is between ci_lower and ci_upper for various ratings', () => {
    const testCases: Rating[] = [
      { mu: 25, sigma: 8.333 },  // fresh
      { mu: 28, sigma: 3 },      // converged winner
      { mu: 22, sigma: 7 },      // uncertain
      { mu: 35, sigma: 2 },      // strong converged
      { mu: 15, sigma: 5 },      // below average
    ];
    for (const r of testCases) {
      const displayElo = toEloScale(r.mu);
      const ciLower = toEloScale(r.mu - 1.96 * r.sigma);
      const ciUpper = toEloScale(r.mu + 1.96 * r.sigma);
      expect(displayElo).toBeGreaterThanOrEqual(ciLower);
      expect(displayElo).toBeLessThanOrEqual(ciUpper);
    }
  });
});

describe('edge cases', () => {
  it('handles extreme mu values', () => {
    const extreme: Rating = { mu: 100, sigma: 1 };
    const low: Rating = { mu: -50, sigma: 1 };
    const [newW, newL] = updateRating(extreme, low);
    expect(newW.mu).toBeGreaterThan(extreme.mu);
    expect(Number.isFinite(newW.mu)).toBe(true);
    expect(Number.isFinite(newL.mu)).toBe(true);
  });

  it('handles very small sigma', () => {
    const a: Rating = { mu: 25, sigma: 0.1 };
    const b: Rating = { mu: 25, sigma: 0.1 };
    const [newA, newB] = updateRating(a, b);
    expect(Number.isFinite(newA.mu)).toBe(true);
    expect(Number.isFinite(newB.mu)).toBe(true);
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
