// Unit tests for the OpenSkill rating wrapper module.
// Verifies pairwise updates, draws, mu, convergence, backward compat, and performance.

import {
  createRating,
  updateRating,
  updateDraw,
  isConverged,
  eloToRating,
  toEloScale,
  ordinalToEloScale,
  DEFAULT_CONVERGENCE_SIGMA,
  type Rating,
} from './rating';

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
      expect(sigmaHistory[i]).toBeLessThanOrEqual(sigmaHistory[i - 1]);
    }
  });
});

describe('eloToRating (backward compat)', () => {
  it('Elo 1200 maps to mu 25', () => {
    const r = eloToRating(1200);
    expect(r.mu).toBeCloseTo(25, 1);
  });

  it('higher Elo → higher mu', () => {
    const low = eloToRating(1000);
    const mid = eloToRating(1200);
    const high = eloToRating(1400);
    expect(low.mu).toBeLessThan(mid.mu);
    expect(mid.mu).toBeLessThan(high.mu);
  });

  it('preserves relative ordering across a range', () => {
    const elos = [800, 1000, 1200, 1400, 1600, 1800, 2000];
    const ratings = elos.map((e) => eloToRating(e));
    for (let i = 1; i < ratings.length; i++) {
      expect(ratings[i].mu).toBeGreaterThan(ratings[i - 1].mu);
    }
  });

  it('sigma decreases with more matches', () => {
    const fresh = eloToRating(1200, 0);
    const some = eloToRating(1200, 4);
    const many = eloToRating(1200, 8);
    expect(fresh.sigma).toBeGreaterThan(some.sigma);
    expect(some.sigma).toBeGreaterThan(many.sigma);
  });

  it('matchCount=0 uses default sigma', () => {
    const r = eloToRating(1200, 0);
    expect(r.sigma).toBeCloseTo(25 / 3, 1);
  });
});

describe('toEloScale', () => {
  it('fresh rating mu maps to Elo ~1200 + mu*16', () => {
    const r = createRating();
    const eloScale = toEloScale(r.mu);
    // Fresh rating mu ≈ 25 → 1200 + 25*16 = 1600
    expect(eloScale).toBeCloseTo(1600, -1);
  });

  it('mu 0 maps exactly to Elo 1200', () => {
    expect(toEloScale(0)).toBe(1200);
  });

  it('mu 25 maps to Elo 1600', () => {
    expect(toEloScale(25)).toBe(1600);
  });

  it('mu -25 maps to Elo 800', () => {
    expect(toEloScale(-25)).toBe(800);
  });

  it('clamps to [0, 3000]', () => {
    expect(toEloScale(-200)).toBe(0);
    expect(toEloScale(200)).toBe(3000);
  });

  it('round-trip preserves ordering', () => {
    const elos = [900, 1100, 1200, 1300, 1500];
    const mus = elos.map((e) => eloToRating(e, 8).mu);
    const roundTripped = mus.map(toEloScale);
    for (let i = 1; i < roundTripped.length; i++) {
      expect(roundTripped[i]).toBeGreaterThan(roundTripped[i - 1]);
    }
  });
});

describe('ordinalToEloScale backward compat alias', () => {
  it('ordinalToEloScale equals toEloScale', () => {
    expect(ordinalToEloScale(10)).toBe(toEloScale(10));
    expect(ordinalToEloScale(-5)).toBe(toEloScale(-5));
    expect(ordinalToEloScale(0)).toBe(toEloScale(0));
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
