// Unit tests for the unified selectWinner function — highest elo, uncertainty tiebreak,
// unrated handling, empty pool, and all-unrated fallback.

import { selectWinner, NoRatedCandidatesError } from './selectWinner';
import type { Rating } from './computeRatings';

describe('selectWinner', () => {
  it('selects the variant with highest elo', () => {
    const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const ratings = new Map<string, Rating>([
      ['a', { elo: 1120, uncertainty: 80 }],
      ['b', { elo: 1280, uncertainty: 80 }],
      ['c', { elo: 1200, uncertainty: 80 }],
    ]);
    const result = selectWinner(pool, ratings);
    expect(result.winnerId).toBe('b');
    expect(result.elo).toBe(1280);
    expect(result.uncertainty).toBe(80);
  });

  it('breaks ties by lowest uncertainty', () => {
    const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const ratings = new Map<string, Rating>([
      ['a', { elo: 1200, uncertainty: 128 }],
      ['b', { elo: 1200, uncertainty: 48 }],
      ['c', { elo: 1200, uncertainty: 80 }],
    ]);
    const result = selectWinner(pool, ratings);
    expect(result.winnerId).toBe('b');
    expect(result.uncertainty).toBe(48);
  });

  it('treats unrated variants as elo=-Infinity, uncertainty=Infinity', () => {
    const pool = [{ id: 'a' }, { id: 'b' }];
    const ratings = new Map<string, Rating>([
      ['a', { elo: 960, uncertainty: 128 }],
      // 'b' is unrated
    ]);
    const result = selectWinner(pool, ratings);
    expect(result.winnerId).toBe('a');
    expect(result.elo).toBe(960);
  });

  it('B035: throws NoRatedCandidatesError when all are unrated', () => {
    const pool = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
    const ratings = new Map<string, Rating>();
    // B035: returning an ±Infinity winner masked a ratings-pipeline bug upstream.
    // Callers must handle this explicitly.
    expect(() => selectWinner(pool, ratings)).toThrow(NoRatedCandidatesError);
  });

  it('throws on empty pool', () => {
    const ratings = new Map<string, Rating>();
    expect(() => selectWinner([], ratings)).toThrow('selectWinner: pool must not be empty');
  });

  it('works with single variant', () => {
    const pool = [{ id: 'only' }];
    const ratings = new Map<string, Rating>([['only', { elo: 1200, uncertainty: 400 / 3 }]]);
    const result = selectWinner(pool, ratings);
    expect(result.winnerId).toBe('only');
    expect(result.elo).toBe(1200);
  });

  it('postcondition: winner.elo >= all rated variants elo', () => {
    const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const ratings = new Map<string, Rating>([
      ['a', { elo: 1040, uncertainty: 80 }],
      ['b', { elo: 1280, uncertainty: 48 }],
      ['c', { elo: 1200, uncertainty: 64 }],
      // 'd' unrated
    ]);
    const result = selectWinner(pool, ratings);
    for (const [, r] of ratings) {
      expect(result.elo).toBeGreaterThanOrEqual(r.elo);
    }
  });
});
