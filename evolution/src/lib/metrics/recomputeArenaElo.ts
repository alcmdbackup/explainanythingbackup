// Pure, deterministic replay of an arena's match log into per-variant ratings.
// design_elo_improvement_experiment_20260626 Decision F: the canonical source of
// truth for arena ratings is the durable evolution_arena_comparisons log; this
// module rebuilds mu/sigma/elo_score/arena_match_count from it, immune to the
// concurrent-sync race (it ignores the cached row values entirely). Mirrors the
// live path EXACTLY: confidence===0 skipped (no update, no count); draw on
// winner==='draw' || confidence<0.3; otherwise decisive updateRating. The CLI
// wrapper lives in scripts/recompute-arena-elo.ts.

import {
  createRating,
  updateRating,
  updateDraw,
  ratingToDb,
  type Rating,
} from '../shared/computeRatings';

/** One arena comparison row, reduced to the fields needed to replay it. */
export interface ArenaComparisonRow {
  entry_a: string;
  entry_b: string;
  winner: 'a' | 'b' | 'draw';
  confidence: number;
}

export interface ReplayedEntrant {
  rating: Rating;
  matchCount: number;
}

/**
 * Replay all comparisons (in the caller's order — use a deterministic
 * `ORDER BY created_at, id`) onto fresh default ratings for the given entrants.
 *
 * @param entrantIds Seed the entrant set from evolution_variants so a variant
 *   that played zero non-failed matches still gets a clean default rating.
 * @param comparisons Match log in deterministic order.
 */
export function replayArenaComparisons(
  entrantIds: readonly string[],
  comparisons: readonly ArenaComparisonRow[],
): Map<string, ReplayedEntrant> {
  const state = new Map<string, ReplayedEntrant>();
  const ensure = (id: string): ReplayedEntrant => {
    let e = state.get(id);
    if (!e) {
      e = { rating: createRating(), matchCount: 0 };
      state.set(id, e);
    }
    return e;
  };

  for (const id of entrantIds) ensure(id);

  for (const c of comparisons) {
    // Skip failed comparisons — mirror MergeRatingsAgent (confidence===0 => no
    // update) AND syncToArena's match tally (only confidence>0 counts).
    if (c.confidence === 0) continue;

    const a = ensure(c.entry_a);
    const b = ensure(c.entry_b);
    const isDraw = c.winner === 'draw' || c.confidence < 0.3;

    if (isDraw) {
      const [na, nb] = updateDraw(a.rating, b.rating);
      a.rating = na;
      b.rating = nb;
    } else if (c.winner === 'a') {
      const [na, nb] = updateRating(a.rating, b.rating);
      a.rating = na;
      b.rating = nb;
    } else {
      // winner === 'b'
      const [nb, na] = updateRating(b.rating, a.rating);
      a.rating = na;
      b.rating = nb;
    }
    a.matchCount += 1;
    b.matchCount += 1;
  }

  return state;
}

export interface ArenaEloWrite {
  id: string;
  mu: number;
  sigma: number;
  elo_score: number;
  arena_match_count: number;
}

/** Convert replay state into absolute DB writes (arena_match_count is SET, not
 *  additive — recompute is authoritative + idempotent). */
export function replayToWrites(state: Map<string, ReplayedEntrant>): ArenaEloWrite[] {
  const writes: ArenaEloWrite[] = [];
  for (const [id, e] of state) {
    const db = ratingToDb(e.rating);
    writes.push({
      id,
      mu: db.mu,
      sigma: db.sigma,
      elo_score: db.elo_score,
      arena_match_count: e.matchCount,
    });
  }
  return writes;
}
