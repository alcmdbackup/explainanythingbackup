// Unit tests for the unified selectWinner function — highest mu, sigma tiebreak,
// unrated handling, empty pool, and all-unrated fallback.

import { selectWinner } from './selectWinner';
import type { Rating } from './computeRatings';

describe('selectWinner', () => {
  it('selects the variant with highest mu', () => {
    const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const ratings = new Map<string, Rating>([
      ['a', { mu: 20, sigma: 5 }],
      ['b', { mu: 30, sigma: 5 }],
      ['c', { mu: 25, sigma: 5 }],
    ]);
    const result = selectWinner(pool, ratings);
    expect(result.winnerId).toBe('b');
    expect(result.mu).toBe(30);
    expect(result.sigma).toBe(5);
  });

  it('breaks ties by lowest sigma', () => {
    const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const ratings = new Map<string, Rating>([
      ['a', { mu: 25, sigma: 8 }],
      ['b', { mu: 25, sigma: 3 }],
      ['c', { mu: 25, sigma: 5 }],
    ]);
    const result = selectWinner(pool, ratings);
    expect(result.winnerId).toBe('b');
    expect(result.sigma).toBe(3);
  });

  it('treats unrated variants as mu=-Infinity, sigma=Infinity', () => {
    const pool = [{ id: 'a' }, { id: 'b' }];
    const ratings = new Map<string, Rating>([
      ['a', { mu: 10, sigma: 8 }],
      // 'b' is unrated
    ]);
    const result = selectWinner(pool, ratings);
    expect(result.winnerId).toBe('a');
    expect(result.mu).toBe(10);
  });

  it('falls back to first variant when all are unrated', () => {
    const pool = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
    const ratings = new Map<string, Rating>();
    const result = selectWinner(pool, ratings);
    // All have mu=-Infinity; first one wins (stable)
    expect(result.winnerId).toBe('x');
    expect(result.mu).toBe(-Infinity);
    expect(result.sigma).toBe(Infinity);
  });

  it('throws on empty pool', () => {
    const ratings = new Map<string, Rating>();
    expect(() => selectWinner([], ratings)).toThrow('selectWinner: pool must not be empty');
  });

  it('works with single variant', () => {
    const pool = [{ id: 'only' }];
    const ratings = new Map<string, Rating>([['only', { mu: 25, sigma: 8.333 }]]);
    const result = selectWinner(pool, ratings);
    expect(result.winnerId).toBe('only');
    expect(result.mu).toBe(25);
  });

  it('postcondition: winner.mu >= all rated variants mu', () => {
    const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const ratings = new Map<string, Rating>([
      ['a', { mu: 15, sigma: 5 }],
      ['b', { mu: 30, sigma: 3 }],
      ['c', { mu: 25, sigma: 4 }],
      // 'd' unrated
    ]);
    const result = selectWinner(pool, ratings);
    for (const [, r] of ratings) {
      expect(result.mu).toBeGreaterThanOrEqual(r.mu);
    }
  });
});
