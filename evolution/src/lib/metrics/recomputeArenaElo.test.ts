// Unit tests for the pure arena-Elo replay (design_elo_improvement_experiment_20260626).
import {
  replayArenaComparisons,
  replayToWrites,
  type ArenaComparisonRow,
} from './recomputeArenaElo';
import { createRating } from '../shared/computeRatings';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';

describe('replayArenaComparisons', () => {
  it('seeds every entrant with a default rating, even with zero matches', () => {
    const state = replayArenaComparisons([A, B], []);
    expect(state.size).toBe(2);
    const fresh = createRating();
    expect(state.get(A)!.rating).toEqual(fresh);
    expect(state.get(A)!.matchCount).toBe(0);
  });

  it('a decisive win raises the winner and lowers the loser', () => {
    const cmp: ArenaComparisonRow[] = [{ entry_a: A, entry_b: B, winner: 'a', confidence: 1 }];
    const state = replayArenaComparisons([A, B], cmp);
    expect(state.get(A)!.rating.elo).toBeGreaterThan(state.get(B)!.rating.elo);
    expect(state.get(A)!.matchCount).toBe(1);
    expect(state.get(B)!.matchCount).toBe(1);
  });

  it("winner='b' raises B (not A)", () => {
    const cmp: ArenaComparisonRow[] = [{ entry_a: A, entry_b: B, winner: 'b', confidence: 1 }];
    const state = replayArenaComparisons([A, B], cmp);
    expect(state.get(B)!.rating.elo).toBeGreaterThan(state.get(A)!.rating.elo);
  });

  it('confidence===0 is skipped: no rating change AND no match-count increment', () => {
    const cmp: ArenaComparisonRow[] = [{ entry_a: A, entry_b: B, winner: 'a', confidence: 0 }];
    const state = replayArenaComparisons([A, B], cmp);
    expect(state.get(A)!.rating).toEqual(createRating());
    expect(state.get(A)!.matchCount).toBe(0);
    expect(state.get(B)!.matchCount).toBe(0);
  });

  it("winner='draw' and confidence<0.3 both fold as a draw (both counted)", () => {
    const drawState = replayArenaComparisons([A, B], [{ entry_a: A, entry_b: B, winner: 'draw', confidence: 1 }]);
    const lowConfState = replayArenaComparisons([A, B], [{ entry_a: A, entry_b: B, winner: 'a', confidence: 0.2 }]);
    // Both treated as draws → equal ratings (symmetric default start), counted.
    expect(drawState.get(A)!.rating.elo).toBeCloseTo(drawState.get(B)!.rating.elo, 6);
    expect(drawState.get(A)!.matchCount).toBe(1);
    expect(lowConfState.get(A)!.rating.elo).toBeCloseTo(lowConfState.get(B)!.rating.elo, 6);
    expect(lowConfState.get(A)!.matchCount).toBe(1);
  });

  it('is deterministic: same input → identical output', () => {
    const cmp: ArenaComparisonRow[] = [
      { entry_a: A, entry_b: B, winner: 'a', confidence: 1 },
      { entry_a: B, entry_b: C, winner: 'b', confidence: 0.9 },
      { entry_a: A, entry_b: C, winner: 'draw', confidence: 0.8 },
    ];
    const w1 = replayToWrites(replayArenaComparisons([A, B, C], cmp));
    const w2 = replayToWrites(replayArenaComparisons([A, B, C], cmp));
    expect(w1).toEqual(w2);
  });

  it('replayToWrites emits absolute mu/sigma/elo_score + counted matches per entrant', () => {
    const cmp: ArenaComparisonRow[] = [
      { entry_a: A, entry_b: B, winner: 'a', confidence: 1 },
      { entry_a: A, entry_b: B, winner: 'a', confidence: 1 },
    ];
    const writes = replayToWrites(replayArenaComparisons([A, B], cmp));
    const wa = writes.find((w) => w.id === A)!;
    expect(wa.arena_match_count).toBe(2);
    expect(Number.isFinite(wa.mu)).toBe(true);
    expect(Number.isFinite(wa.elo_score)).toBe(true);
  });
});
