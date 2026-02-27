// Creator-based Elo attribution: computes per-variant and per-agent Elo gains
// by comparing each variant's rating to the average of its parents' ratings.

import type { AgentAttribution, EloAttribution, TextVariation } from '../types';
import { getAgentForStrategy } from './metricsWriter';
import type { Rating } from './rating';
import { createRating } from './rating';

// ─── Constants ──────────────────────────────────────────────────

/** Default mu for a fresh rating (matches openskill default). */
const DEFAULT_MU = createRating().mu;

/** Scale factor to convert OpenSkill mu-space deltas to Elo-like numbers. */
const ELO_SCALE = 400 / DEFAULT_MU;

// ─── Per-variant attribution ────────────────────────────────────

/**
 * Compute Elo attribution for a single variant relative to its parents.
 * - 0 parents: gain = (variant.mu - DEFAULT_MU) * ELO_SCALE
 * - N parents: gain = (variant.mu - avgParentMu) * ELO_SCALE
 * CI uses quadrature: sqrt(variant.sigma² + avgParentSigma²) * 1.96 * ELO_SCALE
 */
export function computeEloAttribution(
  variantRating: Rating,
  parentRatings: Rating[],
): EloAttribution {
  const parentCount = parentRatings.length;

  let avgParentMu: number;
  let avgParentSigma2: number;

  if (parentCount === 0) {
    // No parents — attribute relative to default rating
    avgParentMu = DEFAULT_MU;
    avgParentSigma2 = 0; // No parent uncertainty
  } else {
    avgParentMu = parentRatings.reduce((s, r) => s + r.mu, 0) / parentCount;
    avgParentSigma2 = parentRatings.reduce((s, r) => s + r.sigma ** 2, 0) / parentCount;
  }

  const deltaMu = variantRating.mu - avgParentMu;
  const sigmaDelta = Math.sqrt(variantRating.sigma ** 2 + avgParentSigma2);

  const zScore = sigmaDelta > 0 ? deltaMu / sigmaDelta : 0;
  const gain = deltaMu * ELO_SCALE;
  const ci = 1.96 * sigmaDelta * ELO_SCALE;

  return { gain, ci, zScore, deltaMu, sigmaDelta };
}

// ─── Agent-level aggregation ────────────────────────────────────

/**
 * Group variants by creating agent and compute aggregate attribution stats.
 * Uses root-sum-of-squares for the aggregate CI: sqrt(sum(ci²)) / N.
 */
export function aggregateByAgent(
  pool: TextVariation[],
  ratings: Map<string, Rating>,
  getParentRatings: (v: TextVariation) => Rating[],
): AgentAttribution[] {
  const agentMap = new Map<string, {
    variants: Array<{ variantId: string; attribution: EloAttribution }>;
  }>();

  for (const v of pool) {
    const agentName = getAgentForStrategy(v.strategy);
    if (!agentName) continue;

    const variantRating = ratings.get(v.id) ?? createRating();
    const parentRatings = getParentRatings(v);
    const attribution = computeEloAttribution(variantRating, parentRatings);

    let entry = agentMap.get(agentName);
    if (!entry) {
      entry = { variants: [] };
      agentMap.set(agentName, entry);
    }
    entry.variants.push({ variantId: v.id, attribution });
  }

  const results: AgentAttribution[] = [];
  for (const [agentName, { variants }] of agentMap) {
    const n = variants.length;
    const totalGain = variants.reduce((s, v) => s + v.attribution.gain, 0);
    const avgGain = totalGain / n;
    const avgCi = Math.sqrt(variants.reduce((s, v) => s + v.attribution.ci ** 2, 0)) / n;

    results.push({ agentName, variantCount: n, totalGain, avgGain, avgCi, variants });
  }

  return results;
}

// ─── Convenience: resolve parent ratings from pool + ratings map ─

/**
 * Build a parent rating resolver from the pool and ratings map.
 * Falls back to createRating() for missing parents (e.g. pruned variants).
 */
export function buildParentRatingResolver(
  ratings: Map<string, Rating>,
): (v: TextVariation) => Rating[] {
  return (v: TextVariation): Rating[] =>
    v.parentIds.map((pid) => ratings.get(pid) ?? createRating());
}
