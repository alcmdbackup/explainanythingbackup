// Property-based tests for rating math using fast-check against the real openskill library.
// Validates invariants: sigma decrease, finite outputs, monotonicity, symmetry.

jest.unmock('openskill');

import * as fc from 'fast-check';
import {
  updateRating,
  updateDraw,
  toEloScale,
  aggregateWinners,
  DEFAULT_MU,
} from './computeRatings';
import type { Rating } from './computeRatings';

const ratingArb = fc.record({
  mu: fc.double({ min: 0, max: 50, noNaN: true }),
  sigma: fc.double({ min: 0.1, max: 25, noNaN: true }),
});

describe('computeRatings property tests', () => {
  describe('updateRating', () => {
    it('sigma decreases for both players after a decisive match (sigma >= 1)', () => {
      // OpenSkill's sigma can increase for extremely low sigma values (convergence floor).
      // Use sigma >= 1 to match realistic pipeline conditions.
      const realisticRating = fc.record({
        mu: fc.double({ min: 0, max: 50, noNaN: true }),
        sigma: fc.double({ min: 1, max: 25, noNaN: true }),
      });
      fc.assert(
        fc.property(realisticRating, realisticRating, (winner: Rating, loser: Rating) => {
          const [newWinner, newLoser] = updateRating(winner, loser);
          expect(newWinner.sigma).toBeLessThanOrEqual(winner.sigma);
          expect(newLoser.sigma).toBeLessThanOrEqual(loser.sigma);
        }),
        { numRuns: 100 },
      );
    });

    it('outputs are always finite', () => {
      fc.assert(
        fc.property(ratingArb, ratingArb, (winner: Rating, loser: Rating) => {
          const [newWinner, newLoser] = updateRating(winner, loser);
          expect(Number.isFinite(newWinner.mu)).toBe(true);
          expect(Number.isFinite(newWinner.sigma)).toBe(true);
          expect(Number.isFinite(newLoser.mu)).toBe(true);
          expect(Number.isFinite(newLoser.sigma)).toBe(true);
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
          expect(newA.mu).toBeCloseTo(newA2.mu, 10);
          expect(newA.sigma).toBeCloseTo(newA2.sigma, 10);
          expect(newB.mu).toBeCloseTo(newB2.mu, 10);
          expect(newB.sigma).toBeCloseTo(newB2.sigma, 10);
        }),
        { numRuns: 100 },
      );
    });

    it('both sigmas decrease (sigma >= 1)', () => {
      const realisticRating = fc.record({
        mu: fc.double({ min: 0, max: 50, noNaN: true }),
        sigma: fc.double({ min: 1, max: 25, noNaN: true }),
      });
      fc.assert(
        fc.property(realisticRating, realisticRating, (a: Rating, b: Rating) => {
          const [newA, newB] = updateDraw(a, b);
          expect(newA.sigma).toBeLessThanOrEqual(a.sigma);
          expect(newB.sigma).toBeLessThanOrEqual(b.sigma);
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

    it('DEFAULT_MU maps to 1200', () => {
      expect(toEloScale(DEFAULT_MU)).toBe(1200);
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
});
