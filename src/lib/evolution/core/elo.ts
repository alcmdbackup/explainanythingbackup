// Stateless Elo rating update functions for pairwise variant comparison.
// Used by CalibrationRanker (Phase 1) and Tournament (Phase 2).

import type { PipelineState } from '../types';
import { ELO_CONSTANTS, K_SCHEDULE } from '../config';

/** Get adaptive K-factor based on match count history. */
export function getAdaptiveK(matchCount: number): number {
  for (const { maxMatches, k } of K_SCHEDULE) {
    if (matchCount < maxMatches) return k;
  }
  return 16;
}

/** Standard Elo update after a decisive match. Returns [newWinnerRating, newLoserRating]. */
export function updateEloRatings(
  state: PipelineState,
  winnerId: string,
  loserId: string,
  kFactor: number = ELO_CONSTANTS.DEFAULT_K,
): [number, number] {
  const rw = state.eloRatings.get(winnerId) ?? ELO_CONSTANTS.INITIAL_RATING;
  const rl = state.eloRatings.get(loserId) ?? ELO_CONSTANTS.INITIAL_RATING;

  const ew = 1 / (1 + 10 ** ((rl - rw) / 400));
  const el = 1 - ew;

  const newRw = Math.max(ELO_CONSTANTS.FLOOR, rw + kFactor * (1 - ew));
  const newRl = Math.max(ELO_CONSTANTS.FLOOR, rl + kFactor * (0 - el));

  state.eloRatings.set(winnerId, newRw);
  state.eloRatings.set(loserId, newRl);
  state.matchCounts.set(winnerId, (state.matchCounts.get(winnerId) ?? 0) + 1);
  state.matchCounts.set(loserId, (state.matchCounts.get(loserId) ?? 0) + 1);

  return [newRw, newRl];
}

/** Elo update for a draw (both get 0.5 score). Returns [newRatingA, newRatingB]. */
export function updateEloDraw(
  state: PipelineState,
  idA: string,
  idB: string,
  kFactor: number = ELO_CONSTANTS.DEFAULT_K,
): [number, number] {
  const ra = state.eloRatings.get(idA) ?? ELO_CONSTANTS.INITIAL_RATING;
  const rb = state.eloRatings.get(idB) ?? ELO_CONSTANTS.INITIAL_RATING;

  const ea = 1 / (1 + 10 ** ((rb - ra) / 400));
  const eb = 1 - ea;

  const newRa = Math.max(ELO_CONSTANTS.FLOOR, ra + kFactor * (0.5 - ea));
  const newRb = Math.max(ELO_CONSTANTS.FLOOR, rb + kFactor * (0.5 - eb));

  state.eloRatings.set(idA, newRa);
  state.eloRatings.set(idB, newRb);
  state.matchCounts.set(idA, (state.matchCounts.get(idA) ?? 0) + 1);
  state.matchCounts.set(idB, (state.matchCounts.get(idB) ?? 0) + 1);

  return [newRa, newRb];
}

/** Confidence-weighted Elo update. Lower confidence blends toward draw. */
export function updateEloWithConfidence(
  state: PipelineState,
  winnerId: string,
  loserId: string,
  confidence: number,
  kFactor: number = ELO_CONSTANTS.DEFAULT_K,
): [number, number] {
  const rw = state.eloRatings.get(winnerId) ?? ELO_CONSTANTS.INITIAL_RATING;
  const rl = state.eloRatings.get(loserId) ?? ELO_CONSTANTS.INITIAL_RATING;

  const ew = 1 / (1 + 10 ** ((rl - rw) / 400));
  const el = 1 - ew;

  // Blend toward draw: confidence=1 → decisive, confidence=0 → draw
  const actualW = 0.5 + 0.5 * confidence;
  const actualL = 0.5 - 0.5 * confidence;

  const newRw = Math.max(ELO_CONSTANTS.FLOOR, rw + kFactor * (actualW - ew));
  const newRl = Math.max(ELO_CONSTANTS.FLOOR, rl + kFactor * (actualL - el));

  state.eloRatings.set(winnerId, newRw);
  state.eloRatings.set(loserId, newRl);
  state.matchCounts.set(winnerId, (state.matchCounts.get(winnerId) ?? 0) + 1);
  state.matchCounts.set(loserId, (state.matchCounts.get(loserId) ?? 0) + 1);

  return [newRw, newRl];
}
