// OpenSkill (Weng-Lin Bayesian) rating wrapper for the evolution pipeline.
// Replaces Elo with {mu, sigma} ratings that provide proper uncertainty tracking.

import { rating as osRating, rate as osRate } from 'openskill';

// ─── Types ──────────────────────────────────────────────────────

/** Bayesian rating with skill estimate (mu) and uncertainty (sigma). */
export type Rating = { mu: number; sigma: number };

// ─── Default constants ──────────────────────────────────────────

/** Default mu for a fresh rating (openskill default). */
export const DEFAULT_MU = 25;

/** Scale factor for converting sigma to Elo-scale uncertainty. */
export const ELO_SIGMA_SCALE = 400 / DEFAULT_MU;

/** Default sigma for a fresh rating (openskill default). */
export const DEFAULT_SIGMA = 25 / 3; // ≈ 8.333

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
 * Map a mu value to the 0-3000 Elo scale for DB compat.
 * Fresh rating mu (25) maps to Elo 1200.
 * Formula: 1200 + (mu - 25) * 16, clamped to [0, 3000].
 */
export function toEloScale(mu: number): number {
  return Math.max(0, Math.min(3000, 1200 + (mu - DEFAULT_MU) * (400 / DEFAULT_MU)));
}

// ─── Arena shared constants ──────────────────────────────

/** Confidence threshold above which a comparison is treated as decisive (win/loss) vs draw. */
export const DECISIVE_CONFIDENCE_THRESHOLD = 0.6;

/** Derive elo_per_dollar from mu for backward-compat display. Returns null if cost is missing or zero. */
export function computeEloPerDollar(mu: number, totalCostUsd: number | null): number | null {
  if (!totalCostUsd) return null;
  return (toEloScale(mu) - 1200) / totalCostUsd;
}
