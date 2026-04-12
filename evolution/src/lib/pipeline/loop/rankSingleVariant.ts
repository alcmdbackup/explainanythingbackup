// Binary-search ranking for a single variant against a local pool snapshot.
// Called by generateFromSeedArticle agents (one per generated variant) running in parallel.
//
// The function:
//   - Mutates the supplied LOCAL ratings/matchCounts maps as it goes (chronological updates).
//     Callers MUST pass deep clones — no shared mutable state across agents.
//   - Buffers raw match outcomes separately for the global merge in MergeRatingsAgent.
//   - Loops one comparison at a time, picks opponents via information-gain scoring
//     (entropy(pWin) / sigma^k), and exits on convergence / elimination / no_more_opponents / budget.
//
// See planning doc: docs/planning/generate_rank_evolution_parallel_20260331/_planning.md

import type { Variant, EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import { BudgetExceededError } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import {
  createRating, updateRating, updateDraw,
  compareWithBiasMitigation, DEFAULT_SIGMA, DEFAULT_CONVERGENCE_SIGMA,
} from '../../shared/computeRatings';
import type { EvolutionConfig, V2Match } from '../infra/types';
import type { EntityLogger } from '../infra/createEntityLogger';

// ─── Tunable constants ────────────────────────────────────────────

/** Bradley-Terry beta for win-probability scaling (DEFAULT_SIGMA * sqrt(2) ≈ 11.785). */
export const BETA = DEFAULT_SIGMA * Math.SQRT2;

/** Single tunable knob for opponent scoring: entropy / sigma^SIGMA_WEIGHT.
 *  Higher values prefer reliable (low-sigma) opponents; lower values prefer close matches.
 *  See "Parameter analysis" in the planning doc. */
export const SIGMA_WEIGHT = 1.0;

/** Top-percentile cutoff for elimination check. 0.15 = top 15%. */
export const TOP_PERCENTILE = 0.15;

/** Sigma multiplier for the elimination upper-bound check (mu + ELIMINATION_CI*sigma < cutoff). */
export const ELIMINATION_CI = 2;

/** Convergence threshold for sigma — variant exits when its local sigma drops below this. */
export const CONVERGENCE_THRESHOLD = DEFAULT_CONVERGENCE_SIGMA;

// ─── Public types ─────────────────────────────────────────────────

export type RankSingleVariantStatus =
  | 'converged'
  | 'eliminated'
  | 'no_more_opponents'
  | 'budget';

export interface RankSingleVariantComparisonRecord {
  round: number;
  opponentId: string;
  selectionScore: number;
  pWin: number;
  variantMuBefore: number;
  variantSigmaBefore: number;
  opponentMuBefore: number;
  opponentSigmaBefore: number;
  outcome: 'win' | 'loss' | 'draw';
  confidence: number;
  variantMuAfter: number;
  variantSigmaAfter: number;
  opponentMuAfter: number;
  opponentSigmaAfter: number;
  top15CutoffAfter: number;
  muPlusTwoSigma: number;
  eliminated: boolean;
  converged: boolean;
}

export interface RankSingleVariantDetail {
  variantId: string;
  /** localPoolSize INCLUDING the variant itself (after the agent added it). */
  localPoolSize: number;
  localPoolVariantIds: string[];
  initialTop15Cutoff: number;
  comparisons: RankSingleVariantComparisonRecord[];
  stopReason: RankSingleVariantStatus;
  totalComparisons: number;
  finalLocalMu: number;
  finalLocalSigma: number;
  finalLocalTop15Cutoff: number;
}

export interface RankSingleVariantResult {
  status: RankSingleVariantStatus;
  matches: V2Match[];
  comparisonsRun: number;
  detail: RankSingleVariantDetail;
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Order-invariant pair key for completedPairs tracking. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Compute the top-15% (by mu) cutoff from a ratings map. */
export function computeTop15Cutoff(ratings: ReadonlyMap<string, Rating>): number {
  const mus: number[] = [];
  for (const r of ratings.values()) mus.push(r.mu);
  if (mus.length === 0) return 0;
  mus.sort((a, b) => b - a);
  const idx = Math.max(0, Math.floor(mus.length * TOP_PERCENTILE) - 1);
  return mus[idx] ?? 0;
}

interface OpponentCandidate {
  id: string;
  rating: Rating;
  pWin: number;
  entropy: number;
  score: number;
}

/**
 * Score every uncompared opponent and return the highest-scoring one.
 * Score = entropy(pWin) / sigma^SIGMA_WEIGHT. Returns null if no eligible opponents.
 */
export function selectOpponent(
  variant: Variant,
  variantRating: Rating,
  pool: ReadonlyArray<Variant>,
  ratings: ReadonlyMap<string, Rating>,
  completedPairs: ReadonlySet<string>,
): { id: string; score: number; pWin: number; candidates: OpponentCandidate[] } | null {
  let bestId: string | null = null;
  let bestScore = -Infinity;
  let bestPWin = 0;
  const candidates: OpponentCandidate[] = [];

  for (const opp of pool) {
    if (opp.id === variant.id) continue;
    if (completedPairs.has(pairKey(variant.id, opp.id))) continue;

    const oppRating = ratings.get(opp.id) ?? createRating();
    // Bradley-Terry win probability
    const pWin = 1 / (1 + Math.exp(-(variantRating.mu - oppRating.mu) / BETA));
    // Outcome entropy: peaks at pWin=0.5, → 0 at extremes. Guard against log(0).
    const safeP = Math.min(Math.max(pWin, 1e-9), 1 - 1e-9);
    const entropy = -safeP * Math.log(safeP) - (1 - safeP) * Math.log(1 - safeP);
    // Score: entropy * 1/sigma^k. Avoid divide-by-zero with min sigma 0.0001.
    const sigma = Math.max(oppRating.sigma, 1e-4);
    const score = entropy / Math.pow(sigma, SIGMA_WEIGHT);

    candidates.push({ id: opp.id, rating: oppRating, pWin, entropy, score });

    if (score > bestScore) {
      bestScore = score;
      bestId = opp.id;
      bestPWin = pWin;
    }
  }

  if (bestId === null) return null;
  return { id: bestId, score: bestScore, pWin: bestPWin, candidates };
}

// ─── Comparison wrapper ───────────────────────────────────────────

function makeCallLLM(
  llm: EvolutionLLMClient,
  config: EvolutionConfig,
  invocationId: string,
  onUsage: (costUsd: number) => void,
): (prompt: string) => Promise<string> {
  return async (prompt: string): Promise<string> => {
    return llm.complete(prompt, 'ranking', {
      model: config.judgeModel as LLMCompletionOptions['model'],
      invocationId,
      taskType: 'comparison',
      // onUsage handled at the cost-tracker layer; we accept the parameter for interface
      // symmetry but the V2 LLM client routes spend through costTracker.recordSpend internally.
      // The caller can also subtract pre/post tracker spend as a fallback. We accept the
      // unused onUsage callback param to satisfy the spec; future work may surface
      // per-call usage events from createEvolutionLLMClient via an explicit hook.
    } as LLMCompletionOptions);
    // Note: onUsage param is currently unused. cost attribution flows through V2CostTracker
    // and the per-LLM-call writeMetric in createEvolutionLLMClient. Per-phase costs in
    // generateFromSeedArticle are computed via getTotalSpent() deltas around each phase.
  };
}

/** Build a V2Match from a comparison result. */
function buildMatch(
  result: ComparisonResult,
  idA: string,
  idB: string,
  judgeModel: string,
): V2Match {
  const isDraw = result.winner !== 'A' && result.winner !== 'B';
  const winnerId = result.winner === 'B' ? idB : idA;
  const loserId = result.winner === 'B' ? idA : idB;
  return {
    winnerId,
    loserId,
    result: isDraw ? 'draw' : 'win',
    confidence: result.confidence,
    judgeModel,
    reversed: false,
  };
}

// ─── Public API ───────────────────────────────────────────────────

export interface RankSingleVariantParams {
  variant: Variant;
  /** Local pool — must include `variant`. Mutated only by reads (the function does not push to it). */
  pool: Variant[];
  /** Local ratings map. MUTATED with chronological OpenSkill updates. Callers must deep-clone before passing. */
  ratings: Map<string, Rating>;
  /** Local match counts map. MUTATED with per-comparison increments. */
  matchCounts: Map<string, number>;
  /** Order-invariant set of pairs already compared. MUTATED with new pairs. */
  completedPairs: Set<string>;
  /** Shared comparison cache (order-invariant key — safe across agents). */
  cache: Map<string, ComparisonResult>;
  /** LLM client (already wrapped with cost tracker + retry). */
  llm: EvolutionLLMClient;
  config: EvolutionConfig;
  /** Invocation row id for llmCallTracking joins. */
  invocationId: string;
  logger?: EntityLogger;
}

/**
 * Rank a single variant via the binary-search loop.
 *
 * The variant must already be present in `pool` and have an entry in `ratings`
 * (callers should call `createRating()` and set it before invoking this function).
 *
 * Mutates `ratings`, `matchCounts`, and `completedPairs` as comparisons happen,
 * and returns the final status, the raw match buffer, and an execution detail blob
 * for the invocation row.
 */
export async function rankSingleVariant(
  params: RankSingleVariantParams,
): Promise<RankSingleVariantResult> {
  const {
    variant, pool, ratings, matchCounts, completedPairs,
    cache, llm, config, invocationId, logger,
  } = params;

  const matchBuffer: V2Match[] = [];
  const comparisons: RankSingleVariantComparisonRecord[] = [];

  if (!ratings.has(variant.id)) {
    ratings.set(variant.id, createRating());
  }

  const initialTop15Cutoff = computeTop15Cutoff(ratings);
  const localPoolVariantIds = pool.map(v => v.id);

  const callLLM = makeCallLLM(llm, config, invocationId, () => {});

  let status: RankSingleVariantStatus = 'no_more_opponents';
  let round = 0;

  const maxComparisons = config.maxComparisonsPerVariant ?? 15;

  try {
    // Cap comparisons at min(pool opponents, maxComparisonsPerVariant).
    while (round < Math.min(pool.length - 1, maxComparisons)) {
      round++;
      const variantRating = ratings.get(variant.id)!;
      const sel = selectOpponent(variant, variantRating, pool, ratings, completedPairs);
      if (sel === null) {
        status = 'no_more_opponents';
        logger?.debug('rankSingleVariant: no more opponents', {
          variantId: variant.id, comparisonsRun: comparisons.length, phaseName: 'ranking',
        });
        break;
      }

      logger?.debug('rankSingleVariant: selecting opponent', {
        variantId: variant.id,
        round,
        // Cap candidates logged to top 10 by score (to avoid log bloat at large pool sizes).
        candidatesConsidered: sel.candidates
          .slice()
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
          .map(c => ({ id: c.id, mu: c.rating.mu, sigma: c.rating.sigma, score: c.score, pWin: c.pWin })),
        pickedOpponent: sel.id,
        pickedScore: sel.score,
        phaseName: 'ranking',
      });

      const opp = pool.find(v => v.id === sel.id);
      if (!opp) {
        // Should never happen — selectOpponent only picks from `pool`.
        status = 'no_more_opponents';
        break;
      }

      const variantMuBefore = variantRating.mu;
      const variantSigmaBefore = variantRating.sigma;
      const opponentRatingBefore = ratings.get(opp.id) ?? createRating();
      const opponentMuBefore = opponentRatingBefore.mu;
      const opponentSigmaBefore = opponentRatingBefore.sigma;

      let comparisonResult: ComparisonResult;
      try {
        comparisonResult = await compareWithBiasMitigation(
          variant.text,
          opp.text,
          callLLM,
          cache,
        );
      } catch (e) {
        if (e instanceof BudgetExceededError) {
          status = 'budget';
          logger?.warn('rankSingleVariant: budget exceeded', {
            variantId: variant.id, comparisonsRun: comparisons.length, phaseName: 'ranking',
          });
          break;
        }
        // Non-budget LLM error — record as zero-confidence draw and continue.
        comparisonResult = { winner: 'TIE', confidence: 0, turns: 2 };
      }

      const match = buildMatch(comparisonResult, variant.id, opp.id, config.judgeModel);
      matchBuffer.push(match);
      completedPairs.add(pairKey(variant.id, opp.id));
      matchCounts.set(variant.id, (matchCounts.get(variant.id) ?? 0) + 1);
      matchCounts.set(opp.id, (matchCounts.get(opp.id) ?? 0) + 1);

      // Skip rating update for total LLM failures (confidence 0) to avoid noise.
      const isDraw = match.confidence < 0.3 || match.result === 'draw';
      const isFailure = match.confidence === 0;

      let variantMuAfter = variantMuBefore;
      let variantSigmaAfter = variantSigmaBefore;
      let opponentMuAfter = opponentMuBefore;
      let opponentSigmaAfter = opponentSigmaBefore;

      if (!isFailure) {
        if (isDraw) {
          const [newA, newB] = updateDraw(variantRating, opponentRatingBefore);
          ratings.set(variant.id, newA);
          ratings.set(opp.id, newB);
          variantMuAfter = newA.mu;
          variantSigmaAfter = newA.sigma;
          opponentMuAfter = newB.mu;
          opponentSigmaAfter = newB.sigma;
        } else {
          const winnerRating = match.winnerId === variant.id ? variantRating : opponentRatingBefore;
          const loserRating = match.winnerId === variant.id ? opponentRatingBefore : variantRating;
          const [newW, newL] = updateRating(winnerRating, loserRating);
          ratings.set(match.winnerId, newW);
          ratings.set(match.loserId, newL);
          if (match.winnerId === variant.id) {
            variantMuAfter = newW.mu;
            variantSigmaAfter = newW.sigma;
            opponentMuAfter = newL.mu;
            opponentSigmaAfter = newL.sigma;
          } else {
            variantMuAfter = newL.mu;
            variantSigmaAfter = newL.sigma;
            opponentMuAfter = newW.mu;
            opponentSigmaAfter = newW.sigma;
          }
        }
      }

      // Recompute cutoff and stop checks against the LATEST local ratings.
      const top15CutoffAfter = computeTop15Cutoff(ratings);
      const muPlusTwoSigma = variantMuAfter + ELIMINATION_CI * variantSigmaAfter;
      const eliminated = muPlusTwoSigma < top15CutoffAfter;
      const converged = variantSigmaAfter < CONVERGENCE_THRESHOLD;

      const outcome: 'win' | 'loss' | 'draw' = isDraw
        ? 'draw'
        : (match.winnerId === variant.id ? 'win' : 'loss');

      comparisons.push({
        round,
        opponentId: opp.id,
        selectionScore: sel.score,
        pWin: sel.pWin,
        variantMuBefore, variantSigmaBefore,
        opponentMuBefore, opponentSigmaBefore,
        outcome,
        confidence: match.confidence,
        variantMuAfter, variantSigmaAfter,
        opponentMuAfter, opponentSigmaAfter,
        top15CutoffAfter,
        muPlusTwoSigma,
        eliminated,
        converged,
      });

      logger?.debug('rankSingleVariant: comparison complete', {
        variantId: variant.id, round, opponentId: opp.id, outcome, confidence: match.confidence,
        variantMuBefore, variantMuAfter, variantSigmaBefore, variantSigmaAfter,
        top15CutoffAfter, phaseName: 'ranking',
      });

      if (eliminated) {
        status = 'eliminated';
        break;
      }
      if (converged) {
        status = 'converged';
        break;
      }
    }
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      status = 'budget';
    } else {
      throw e;
    }
  }

  const finalRating = ratings.get(variant.id) ?? createRating();
  const finalLocalTop15Cutoff = computeTop15Cutoff(ratings);

  logger?.info('rankSingleVariant: exit', {
    variantId: variant.id,
    stopReason: status,
    totalComparisons: comparisons.length,
    finalMu: finalRating.mu,
    finalSigma: finalRating.sigma,
    phaseName: 'ranking',
  });

  return {
    status,
    matches: matchBuffer,
    comparisonsRun: comparisons.length,
    detail: {
      variantId: variant.id,
      localPoolSize: pool.length,
      localPoolVariantIds,
      initialTop15Cutoff,
      comparisons,
      stopReason: status,
      totalComparisons: comparisons.length,
      finalLocalMu: finalRating.mu,
      finalLocalSigma: finalRating.sigma,
      finalLocalTop15Cutoff,
    },
  };
}
