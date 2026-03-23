// Ranks a pool of text variants via triage (stratified opponents, early exit) and Swiss fine-ranking.
// Returns updated ratings, match results, and convergence status.

import type { TextVariation, EvolutionLLMClient } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import type { ComparisonResult } from '../../shared/computeRatings';
import type { EvolutionConfig, V2Match } from '../infra/types';
import { BudgetExceededError } from '../../types';
import {
  createRating,
  updateRating,
  updateDraw,
  isConverged,
  DEFAULT_SIGMA,
  DEFAULT_CONVERGENCE_SIGMA,
} from '../../shared/computeRatings';
import { compareWithBiasMitigation } from '../../shared/computeRatings';

// ─── Constants ───────────────────────────────────────────────────

/** Minimum triage opponents before early exit can fire. */
const MIN_TRIAGE_OPPONENTS = 2;

/** Sigma threshold below which a variant is considered already calibrated (skip triage). */
const CALIBRATED_SIGMA_THRESHOLD = 5.0;

/** Decisive match confidence threshold for triage early exit. */
const DECISIVE_CONFIDENCE = 0.7;

/** Average confidence threshold for triage early exit. */
const AVG_CONFIDENCE_THRESHOLD = 0.8;

/** Bradley-Terry beta for win probability (DEFAULT_SIGMA * sqrt(2)). */
const BETA = DEFAULT_SIGMA * Math.SQRT2;

/** Budget pressure tier boundaries and max comparisons. */
const BUDGET_TIERS = {
  low: { maxComparisons: 40 },
  medium: { maxComparisons: 25 },
  high: { maxComparisons: 15 },
} as const;

// ─── Budget tier ─────────────────────────────────────────────────

function getBudgetTier(budgetFraction: number): 'low' | 'medium' | 'high' {
  if (budgetFraction >= 0.8) return 'high';
  if (budgetFraction >= 0.5) return 'medium';
  return 'low';
}

// ─── Stratified opponent selection ───────────────────────────────

/**
 * Select stratified opponents for a new entrant from existing variants.
 * For n=5: 2 top, 2 mid, 1 bottom (prefer fellow new entrants for bottom).
 */
function selectOpponents(
  entrantId: string,
  pool: TextVariation[],
  ratings: Map<string, Rating>,
  newEntrantIds: string[],
  n: number,
): string[] {
  const otherNew = newEntrantIds.filter((id) => id !== entrantId);
  const existing = pool.filter((v) => !newEntrantIds.includes(v.id) && v.id !== entrantId);

  // Sort existing by mu descending
  const sorted = [...existing].sort((a, b) => {
    const rA = ratings.get(a.id)?.mu ?? 0;
    const rB = ratings.get(b.id)?.mu ?? 0;
    return rB - rA;
  });

  // Early stage: not enough existing variants
  if (sorted.length === 0) {
    return otherNew.slice(0, n);
  }

  if (sorted.length < n - 1) {
    const ids = sorted.map((v) => v.id);
    for (const id of otherNew) {
      if (ids.length >= n) break;
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  // No ratings yet: random selection
  if (ratings.size === 0) {
    const ids = sorted.slice(0, n - 1).map((v) => v.id);
    if (otherNew.length > 0) ids.push(otherNew[0]);
    return ids.slice(0, n);
  }

  // Stratified selection
  const size = sorted.length;
  const q1 = Math.floor(size / 4);
  const q2 = Math.floor(size / 2);
  const q3 = Math.floor((3 * size) / 4);

  const opponents: string[] = [];

  if (n >= 5) {
    // 2 top, 2 mid, 1 bottom/new
    const top = sorted.slice(0, Math.max(q1, 1));
    opponents.push(top[0].id);
    if (top.length > 1) opponents.push(top[1].id);

    const mid = sorted.slice(Math.max(q2 - 1, 0), q2 + 1);
    for (const v of mid) {
      if (opponents.length >= 4) break;
      if (!opponents.includes(v.id)) opponents.push(v.id);
    }

    // Bottom slot: prefer fellow new entrant
    if (otherNew.length > 0 && !opponents.includes(otherNew[0])) {
      opponents.push(otherNew[0]);
    } else if (q3 < sorted.length && !opponents.includes(sorted[q3].id)) {
      opponents.push(sorted[q3].id);
    }
  } else if (n >= 3) {
    // 1 top, 1 mid, 1 bottom/new
    opponents.push(sorted[0].id);
    if (q2 < sorted.length) opponents.push(sorted[q2].id);
    if (otherNew.length > 0 && !opponents.includes(otherNew[0])) {
      opponents.push(otherNew[0]);
    } else if (q3 < sorted.length && !opponents.includes(sorted[q3].id)) {
      opponents.push(sorted[q3].id);
    }
  } else {
    // n < 3: top n
    for (let i = 0; i < Math.min(n, sorted.length); i++) {
      opponents.push(sorted[i].id);
    }
  }

  // Deduplicate preserving order
  const seen = new Set<string>();
  const deduped = opponents.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Pad if needed
  if (deduped.length < n) {
    const all = [...sorted.map((v) => v.id), ...otherNew];
    for (const id of all) {
      if (deduped.length >= n) break;
      if (!deduped.includes(id) && id !== entrantId) deduped.push(id);
    }
  }

  return deduped.slice(0, n);
}

// ─── Comparison wrapper ──────────────────────────────────────────

function makeCompareCallback(
  llm: EvolutionLLMClient,
  config: EvolutionConfig,
  errorCounter?: { count: number },
): (prompt: string) => Promise<string> {
  return async (prompt: string): Promise<string> => {
    try {
      const result = await llm.complete(prompt, 'ranking', {
        model: config.judgeModel as Parameters<typeof llm.complete>[2] extends { model?: infer M } ? M : never,
      });
      if (errorCounter) errorCounter.count = 0; // Reset on success
      return result;
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      if (errorCounter) errorCounter.count++;
      return '';
    }
  };
}

/** Run a comparison and build a V2Match. */
async function runComparison(
  textA: string,
  textB: string,
  idA: string,
  idB: string,
  callLLM: (prompt: string) => Promise<string>,
  config: EvolutionConfig,
  cache?: Map<string, ComparisonResult>,
): Promise<V2Match> {
  const result = await compareWithBiasMitigation(textA, textB, callLLM, cache);

  let winnerId: string;
  let loserId: string;
  let matchResult: 'win' | 'draw';

  if (result.winner === 'A') {
    winnerId = idA;
    loserId = idB;
    matchResult = 'win';
  } else if (result.winner === 'B') {
    winnerId = idB;
    loserId = idA;
    matchResult = 'win';
  } else {
    winnerId = idA;
    loserId = idB;
    matchResult = 'draw';
  }

  return {
    winnerId,
    loserId,
    result: matchResult,
    confidence: result.confidence,
    judgeModel: config.judgeModel,
    reversed: false,
  };
}

// ─── Swiss pairing ───────────────────────────────────────────────

interface PairCandidate {
  idA: string;
  idB: string;
  score: number;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function swissPairing(
  eligibleIds: string[],
  ratings: Map<string, Rating>,
  completedPairs: Set<string>,
): Array<[string, string]> {
  if (eligibleIds.length < 2) return [];

  const candidates: PairCandidate[] = [];

  for (let i = 0; i < eligibleIds.length; i++) {
    for (let j = i + 1; j < eligibleIds.length; j++) {
      const idA = eligibleIds[i];
      const idB = eligibleIds[j];
      const key = pairKey(idA, idB);
      if (completedPairs.has(key)) continue;

      const rA = ratings.get(idA) ?? createRating();
      const rB = ratings.get(idB) ?? createRating();

      // Bradley-Terry win probability
      const pWin = 1 / (1 + Math.exp(-(rA.mu - rB.mu) / BETA));
      const outcomeUncertainty = 1 - Math.abs(2 * pWin - 1);
      const sigmaWeight = (rA.sigma + rB.sigma) / 2;
      const score = outcomeUncertainty * sigmaWeight;

      candidates.push({ idA, idB, score });
    }
  }

  // Greedy pair selection by descending score
  candidates.sort((a, b) => b.score - a.score);
  const used = new Set<string>();
  const pairs: Array<[string, string]> = [];

  for (const c of candidates) {
    if (used.has(c.idA) || used.has(c.idB)) continue;
    pairs.push([c.idA, c.idB]);
    used.add(c.idA);
    used.add(c.idB);
  }

  return pairs;
}

// ─── Triage phase ────────────────────────────────────────────────

interface TriageResult {
  matches: V2Match[];
  eliminatedIds: Set<string>;
  ratings: Map<string, Rating>;
  matchCounts: Map<string, number>;
}

async function executeTriage(
  pool: TextVariation[],
  ratings: Map<string, Rating>,
  matchCounts: Map<string, number>,
  newEntrantIds: string[],
  config: EvolutionConfig,
  callLLM: (prompt: string) => Promise<string>,
  cache?: Map<string, ComparisonResult>,
): Promise<TriageResult> {
  const localRatings = new Map(ratings);
  const localCounts = new Map(matchCounts);
  const matches: V2Match[] = [];
  const eliminatedIds = new Set<string>();
  const poolMap = new Map(pool.map((v) => [v.id, v]));

  // Filter new entrants needing triage (sigma >= CALIBRATED threshold)
  const needsTriage = newEntrantIds.filter((id) => {
    const r = localRatings.get(id);
    return !r || r.sigma >= CALIBRATED_SIGMA_THRESHOLD;
  });

  // Compute top 20% cutoff for elimination
  const allMus = [...localRatings.values()].map((r) => r.mu).sort((a, b) => b - a);
  const top20Idx = Math.max(0, Math.floor(allMus.length * 0.2) - 1);
  const top20Cutoff = allMus[top20Idx] ?? 0;

  const numOpponents = config.calibrationOpponents ?? 5;

  let consecutiveErrors = 0;

  for (const entrantId of needsTriage) {
    const entrantVariant = poolMap.get(entrantId);
    if (!entrantVariant) continue;

    // Ensure entrant has a rating
    if (!localRatings.has(entrantId)) {
      localRatings.set(entrantId, createRating());
    }

    const opponents = selectOpponents(entrantId, pool, localRatings, newEntrantIds, numOpponents);
    let decisiveCount = 0;
    let totalConfidence = 0;

    for (let i = 0; i < opponents.length; i++) {
      const oppId = opponents[i];
      const oppVariant = poolMap.get(oppId);
      if (!oppVariant) continue;

      // Ensure opponent has a rating
      if (!localRatings.has(oppId)) {
        localRatings.set(oppId, createRating());
      }

      const match = await runComparison(
        entrantVariant.text,
        oppVariant.text,
        entrantId,
        oppId,
        callLLM,
        config,
        cache,
      );
      matches.push(match);

      // Update match counts
      localCounts.set(entrantId, (localCounts.get(entrantId) ?? 0) + 1);
      localCounts.set(oppId, (localCounts.get(oppId) ?? 0) + 1);

      // Update ratings
      const entrantRating = localRatings.get(entrantId)!;
      const oppRating = localRatings.get(oppId)!;

      // Skip rating update for failed comparisons (confidence 0 = both LLM passes failed)
      if (match.confidence === 0) {
        consecutiveErrors++;
        if (consecutiveErrors > 3) break; // Too many consecutive failures
        totalConfidence += match.confidence;
        continue;
      }
      consecutiveErrors = 0;
      const isDraw = match.winnerId === match.loserId;
      if (isDraw || match.result === 'draw') {
        const [newA, newB] = updateDraw(entrantRating, oppRating);
        localRatings.set(entrantId, newA);
        localRatings.set(oppId, newB);
      } else {
        const winnerRating = match.winnerId === entrantId ? entrantRating : oppRating;
        const loserRating = match.winnerId === entrantId ? oppRating : entrantRating;
        const [newW, newL] = updateRating(winnerRating, loserRating);
        localRatings.set(match.winnerId, newW);
        localRatings.set(match.loserId, newL);
      }

      totalConfidence += match.confidence;
      if (match.confidence >= DECISIVE_CONFIDENCE) decisiveCount++;

      // Elimination check
      const currentRating = localRatings.get(entrantId)!;
      if (i >= MIN_TRIAGE_OPPONENTS - 1 && currentRating.mu + 2 * currentRating.sigma < top20Cutoff) {
        eliminatedIds.add(entrantId);
        break;
      }

      // Decisive early exit
      if (
        i >= MIN_TRIAGE_OPPONENTS - 1 &&
        decisiveCount >= MIN_TRIAGE_OPPONENTS &&
        totalConfidence / (i + 1) >= AVG_CONFIDENCE_THRESHOLD
      ) {
        break;
      }
    }
  }

  return { matches, eliminatedIds, ratings: localRatings, matchCounts: localCounts };
}

// ─── Fine-ranking phase ──────────────────────────────────────────

interface FineRankingResult {
  matches: V2Match[];
  ratings: Map<string, Rating>;
  matchCounts: Map<string, number>;
  converged: boolean;
}

async function executeFineRanking(
  pool: TextVariation[],
  ratings: Map<string, Rating>,
  matchCounts: Map<string, number>,
  eliminatedIds: Set<string>,
  config: EvolutionConfig,
  callLLM: (prompt: string) => Promise<string>,
  maxComparisons: number,
  cache?: Map<string, ComparisonResult>,
): Promise<FineRankingResult> {
  const localRatings = new Map(ratings);
  const localCounts = new Map(matchCounts);
  const matches: V2Match[] = [];
  const completedPairs = new Set<string>();
  const poolMap = new Map(pool.map((v) => [v.id, v]));
  let totalComparisons = 0;
  let consecutiveConvergedRounds = 0;

  const topK = config.tournamentTopK ?? 5;
  let consecutiveErrors = 0;

  // Compute topK IDs by mu
  const topKIds = new Set(
    [...localRatings.entries()]
      .sort(([, a], [, b]) => b.mu - a.mu)
      .slice(0, topK)
      .map(([id]) => id),
  );

  // Eligible: not eliminated, and (mu >= 3*sigma OR in topK)
  const getEligibleIds = (): string[] => {
    return pool
      .filter((v) => !eliminatedIds.has(v.id))
      .filter((v) => {
        const r = localRatings.get(v.id);
        if (!r) return false;
        return r.mu >= 3 * r.sigma || topKIds.has(v.id);
      })
      .map((v) => v.id);
  };

  // Swiss rounds
  for (let round = 0; round < 20; round++) {
    if (totalComparisons >= maxComparisons) break;

    const eligibleIds = getEligibleIds();
    if (eligibleIds.length < 2) break;

    const pairs = swissPairing(eligibleIds, localRatings, completedPairs);
    if (pairs.length === 0) {
      consecutiveConvergedRounds++;
      if (consecutiveConvergedRounds >= 2) break;
      break; // No new pairs
    }

    for (const [idA, idB] of pairs) {
      if (totalComparisons >= maxComparisons) break;

      const varA = poolMap.get(idA);
      const varB = poolMap.get(idB);
      if (!varA || !varB) continue;

      const match = await runComparison(varA.text, varB.text, idA, idB, callLLM, config, cache);
      matches.push(match);
      completedPairs.add(pairKey(idA, idB));
      totalComparisons++;

      // Update counts
      localCounts.set(idA, (localCounts.get(idA) ?? 0) + 1);
      localCounts.set(idB, (localCounts.get(idB) ?? 0) + 1);

      // Update ratings
      const rA = localRatings.get(idA) ?? createRating();
      const rB = localRatings.get(idB) ?? createRating();

      // Skip rating update for total failures (confidence 0)
      if (match.confidence === 0) {
        consecutiveErrors++;
        if (consecutiveErrors > 3) break;
        continue;
      }
      consecutiveErrors = 0;
      // Treat low-confidence (0 < confidence < 0.3) as draw (existing behavior)
      if (match.confidence < 0.3 || match.result === 'draw') {
        const [newA, newB] = updateDraw(rA, rB);
        localRatings.set(idA, newA);
        localRatings.set(idB, newB);
      } else {
        const winnerRating = match.winnerId === idA ? rA : rB;
        const loserRating = match.winnerId === idA ? rB : rA;
        const [newW, newL] = updateRating(winnerRating, loserRating);
        localRatings.set(match.winnerId, newW);
        localRatings.set(match.loserId, newL);
      }
    }

    // Break outer loop if too many consecutive LLM failures
    if (consecutiveErrors > 3) break;

    // Convergence check: all eligible sigmas < threshold
    const currentEligible = getEligibleIds();
    const allConverged = currentEligible.every((id) => {
      const r = localRatings.get(id);
      return r ? isConverged(r, DEFAULT_CONVERGENCE_SIGMA) : false;
    });

    if (allConverged) {
      consecutiveConvergedRounds++;
      if (consecutiveConvergedRounds >= 2) {
        return { matches, ratings: localRatings, matchCounts: localCounts, converged: true };
      }
    } else {
      consecutiveConvergedRounds = 0;
    }
  }

  return {
    matches,
    ratings: localRatings,
    matchCounts: localCounts,
    converged: consecutiveConvergedRounds >= 2,
  };
}

// ─── Public API ──────────────────────────────────────────────────

export interface RankResult {
  matches: V2Match[];
  ratingUpdates: Record<string, Rating>;
  matchCountIncrements: Record<string, number>;
  converged: boolean;
}

/**
 * Rank a pool of text variants via triage + Swiss fine-ranking.
 * Returns ALL ratings (full snapshot), match count increments (deltas),
 * all matches (triage + fine-ranking), and convergence status.
 */
export async function rankPool(
  pool: TextVariation[],
  ratings: Map<string, Rating>,
  matchCounts: Map<string, number>,
  newEntrantIds: string[],
  llm: EvolutionLLMClient,
  config: EvolutionConfig,
  budgetFraction?: number,
  cache?: Map<string, ComparisonResult>,
): Promise<RankResult> {
  if (pool.length < 2) {
    return { matches: [], ratingUpdates: {}, matchCountIncrements: {}, converged: false };
  }

  // Ensure all pool members have ratings
  for (const v of pool) {
    if (!ratings.has(v.id)) {
      ratings.set(v.id, createRating());
    }
  }

  const tier = getBudgetTier(budgetFraction ?? 0);
  const maxComparisons = BUDGET_TIERS[tier].maxComparisons;
  const callLLM = makeCompareCallback(llm, config);

  // Snapshot initial match counts for delta computation
  const initialCounts = new Map(matchCounts);

  // Phase 1: Triage new entrants
  let currentRatings = new Map(ratings);
  let currentCounts = new Map(matchCounts);
  const allMatches: V2Match[] = [];
  let eliminatedIds = new Set<string>();

  // Skip triage if all variants are new (first iteration)
  const hasExistingVariants = pool.some((v) => !newEntrantIds.includes(v.id));

  if (hasExistingVariants && newEntrantIds.length > 0) {
    const triageResult = await executeTriage(
      pool,
      currentRatings,
      currentCounts,
      newEntrantIds,
      config,
      callLLM,
      cache,
    );
    allMatches.push(...triageResult.matches);
    currentRatings = triageResult.ratings;
    currentCounts = triageResult.matchCounts;
    eliminatedIds = triageResult.eliminatedIds;
  }

  // Phase 2: Fine-ranking
  const fineResult = await executeFineRanking(
    pool,
    currentRatings,
    currentCounts,
    eliminatedIds,
    config,
    callLLM,
    maxComparisons,
    cache,
  );
  allMatches.push(...fineResult.matches);

  // Build full rating snapshot
  const ratingUpdates: Record<string, Rating> = {};
  for (const [id, r] of fineResult.ratings) {
    ratingUpdates[id] = r;
  }

  // Compute match count increments (deltas)
  const matchCountIncrements: Record<string, number> = {};
  for (const [id, count] of fineResult.matchCounts) {
    const initial = initialCounts.get(id) ?? 0;
    const delta = count - initial;
    if (delta > 0) matchCountIncrements[id] = delta;
  }

  return {
    matches: allMatches,
    ratingUpdates,
    matchCountIncrements,
    converged: fineResult.converged,
  };
}
