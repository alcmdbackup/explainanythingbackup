// Property-based tests for rating math using fast-check against the real openskill library.
// Validates invariants: uncertainty decrease, finite outputs, monotonicity, symmetry.

jest.unmock('openskill');

import * as fc from 'fast-check';
import {
  updateRating,
  updateDraw,
  toEloScale,
  aggregateWinners,
  DEFAULT_ELO,
} from './computeRatings';
import type { Rating } from './computeRatings';

// Elo scale: elo in [0, 2000] corresponds to mu in [-75, 75] (mu range broader than [0,50] of old test)
// Match old range mu in [0,50], sigma in [0.1,25] → elo in [800,1600], uncertainty in [1.6,400]
const ratingArb = fc.record({
  elo: fc.double({ min: 800, max: 1600, noNaN: true }),
  uncertainty: fc.double({ min: 1.6, max: 400, noNaN: true }),
});

describe('computeRatings property tests', () => {
  describe('updateRating', () => {
    it('uncertainty decreases for both players after a decisive match (uncertainty >= 16)', () => {
      // OpenSkill's sigma can increase for extremely low sigma values (convergence floor).
      // Use uncertainty >= 16 (sigma >= 1) to match realistic pipeline conditions.
      const realisticRating = fc.record({
        elo: fc.double({ min: 800, max: 1600, noNaN: true }),
        uncertainty: fc.double({ min: 16, max: 400, noNaN: true }),
      });
      fc.assert(
        fc.property(realisticRating, realisticRating, (winner: Rating, loser: Rating) => {
          const [newWinner, newLoser] = updateRating(winner, loser);
          expect(newWinner.uncertainty).toBeLessThanOrEqual(winner.uncertainty);
          expect(newLoser.uncertainty).toBeLessThanOrEqual(loser.uncertainty);
        }),
        { numRuns: 100 },
      );
    });

    it('outputs are always finite', () => {
      fc.assert(
        fc.property(ratingArb, ratingArb, (winner: Rating, loser: Rating) => {
          const [newWinner, newLoser] = updateRating(winner, loser);
          expect(Number.isFinite(newWinner.elo)).toBe(true);
          expect(Number.isFinite(newWinner.uncertainty)).toBe(true);
          expect(Number.isFinite(newLoser.elo)).toBe(true);
          expect(Number.isFinite(newLoser.uncertainty)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('updateDraw', () => {
    it('is symmetric: swapping args swaps results', () => {
      fc.assert(
        fc.property(ratingArb, ratingArb, (a: Rating, b: Rating) => {
          const [newA, newB] = updateDraw(a, b);
          const [newB2, newA2] = updateDraw(b, a);
          expect(newA.elo).toBeCloseTo(newA2.elo, 8);
          expect(newA.uncertainty).toBeCloseTo(newA2.uncertainty, 8);
          expect(newB.elo).toBeCloseTo(newB2.elo, 8);
          expect(newB.uncertainty).toBeCloseTo(newB2.uncertainty, 8);
        }),
        { numRuns: 100 },
      );
    });

    it('both uncertainties decrease (uncertainty >= 16)', () => {
      const realisticRating = fc.record({
        elo: fc.double({ min: 800, max: 1600, noNaN: true }),
        uncertainty: fc.double({ min: 16, max: 400, noNaN: true }),
      });
      fc.assert(
        fc.property(realisticRating, realisticRating, (a: Rating, b: Rating) => {
          const [newA, newB] = updateDraw(a, b);
          expect(newA.uncertainty).toBeLessThanOrEqual(a.uncertainty);
          expect(newB.uncertainty).toBeLessThanOrEqual(b.uncertainty);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('toEloScale', () => {
    it('is monotonically increasing', () => {
      fc.assert(
        fc.property(
          fc.double({ min: -100, max: 200, noNaN: true }),
          fc.double({ min: -100, max: 200, noNaN: true }),
          (a: number, b: number) => {
            if (a < b) {
              expect(toEloScale(a)).toBeLessThanOrEqual(toEloScale(b));
            } else if (a > b) {
              expect(toEloScale(a)).toBeGreaterThanOrEqual(toEloScale(b));
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('output is in range [0, 3000]', () => {
      fc.assert(
        fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (mu: number) => {
          const elo = toEloScale(mu);
          expect(elo).toBeGreaterThanOrEqual(0);
          expect(elo).toBeLessThanOrEqual(3000);
        }),
        { numRuns: 100 },
      );
    });

    it('mu=25 maps to DEFAULT_ELO (1200)', () => {
      expect(toEloScale(25)).toBe(DEFAULT_ELO);
    });
  });

  describe('aggregateWinners', () => {
    it('agreement yields confidence 1.0', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('A', 'B', 'TIE'),
          (winner: string) => {
            // Forward and reverse agree (reverse is in flipped frame, so same original-frame value)
            const reverseFrame = winner === 'A' ? 'B' : winner === 'B' ? 'A' : 'TIE';
            const result = aggregateWinners(winner, reverseFrame);
            expect(result.confidence).toBe(1.0);
            expect(result.winner).toBe(winner);
          },
        ),
      );
    });

    it('both null yields TIE with confidence 0.0', () => {
      const result = aggregateWinners(null, null);
      expect(result.winner).toBe('TIE');
      expect(result.confidence).toBe(0.0);
    });

    it('output shape is always valid', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('A', 'B', 'TIE', null),
          fc.constantFrom('A', 'B', 'TIE', null),
          (forward: string | null, reverse: string | null) => {
            const result = aggregateWinners(forward, reverse);
            expect(['A', 'B', 'TIE']).toContain(result.winner);
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
            expect(result.turns).toBe(2);
          },
        ),
      );
    });
  });

  describe('beta=0 convergence', () => {
    it('winner elo monotonically increases over N consecutive wins', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 20 }),
          (matchCount: number) => {
            let w: Rating = { elo: DEFAULT_ELO, uncertainty: 400 / 3 };
            let l: Rating = { elo: DEFAULT_ELO, uncertainty: 400 / 3 };
            let prevElo = w.elo;
            for (let i = 0; i < matchCount; i++) {
              [w, l] = updateRating(w, l);
              expect(w.elo).toBeGreaterThan(prevElo);
              prevElo = w.elo;
            }
          },
        ),
      );
    });
  });
});
