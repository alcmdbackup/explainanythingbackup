// Verdict orientation + canonical-pair helpers for weight inference. A pair is stored
// in canonical order (article_a_id < article_b_id); when the human/LLM saw the articles
// swapped, the raw on-screen verdict is flipped into the canonical frame on save.

import type { Verdict3 } from './types';

/**
 * Flip a 3-valued verdict between presentation frames: a<->b, tie unchanged.
 * Named `flipPairVerdict` (NOT `flipVerdict`) to avoid a collision with
 * rubricJudge.flipVerdict, which operates on uppercase 'A'|'B'|'TIE'.
 */
export function flipPairVerdict(v: Verdict3): Verdict3 {
  if (v === 'a') return 'b';
  if (v === 'b') return 'a';
  return 'tie';
}

/** Apply the flip iff the articles were shown swapped (canonical-orient on save). */
export function orientToCanonical(raw: Verdict3, shownSwapped: boolean): Verdict3 {
  return shownSwapped ? flipPairVerdict(raw) : raw;
}

/**
 * Canonical ordering of two article ids: smaller id is `a`, larger is `b`.
 * `swapped` is true when the FIRST argument (the one shown as on-screen "A")
 * is the canonical `b` — i.e. the on-screen order is reversed vs canonical.
 * Matches the DB CHECK (article_a_id < article_b_id) using lowercase-UUID string
 * order (== Postgres uuid order).
 */
export function canonicalizePair(
  shownLeftId: string,
  shownRightId: string,
): { aId: string; bId: string; shownSwapped: boolean } {
  if (shownLeftId === shownRightId) {
    throw new Error('canonicalizePair: a pair must have two distinct articles');
  }
  if (shownLeftId < shownRightId) {
    return { aId: shownLeftId, bId: shownRightId, shownSwapped: false };
  }
  return { aId: shownRightId, bId: shownLeftId, shownSwapped: true };
}

/** Map a canonical verdict to a signed feature: a=+1 (favors A), b=-1, tie=0. */
export function verdictToSign(v: Verdict3): 1 | -1 | 0 {
  if (v === 'a') return 1;
  if (v === 'b') return -1;
  return 0;
}

/** Map a signed score to a verdict: >0 -> a, <0 -> b, 0 -> tie. */
export function signToVerdict(score: number): Verdict3 {
  if (score > 0) return 'a';
  if (score < 0) return 'b';
  return 'tie';
}
