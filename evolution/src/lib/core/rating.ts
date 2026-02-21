// OpenSkill (Weng-Lin Bayesian) rating wrapper for the evolution pipeline.
// Replaces Elo with {mu, sigma} ratings that provide proper uncertainty tracking.

import { rating as osRating, rate as osRate, ordinal as osOrdinal } from 'openskill';

// ─── Types ──────────────────────────────────────────────────────

/** Bayesian rating with skill estimate (mu) and uncertainty (sigma). */
export type Rating = { mu: number; sigma: number };

// ─── Default constants ──────────────────────────────────────────

/** Default mu for a fresh rating (openskill default). */
const DEFAULT_MU = 25;

/** Default sigma for a fresh rating (openskill default). */
const DEFAULT_SIGMA = 25 / 3; // ≈ 8.333

/** Sigma threshold below which a rating is considered converged. */
export const DEFAULT_CONVERGENCE_SIGMA = 3.0;

// ─── Core rating operations ─────────────────────────────────────

/** Create a fresh rating with default mu/sigma. */
export function createRating(): Rating {
  return osRating();
}

/**
 * Update ratings after a decisive match. Returns [newWinner, newLoser].
 * Both players' sigma decreases (uncertainty reduced by observing outcome).
 */
export function updateRating(winner: Rating, loser: Rating): [Rating, Rating] {
  const [[w], [l]] = osRate([[winner], [loser]], { rank: [1, 2] });
  return [w, l];
}

/**
 * Update ratings after a draw. Returns [newA, newB].
 * Both players move toward each other slightly, sigma decreases.
 */
export function updateDraw(a: Rating, b: Rating): [Rating, Rating] {
  const [[newA], [newB]] = osRate([[a], [b]], { rank: [1, 1] });
  return [newA, newB];
}

/**
 * Conservative skill estimate: mu - 3*sigma.
 * Penalizes high uncertainty — a variant must prove itself through matches.
 */
export function getOrdinal(r: Rating): number {
  return osOrdinal(r);
}

/** Check if a rating has converged (sigma below threshold). */
export function isConverged(r: Rating, threshold: number = DEFAULT_CONVERGENCE_SIGMA): boolean {
  return r.sigma < threshold;
}

// ─── Backward compatibility helpers ─────────────────────────────

/**
 * Convert an old Elo rating to a {mu, sigma} Rating.
 * mu maps linearly: Elo 1200 → mu 25, scaled by 25/400.
 * sigma is derived from matchCount: more matches → lower sigma (more certainty).
 */
export function eloToRating(elo: number, matchCount: number = 0): Rating {
  const mu = DEFAULT_MU + (elo - 1200) * (DEFAULT_MU / 400);
  const sigma = matchCount >= 8 ? 3.0 : matchCount >= 4 ? 5.0 : DEFAULT_SIGMA;
  return { mu, sigma };
}

/**
 * Map an ordinal value back to the 0-3000 Elo scale for DB compat.
 * Fresh rating ordinal (≈ 0) maps to Elo 1200.
 * Formula: 1200 + ordinal * (400/25), clamped to [0, 3000].
 */
export function ordinalToEloScale(ord: number): number {
  return Math.max(0, Math.min(3000, 1200 + ord * (400 / DEFAULT_MU)));
}

// ─── Hall of Fame shared constants ──────────────────────────────

/** Confidence threshold above which a comparison is treated as decisive (win/loss) vs draw. */
export const DECISIVE_CONFIDENCE_THRESHOLD = 0.6;

/** Derive elo_per_dollar from ordinal for backward-compat display. */
export function computeEloPerDollar(ordinal: number, totalCostUsd: number | null): number | null {
  if (totalCostUsd === null || totalCostUsd === 0) return null;
  return (ordinalToEloScale(ordinal) - 1200) / totalCostUsd;
}
