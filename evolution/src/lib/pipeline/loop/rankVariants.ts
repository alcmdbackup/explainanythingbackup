// Ranks a pool of text variants via triage (stratified opponents, early exit) and Swiss fine-ranking.
// Returns updated ratings, match results, and convergence status.

import type { Variant, EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import { BudgetExceededError, BudgetExceededWithPartialResults } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import {
  createRating, updateRating, updateDraw, isConverged,
  compareWithBiasMitigation, DEFAULT_SIGMA, DEFAULT_CONVERGENCE_SIGMA,
} from '../../shared/computeRatings';
import type { EvolutionConfig, V2Match } from '../infra/types';
import type { EntityLogger } from '../infra/createEntityLogger';

// ─── Constants ───────────────────────────────────────────────────

/** Z-score for Swiss eligibility: 85th percentile (top 15%). */
const ELIGIBILITY_Z_SCORE = 1.04;

/** Minimum eligible variants for Swiss ranking. */
const MIN_SWISS_POOL = 3;

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
  pool: Variant[],
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
    if (otherNew.length > 0) ids.push(otherNew[0]!);
    return ids.slice(0, n);
  }

  // Stratified selection
  const size = sorted.length;
  const q1 = Math.floor(size / 4);
  const q2 = Math.floor(size / 2);
  const q3 = Math.floor((3 * size) / 4);

  const opponents: string[] = [];

  // Helper: sub-sort a slice by sigma ascending (prefer low-sigma anchors)
  const sortBySigma = (slice: Variant[]): Variant[] =>
    [...slice].sort((a, b) =>
      (ratings.get(a.id)?.sigma ?? DEFAULT_SIGMA) - (ratings.get(b.id)?.sigma ?? DEFAULT_SIGMA),
    );

  if (n >= 5) {
    // 2 top, 2 mid, 1 bottom/new
    const top = sortBySigma(sorted.slice(0, Math.max(q1, 1)));
    opponents.push(top[0]!.id);
    if (top.length > 1) opponents.push(top[1]!.id);

    const mid = sortBySigma(sorted.slice(Math.max(q2 - 1, 0), q2 + 1));
    for (const v of mid) {
      if (opponents.length >= 4) break;
      if (!opponents.includes(v.id)) opponents.push(v.id);
    }

    // Bottom slot: prefer fellow new entrant
    if (otherNew.length > 0 && !opponents.includes(otherNew[0]!)) {
      opponents.push(otherNew[0]!);
    } else if (q3 < sorted.length && !opponents.includes(sorted[q3]!.id)) {
      opponents.push(sorted[q3]!.id);
    }
  } else if (n >= 3) {
    // 1 top, 1 mid, 1 bottom/new
    const topSlice = sortBySigma(sorted.slice(0, Math.max(q1, 1)));
    opponents.push(topSlice[0]!.id);
    const midSlice = sortBySigma(sorted.slice(Math.max(q2 - 1, 0), q2 + 1));
    if (midSlice.length > 0) opponents.push(midSlice[0]!.id);
    if (otherNew.length > 0 && !opponents.includes(otherNew[0]!)) {
      opponents.push(otherNew[0]!);
    } else {
      const bottomSlice = sortBySigma(sorted.slice(q3));
      if (bottomSlice.length > 0 && !opponents.includes(bottomSlice[0]!.id)) {
        opponents.push(bottomSlice[0]!.id);
      }
    }
  } else {
    // n < 3: top n (sorted by sigma within the slice)
    const topSlice = sortBySigma(sorted.slice(0, Math.min(n, sorted.length)));
    for (const v of topSlice) {
      opponents.push(v.id);
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
  logger?: EntityLogger,
): (prompt: string) => Promise<string> {
  return async (prompt: string): Promise<string> => {
    try {
      const result = await llm.complete(prompt, 'ranking', {
        model: config.judgeModel as LLMCompletionOptions['model'],
      });
      if (errorCounter) errorCounter.count = 0; // Reset on success
      return result;
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      if (errorCounter) errorCounter.count++;
      logger?.warn('LLM comparison failed', { attempt: errorCounter?.count, phaseName: 'ranking' });
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
  logger?: EntityLogger,
): Promise<V2Match> {
  const result = await compareWithBiasMitigation(textA, textB, callLLM, cache);
  logger?.debug('Comparison result', { idA, idB, winner: result.winner, confidence: result.confidence, phaseName: 'ranking' });

  const isDraw = result.winner !== 'A' && result.winner !== 'B';
  const winnerId = result.winner === 'B' ? idB : idA;
  const loserId = result.winner === 'B' ? idA : idB;

  return {
    winnerId,
    loserId,
    result: isDraw ? 'draw' : 'win',
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
      const idA = eligibleIds[i]!;
      const idB = eligibleIds[j]!;
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
  budgetError?: BudgetExceededError;
  lowSigmaOpponentsCount: number;
}

async function executeTriage(
  pool: Variant[],
  ratings: Map<string, Rating>,
  matchCounts: Map<string, number>,
  newEntrantIds: string[],
  config: EvolutionConfig,
  callLLM: (prompt: string) => Promise<string>,
  cache?: Map<string, ComparisonResult>,
  logger?: EntityLogger,
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

  const numOpponents = config.calibrationOpponents ?? 5;

  let consecutiveErrors = 0;
  let budgetError: BudgetExceededError | null = null;
  let totalLowSigmaOpponents = 0;

  try {
  for (const entrantId of needsTriage) {
    if (consecutiveErrors > 3) break; // Stop triage entirely after sustained LLM failures
    const entrantVariant = poolMap.get(entrantId);
    if (!entrantVariant) continue;

    // Ensure entrant has a rating
    if (!localRatings.has(entrantId)) {
      localRatings.set(entrantId, createRating());
    }

    const opponents = selectOpponents(entrantId, pool, localRatings, newEntrantIds, numOpponents);
    const opponentSigmas = opponents.map((id) => localRatings.get(id)?.sigma ?? DEFAULT_SIGMA);
    const lowSigmaCount = opponentSigmas.filter((s) => s < CALIBRATED_SIGMA_THRESHOLD).length;
    const entrantSigmaBefore = localRatings.get(entrantId)?.sigma ?? DEFAULT_SIGMA;
    totalLowSigmaOpponents += lowSigmaCount;
    logger?.debug('Triage entrant opponents', {
      entrantId,
      sigmaBefore: entrantSigmaBefore,
      opponentSigmas,
      lowSigmaOpponents: lowSigmaCount,
      phaseName: 'ranking',
    });
    let decisiveCount = 0;
    let totalConfidence = 0;
    let successfulMatches = 0;

    for (let i = 0; i < opponents.length; i++) {
      const oppId = opponents[i]!;
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
        logger,
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
        logger?.warn('Triage comparison failed', { entrantId, oppId, consecutiveErrors, phaseName: 'ranking' });
        if (consecutiveErrors > 3) break; // Too many consecutive failures
        continue;
      }
      consecutiveErrors = 0;
      successfulMatches++;
      // Treat low-confidence (0 < confidence < 0.3) as draw (consistent with fine-ranking)
      const isDraw = match.confidence < 0.3 || match.result === 'draw' || match.winnerId === match.loserId;
      if (isDraw) {
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

      // Elimination check (use successfulMatches instead of i to exclude failed comparisons)
      // Recompute top 20% cutoff each check so it reflects current ratings (not stale initial values)
      const currentRating = localRatings.get(entrantId)!;
      const currentMus = [...localRatings.values()].map((r) => r.mu).sort((a, b) => b - a);
      const top20Idx = Math.max(0, Math.floor(currentMus.length * 0.2) - 1);
      const top20Cutoff = currentMus[top20Idx] ?? 0;
      if (successfulMatches >= MIN_TRIAGE_OPPONENTS && currentRating.mu + 2 * currentRating.sigma < top20Cutoff) {
        eliminatedIds.add(entrantId);
        logger?.info('Triage elimination', { entrantId, muPlusSigma: currentRating.mu + 2 * currentRating.sigma, cutoff: top20Cutoff, phaseName: 'ranking' });
        break;
      }

      // Decisive early exit (use successfulMatches for both count and avg confidence denominator)
      if (
        successfulMatches >= MIN_TRIAGE_OPPONENTS &&
        decisiveCount >= MIN_TRIAGE_OPPONENTS &&
        totalConfidence / successfulMatches >= AVG_CONFIDENCE_THRESHOLD
      ) {
        logger?.info('Triage early exit', { entrantId, decisiveCount, avgConfidence: totalConfidence / successfulMatches, phaseName: 'ranking' });
        break;
      }
    }
  }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      budgetError = error;
    } else { throw error; }
  }

  return { matches, eliminatedIds, ratings: localRatings, matchCounts: localCounts, budgetError: budgetError ?? undefined, lowSigmaOpponentsCount: totalLowSigmaOpponents };
}

// ─── Fine-ranking phase ──────────────────────────────────────────

interface FineRankingResult {
  matches: V2Match[];
  ratings: Map<string, Rating>;
  matchCounts: Map<string, number>;
  converged: boolean;
  rounds: number;
  exitReason: string;
  convergenceStreak: number;
  budgetError?: BudgetExceededError;
}

async function executeFineRanking(
  pool: Variant[],
  ratings: Map<string, Rating>,
  matchCounts: Map<string, number>,
  eliminatedIds: Set<string>,
  config: EvolutionConfig,
  callLLM: (prompt: string) => Promise<string>,
  maxComparisons: number,
  cache?: Map<string, ComparisonResult>,
  logger?: EntityLogger,
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

  const getEligibleIds = (): string[] => {
    const nonEliminated = pool.filter((v) => !eliminatedIds.has(v.id));

    // Recompute topK each round (ratings change)
    const sortedByMu = nonEliminated
      .map((v) => ({ id: v.id, mu: localRatings.get(v.id)?.mu ?? 0 }))
      .sort((a, b) => b.mu - a.mu);
    const topKIds = new Set(sortedByMu.slice(0, topK).map((e) => e.id));

    // Top-15% cutoff
    const top15Idx = Math.max(0, Math.floor(sortedByMu.length * 0.15) - 1);
    const top15Cutoff = sortedByMu[top15Idx]?.mu ?? 0;

    const eligible = nonEliminated.filter((v) => {
      const r = localRatings.get(v.id);
      if (!r) return false;
      return r.mu + ELIGIBILITY_Z_SCORE * r.sigma >= top15Cutoff || topKIds.has(v.id);
    });

    // Minimum pool floor
    if (eligible.length < MIN_SWISS_POOL) {
      logger?.info('Swiss pool below minimum, using top-3 fallback', { eligible: eligible.length, phaseName: 'ranking' });
      return sortedByMu.slice(0, MIN_SWISS_POOL).map((e) => e.id);
    }

    logger?.debug(`Swiss eligibility: ${eligible.length} of ${nonEliminated.length} variants pass top-15% filter`, { phaseName: 'ranking' });
    return eligible.map((v) => v.id);
  };

  let budgetError: BudgetExceededError | null = null;
  let lastRound = 0;
  let exitReason = 'maxRounds';

  try {
  // Swiss rounds

  for (let round = 0; round < 20; round++) {
    lastRound = round;
    if (totalComparisons >= maxComparisons) { exitReason = 'budget'; break; }

    const eligibleIds = getEligibleIds();
    if (eligibleIds.length < 2) { exitReason = 'no_contenders'; break; }

    const pairs = swissPairing(eligibleIds, localRatings, completedPairs);
    if (pairs.length === 0) {
      consecutiveConvergedRounds++;
      exitReason = 'stale';
      if (consecutiveConvergedRounds >= 2) { exitReason = 'convergence'; }
      break; // No new pairs
    }
    logger?.debug('Swiss round start', { round, eligible: eligibleIds.length, pairs: pairs.length, totalComparisons, phaseName: 'ranking' });

    for (const [idA, idB] of pairs) {
      if (totalComparisons >= maxComparisons) break;

      const varA = poolMap.get(idA);
      const varB = poolMap.get(idB);
      if (!varA || !varB) continue;

      const match = await runComparison(varA.text, varB.text, idA, idB, callLLM, config, cache, logger);
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
        logger?.warn('Fine-ranking comparison failed', { idA, idB, consecutiveErrors, phaseName: 'ranking' });
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
      logger?.info('Fine-ranking convergence signal', { round, convergedCount: currentEligible.length, eligibleCount: currentEligible.length, phaseName: 'ranking' });
      if (consecutiveConvergedRounds >= 2) {
        exitReason = 'convergence';
        break;
      }
    } else {
      consecutiveConvergedRounds = 0;
    }
  }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      budgetError = error;
    } else { throw error; }
  }

  return {
    matches,
    ratings: localRatings,
    matchCounts: localCounts,
    converged: consecutiveConvergedRounds >= 2,
    rounds: lastRound + 1,
    exitReason,
    convergenceStreak: consecutiveConvergedRounds,
    budgetError: budgetError ?? undefined,
  };
}

// ─── Public API ──────────────────────────────────────────────────

/** Ranking execution metadata for execution detail tracking. */
export interface RankingMeta {
  budgetPressure: number;
  budgetTier: 'low' | 'medium' | 'high';
  top20Cutoff: number;
  eligibleContenders: number;
  totalComparisons: number;
  fineRankingRounds: number;
  fineRankingExitReason: string;
  convergenceStreak: number;
  /** Total low-sigma opponents (sigma < 5.0) selected across all triage entrants. */
  lowSigmaOpponentsCount?: number;
}

export interface RankResult {
  matches: V2Match[];
  ratingUpdates: Record<string, Rating>;
  matchCountIncrements: Record<string, number>;
  converged: boolean;
  /** Ranking metadata for execution detail construction. */
  meta: RankingMeta;
}

/** Compute match count deltas between current and initial snapshots. */
function computeMatchCountDeltas(
  currentCounts: Map<string, number>,
  initialCounts: Map<string, number>,
): Record<string, number> {
  const deltas: Record<string, number> = {};
  for (const [id, count] of currentCounts) {
    const delta = count - (initialCounts.get(id) ?? 0);
    if (delta > 0) deltas[id] = delta;
  }
  return deltas;
}

/** Compute top-20% mu cutoff from a ratings map. */
function computeTop20Cutoff(ratingsMap: Map<string, Rating>): number {
  const allMus = [...ratingsMap.values()].map(r => r.mu).sort((a, b) => b - a);
  const idx = Math.max(0, Math.floor(allMus.length * 0.2) - 1);
  return allMus[idx] ?? 0;
}

/**
 * Rank a pool of text variants via triage + Swiss fine-ranking.
 * Returns ALL ratings (full snapshot), match count increments (deltas),
 * all matches (triage + fine-ranking), and convergence status.
 */
export async function rankPool(
  pool: Variant[],
  ratings: Map<string, Rating>,
  matchCounts: Map<string, number>,
  newEntrantIds: string[],
  llm: EvolutionLLMClient,
  config: EvolutionConfig,
  budgetFraction?: number,
  cache?: Map<string, ComparisonResult>,
  logger?: EntityLogger,
): Promise<RankResult> {
  if (pool.length < 2) {
    return {
      matches: [], ratingUpdates: {}, matchCountIncrements: {}, converged: false,
      meta: {
        budgetPressure: 0, budgetTier: 'low', top20Cutoff: 0,
        eligibleContenders: 0, totalComparisons: 0, fineRankingRounds: 0,
        fineRankingExitReason: 'no_contenders', convergenceStreak: 0,
      },
    };
  }

  // Ensure all pool members have ratings
  for (const v of pool) {
    if (!ratings.has(v.id)) {
      ratings.set(v.id, createRating());
    }
  }

  const tier = getBudgetTier(budgetFraction ?? 0);
  const maxComparisons = BUDGET_TIERS[tier].maxComparisons;
  const callLLM = makeCompareCallback(llm, config, undefined, logger);
  logger?.debug('Budget tier selected', { tier, budgetFraction, maxComparisons, phaseName: 'ranking' });

  // Snapshot initial match counts for delta computation
  const initialCounts = new Map(matchCounts);

  // Phase 1: Triage new entrants
  let currentRatings = new Map(ratings);
  let currentCounts = new Map(matchCounts);
  const allMatches: V2Match[] = [];
  let eliminatedIds = new Set<string>();

  // Skip triage if all variants are new (first iteration)
  const hasExistingVariants = pool.some((v) => !newEntrantIds.includes(v.id));

  logger?.info(`Ranking pool: ${pool.length} variants, ${newEntrantIds.length} new entrants`, { phaseName: 'ranking' });

  let triageResult: TriageResult | null = null;
  if (hasExistingVariants && newEntrantIds.length > 0) {
    triageResult = await executeTriage(
      pool,
      currentRatings,
      currentCounts,
      newEntrantIds,
      config,
      callLLM,
      cache,
      logger,
    );
    allMatches.push(...triageResult.matches);
    currentRatings = triageResult.ratings;
    currentCounts = triageResult.matchCounts;
    eliminatedIds = triageResult.eliminatedIds;
    logger?.info(`Triage: ${eliminatedIds.size} eliminated, ${newEntrantIds.length - eliminatedIds.size} passed`, { phaseName: 'ranking' });
  }

  // Phase 2: Fine-ranking (skip if triage already hit budget)
  let fineResult: FineRankingResult | null = null;
  if (!triageResult?.budgetError) {
    fineResult = await executeFineRanking(
      pool,
      currentRatings,
      currentCounts,
      eliminatedIds,
      config,
      callLLM,
      maxComparisons,
      cache,
      logger,
    );
    allMatches.push(...fineResult.matches);
    currentRatings = fineResult.ratings;
    currentCounts = fineResult.matchCounts;
  }

  // Common result fields used for both normal and budget-exceeded paths
  const ratingUpdates: Record<string, Rating> = Object.fromEntries(currentRatings);
  const matchCountIncrements = computeMatchCountDeltas(currentCounts, initialCounts);
  const eligibleContenders = pool.filter(v => !eliminatedIds.has(v.id)).length;

  const buildResult = (converged: boolean): RankResult => ({
    matches: allMatches,
    ratingUpdates,
    matchCountIncrements,
    converged,
    meta: {
      budgetPressure: budgetFraction ?? 0,
      budgetTier: tier,
      top20Cutoff: computeTop20Cutoff(currentRatings),
      eligibleContenders,
      totalComparisons: allMatches.length,
      fineRankingRounds: fineResult?.rounds ?? 0,
      fineRankingExitReason: fineResult?.exitReason ?? 'budget_exceeded',
      convergenceStreak: fineResult?.convergenceStreak ?? 0,
      lowSigmaOpponentsCount: triageResult?.lowSigmaOpponentsCount,
    },
  });

  // Check for budget error from either phase
  const budgetError = triageResult?.budgetError ?? fineResult?.budgetError;
  if (budgetError) {
    throw new BudgetExceededWithPartialResults(buildResult(false), budgetError);
  }

  if (!fineResult) {
    logger?.warn('Fine-ranking skipped (triage budget exceeded); convergence not evaluated', { phaseName: 'ranking' });
  }

  if (fineResult?.converged) {
    logger?.info('Pool converged', { phaseName: 'ranking' });
  }

  return buildResult(fineResult?.converged ?? false);
}
