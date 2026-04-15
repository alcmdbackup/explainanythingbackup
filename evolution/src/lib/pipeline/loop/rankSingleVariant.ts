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
  compareWithBiasMitigation, DEFAULT_UNCERTAINTY, DEFAULT_CONVERGENCE_UNCERTAINTY,
  _INTERNAL_ELO_SIGMA_SCALE,
} from '../../shared/computeRatings';
import type { EvolutionConfig, V2Match } from '../infra/types';
import type { EntityLogger } from '../infra/createEntityLogger';

// ─── Tunable constants ────────────────────────────────────────────

/** Bradley-Terry beta in Elo space (DEFAULT_UNCERTAINTY * sqrt(2) ≈ 188.56). */
export const BETA_ELO = DEFAULT_UNCERTAINTY * Math.SQRT2;

/** Single tunable knob for opponent scoring: entropy / uncertainty^UNCERTAINTY_WEIGHT.
 *  Higher values prefer reliable (low-uncertainty) opponents; lower values prefer close matches.
 *  See "Parameter analysis" in the planning doc. */
export const UNCERTAINTY_WEIGHT = 1.0;

/** Top-percentile cutoff for elimination check. 0.15 = top 15%. */
export const TOP_PERCENTILE = 0.15;

/** Uncertainty multiplier for the elimination upper-bound check (elo + ELIMINATION_CI*uncertainty < cutoff). */
export const ELIMINATION_CI = 2;

/** Convergence threshold for uncertainty — variant exits when its local uncertainty drops below this. */
export const CONVERGENCE_THRESHOLD = DEFAULT_CONVERGENCE_UNCERTAINTY;

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
  variantEloBefore: number;
  variantUncertaintyBefore: number;
  opponentEloBefore: number;
  opponentUncertaintyBefore: number;
  outcome: 'win' | 'loss' | 'draw';
  confidence: number;
  variantEloAfter: number;
  variantUncertaintyAfter: number;
  opponentEloAfter: number;
  opponentUncertaintyAfter: number;
  top15CutoffAfter: number;
  eloPlusTwoUncertainty: number;
  eliminated: boolean;
  converged: boolean;
  /** Wall-clock duration of this comparison (both 2-pass reversal LLM calls). */
  durationMs?: number;
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
  finalLocalElo: number;
  finalLocalUncertainty: number;
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

/** Compute the top-15% (by elo) cutoff from a ratings map. */
export function computeTop15Cutoff(ratings: ReadonlyMap<string, Rating>): number {
  const elos: number[] = [];
  for (const r of ratings.values()) elos.push(r.elo);
  if (elos.length === 0) return 0;
  elos.sort((a, b) => b - a);
  const idx = Math.max(0, Math.floor(elos.length * TOP_PERCENTILE) - 1);
  return elos[idx] ?? 0;
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
 * Score = entropy(pWin) / sigma^UNCERTAINTY_WEIGHT. Returns null if no eligible opponents.
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
    // Bradley-Terry win probability (Elo space)
    const pWin = 1 / (1 + Math.exp(-(variantRating.elo - oppRating.elo) / BETA_ELO));
    // Outcome entropy: peaks at pWin=0.5, → 0 at extremes. Guard against log(0).
    const safeP = Math.min(Math.max(pWin, 1e-9), 1 - 1e-9);
    const entropy = -safeP * Math.log(safeP) - (1 - safeP) * Math.log(1 - safeP);
    // Score: entropy * 1/uncertainty^k. Avoid divide-by-zero with min uncertainty 0.0001.
    const uncertainty = Math.max(oppRating.uncertainty, 1e-4);
    const score = entropy / Math.pow(uncertainty, UNCERTAINTY_WEIGHT);

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
          .map(c => ({ id: c.id, elo: c.rating.elo, uncertainty: c.rating.uncertainty, score: c.score, pWin: c.pWin })),
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

      const variantEloBefore = variantRating.elo;
      const variantUncertaintyBefore = variantRating.uncertainty;
      const opponentRatingBefore = ratings.get(opp.id) ?? createRating();
      const opponentEloBefore = opponentRatingBefore.elo;
      const opponentUncertaintyBefore = opponentRatingBefore.uncertainty;

      let comparisonResult: ComparisonResult;
      const comparisonStartTime = Date.now();
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
      const comparisonDurationMs = Date.now() - comparisonStartTime;

      const match = buildMatch(comparisonResult, variant.id, opp.id, config.judgeModel);
      matchBuffer.push(match);
      completedPairs.add(pairKey(variant.id, opp.id));
      matchCounts.set(variant.id, (matchCounts.get(variant.id) ?? 0) + 1);
      matchCounts.set(opp.id, (matchCounts.get(opp.id) ?? 0) + 1);

      // Skip rating update for total LLM failures (confidence 0) to avoid noise.
      const isDraw = match.confidence < 0.3 || match.result === 'draw';
      const isFailure = match.confidence === 0;

      let variantEloAfter = variantEloBefore;
      let variantUncertaintyAfter = variantUncertaintyBefore;
      let opponentEloAfter = opponentEloBefore;
      let opponentUncertaintyAfter = opponentUncertaintyBefore;

      if (!isFailure) {
        if (isDraw) {
          const [newA, newB] = updateDraw(variantRating, opponentRatingBefore);
          ratings.set(variant.id, newA);
          ratings.set(opp.id, newB);
          variantEloAfter = newA.elo;
          variantUncertaintyAfter = newA.uncertainty;
          opponentEloAfter = newB.elo;
          opponentUncertaintyAfter = newB.uncertainty;
        } else {
          const winnerRating = match.winnerId === variant.id ? variantRating : opponentRatingBefore;
          const loserRating = match.winnerId === variant.id ? opponentRatingBefore : variantRating;
          const [newW, newL] = updateRating(winnerRating, loserRating);
          ratings.set(match.winnerId, newW);
          ratings.set(match.loserId, newL);
          if (match.winnerId === variant.id) {
            variantEloAfter = newW.elo;
            variantUncertaintyAfter = newW.uncertainty;
            opponentEloAfter = newL.elo;
            opponentUncertaintyAfter = newL.uncertainty;
          } else {
            variantEloAfter = newL.elo;
            variantUncertaintyAfter = newL.uncertainty;
            opponentEloAfter = newW.elo;
            opponentUncertaintyAfter = newW.uncertainty;
          }
        }
      }

      // Recompute cutoff and stop checks against the LATEST local ratings.
      const top15CutoffAfter = computeTop15Cutoff(ratings);
      const eloPlusTwoUncertainty = variantEloAfter + ELIMINATION_CI * variantUncertaintyAfter;
      const eliminated = eloPlusTwoUncertainty < top15CutoffAfter;
      const converged = variantUncertaintyAfter < CONVERGENCE_THRESHOLD;

      const outcome: 'win' | 'loss' | 'draw' = isDraw
        ? 'draw'
        : (match.winnerId === variant.id ? 'win' : 'loss');

      comparisons.push({
        round,
        opponentId: opp.id,
        selectionScore: sel.score,
        pWin: sel.pWin,
        variantEloBefore, variantUncertaintyBefore,
        opponentEloBefore, opponentUncertaintyBefore,
        outcome,
        confidence: match.confidence,
        variantEloAfter, variantUncertaintyAfter,
        opponentEloAfter, opponentUncertaintyAfter,
        top15CutoffAfter,
        eloPlusTwoUncertainty,
        eliminated,
        converged,
        durationMs: comparisonDurationMs,
      });

      logger?.debug('rankSingleVariant: comparison complete', {
        variantId: variant.id, round, opponentId: opp.id, outcome, confidence: match.confidence,
        variantEloBefore, variantEloAfter, variantUncertaintyBefore, variantUncertaintyAfter,
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
    finalElo: finalRating.elo,
    finalUncertainty: finalRating.uncertainty,
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
      finalLocalElo: finalRating.elo,
      finalLocalUncertainty: finalRating.uncertainty,
      finalLocalTop15Cutoff,
    },
  };
}
