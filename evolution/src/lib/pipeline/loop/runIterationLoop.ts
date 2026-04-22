// Orchestrator-driven evolution loop with config-driven iteration dispatch.
// Iterates over config.iterationConfigs[], dispatching generate or swiss agents per iteration.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variant } from '../../types';
import { BudgetExceededError } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import { createRating, isConverged, DEFAULT_CONVERGENCE_UNCERTAINTY } from '../../shared/computeRatings';
import type { EvolutionConfig, EvolutionResult, V2Match, IterationResult, IterationStopReason } from '../infra/types';

import { createCostTracker, createIterationBudgetTracker, IterationBudgetExceededError } from '../infra/trackBudget';

import type { EntityLogger } from '../infra/createEntityLogger';
import { selectWinner } from '../../shared/selectWinner';
import { GenerateFromPreviousArticleAgent } from '../../core/agents/generateFromPreviousArticle';
import { SwissRankingAgent, type SwissRankingMatchEntry } from '../../core/agents/SwissRankingAgent';
import { MergeRatingsAgent, type MergeMatchEntry } from '../../core/agents/MergeRatingsAgent';
import { swissPairing, pairKey, MAX_PAIRS_PER_ROUND } from './swissPairing';
import { computeTop15Cutoff } from './rankSingleVariant';
import { resolveParent, hashSeed } from './resolveParent';
import { DEFAULT_TACTICS, type IterationSnapshot } from '../../schemas';
import { deriveSeed, SeededRandom } from '../../shared/seededRandom';
import { selectTacticWeighted } from '../../core/tactics';
import { createSeededRng } from '../../metrics/experimentMetrics';
import type { AgentContext } from '../../core/types';
import { estimateAgentCost } from '../infra/estimateCosts';
import { DISPATCH_SAFETY_CAP } from './projectDispatchPlan';
import { resolveSequentialFloor } from './budgetFloorResolvers';

// ─── Config validation ───────────────────────────────────────────

function validateConfig(config: EvolutionConfig): void {
  if (!config.iterationConfigs || config.iterationConfigs.length === 0) {
    throw new Error('iterationConfigs must be a non-empty array');
  }
  if (config.iterationConfigs.length > MAX_ORCHESTRATOR_ITERATIONS) {
    throw new Error(`Too many iterations: ${config.iterationConfigs.length} (max ${MAX_ORCHESTRATOR_ITERATIONS})`);
  }
  if (config.budgetUsd <= 0 || config.budgetUsd > 50) {
    throw new Error(`Invalid budgetUsd: ${config.budgetUsd} (must be >0 and <=50)`);
  }
  if (!config.judgeModel || config.judgeModel.trim() === '') {
    throw new Error('judgeModel must be a non-empty string');
  }
  if (!config.generationModel || config.generationModel.trim() === '') {
    throw new Error('generationModel must be a non-empty string');
  }
}

// ─── Kill detection ──────────────────────────────────────────────

async function isRunKilled(db: SupabaseClient, runId: string, logger?: EntityLogger): Promise<boolean> {
  try {
    const { data, error } = await db.from('evolution_runs').select('status').eq('id', runId).single();
    if (error) {
      logger?.warn('Kill detection DB error (continuing)', { phaseName: 'kill_check' });
      return false;
    }
    return data?.status === 'failed' || data?.status === 'cancelled';
  } catch {
    logger?.warn('Kill detection exception (continuing)', { phaseName: 'kill_check' });
    return false;
  }
}

// ─── Safety cap ──────────────────────────────────────────────────

/** Hard cap on orchestrator iterations to prevent runaway loops. */
const MAX_ORCHESTRATOR_ITERATIONS = 20;

function topKEloValues(ratings: ReadonlyMap<string, Rating>, k: number): number[] {
  return [...ratings.values()].map((r) => r.elo).sort((a, b) => b - a).slice(0, k);
}

/** Phase 4b: parallel array — uncertainty for the same top-K ranking by elo. Returned in
 *  matching index order so EloTab can render an uncertainty band around each line. */
function topKUncertainties(ratings: ReadonlyMap<string, Rating>, k: number): number[] {
  return [...ratings.values()].sort((a, b) => b.elo - a.elo).slice(0, k).map((r) => r.uncertainty);
}

// ─── Snapshot helpers ────────────────────────────────────────────

function recordSnapshot(
  iteration: number,
  iterationType: 'generate' | 'swiss',
  phase: 'start' | 'end',
  pool: ReadonlyArray<Variant>,
  ratings: ReadonlyMap<string, Rating>,
  matchCounts: ReadonlyMap<string, number>,
  options?: {
    discardedVariantIds?: string[];
    discardReasons?: Record<string, { elo: number; top15Cutoff: number }>;
    stopReason?: string;
    budgetAllocated?: number;
    budgetSpent?: number;
  },
): IterationSnapshot {
  const ratingsObj = Object.fromEntries(
    [...ratings.entries()].map(([id, r]) => [id, { elo: r.elo, uncertainty: r.uncertainty }]),
  );
  return {
    iteration,
    iterationType,
    phase,
    capturedAt: new Date().toISOString(),
    poolVariantIds: pool.map((v) => v.id),
    ratings: ratingsObj,
    matchCounts: Object.fromEntries(matchCounts),
    ...(options?.discardedVariantIds !== undefined && { discardedVariantIds: options.discardedVariantIds }),
    ...(options?.discardReasons !== undefined && { discardReasons: options.discardReasons }),
    ...(options?.stopReason !== undefined && { stopReason: options.stopReason }),
    ...(options?.budgetAllocated !== undefined && { budgetAllocated: options.budgetAllocated }),
    ...(options?.budgetSpent !== undefined && { budgetSpent: options.budgetSpent }),
  };
}

// ─── Eligibility ─────────────────────────────────────────────────

const ELIGIBILITY_Z_SCORE = 1.04;
const MIN_SWISS_POOL = 3;

function computeEligibleIds(
  pool: ReadonlyArray<Variant>,
  ratings: ReadonlyMap<string, Rating>,
): string[] {
  if (pool.length < 2) return [];
  const sortedByElo = pool
    .map((v) => ({ id: v.id, elo: ratings.get(v.id)?.elo ?? 0 }))
    .sort((a, b) => b.elo - a.elo);
  const top15Cutoff = computeTop15Cutoff(ratings);

  const eligible = sortedByElo.filter(({ id }) => {
    const r = ratings.get(id);
    if (!r) return false;
    return r.elo + ELIGIBILITY_Z_SCORE * r.uncertainty >= top15Cutoff;
  });

  if (eligible.length < MIN_SWISS_POOL) {
    return sortedByElo.slice(0, MIN_SWISS_POOL).map((e) => e.id);
  }
  return eligible.map((e) => e.id);
}

function allConverged(
  eligibleIds: ReadonlyArray<string>,
  ratings: ReadonlyMap<string, Rating>,
): boolean {
  if (eligibleIds.length === 0) return false;
  return eligibleIds.every((id) => {
    const r = ratings.get(id);
    return r ? isConverged(r, DEFAULT_CONVERGENCE_UNCERTAINTY) : false;
  });
}

// ─── Main function ───────────────────────────────────────────────

/**
 * Run the orchestrator-driven evolution pipeline. Iterates over config.iterationConfigs[],
 * dispatching generate or swiss agents per iteration with per-iteration budget tracking.
 */
export async function evolveArticle(
  originalText: string,
  llmProvider: {
    complete(
      prompt: string,
      label: string,
      opts?: { model?: string },
    ): Promise<string | { text: string; usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number } }>;
  },
  db: SupabaseClient,
  runId: string,
  config: EvolutionConfig,
  options?: {
    logger?: EntityLogger;
    initialPool?: Array<Variant & { elo?: number; uncertainty?: number }>;
    experimentId?: string;
    strategyId?: string;
    deadlineMs?: number;
    signal?: AbortSignal;
    randomSeed?: bigint;
    /** UUID of the seed variant persisted before the iteration loop (for result tracking). */
    seedVariantId?: string;
  },
): Promise<EvolutionResult> {
  validateConfig(config);

  const tactics = config.strategies && config.strategies.length > 0
    ? config.strategies
    : [...DEFAULT_TACTICS];

  // Apply defaults for legacy fields too (some metric paths still read them).
  const resolvedConfig: EvolutionConfig = {
    ...config,
    iterationConfigs: config.iterationConfigs,
    calibrationOpponents: config.calibrationOpponents ?? 5,
    tournamentTopK: config.tournamentTopK ?? 5,
    strategies: tactics,
  };

  const noopLogger: EntityLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const logger = options?.logger ?? noopLogger;
  const costTracker = createCostTracker(resolvedConfig.budgetUsd);
  // No shared LLM client — Agent.run() builds per-invocation scoped clients via rawProvider.
  const randomSeed = options?.randomSeed ?? BigInt(0);

  logger.info('Config validation passed', {
    budgetUsd: resolvedConfig.budgetUsd,
    generationModel: resolvedConfig.generationModel, judgeModel: resolvedConfig.judgeModel,
    tactics,
    phaseName: 'config_validation',
  });

  // Local state
  const pool: Variant[] = [];
  const ratings = new Map<string, Rating>();
  const matchCounts = new Map<string, number>();
  const allMatches: V2Match[] = [];
  const eloHistory: number[][] = [];
  // Phase 4b: parallel array — uncertainty values matching topKEloValues' ranking by elo.
  // Enables EloTab to render an uncertainty band around each line.
  const uncertaintyHistory: number[][] = [];
  const diversityHistory: number[] = [];
  const comparisonCache = new Map<string, ComparisonResult>();
  const completedPairs = new Set<string>();
  const iterationSnapshots: IterationSnapshot[] = [];
  const discardedVariants: Variant[] = [];
  const discardedLocalRatings = new Map<string, Rating>();
  const iterationResults: IterationResult[] = [];

  // Seed variant is no longer added to the pool — it serves only as generation source text.
  // Seed generation is handled in claimAndExecuteRun (pre-iteration setup).

  // Load initial pool entries (e.g., arena entries with existing ratings).
  if (options?.initialPool) {
    for (const entry of options.initialPool) {
      pool.push(entry);
      ratings.set(entry.id,
        entry.elo !== undefined && entry.uncertainty !== undefined
          ? { elo: entry.elo, uncertainty: entry.uncertainty }
          : createRating(),
      );
    }
    logger.info('Initial pool loaded', { entriesLoaded: options.initialPool.length, poolSize: pool.length, phaseName: 'initialization' });
  }

  let stopReason: EvolutionResult['stopReason'] = 'completed';
  let iteration = 0;
  let executionOrder = 0;
  // Dispatch-count observables for projected-vs-actual Budget Floor Sensitivity.
  let parallelDispatchedCount = 0;
  let sequentialDispatchedCount = 0;
  let actualAvgCostPerAgent: number | null = null;

  const totalBudget = resolvedConfig.budgetUsd;
  const initialAgentCostEstimate = estimateAgentCost(
    originalText.length, tactics[0]!, resolvedConfig.generationModel,
    resolvedConfig.judgeModel, 1, resolvedConfig.maxComparisonsPerVariant ?? 15,
  );

  // ─── Config-driven iteration loop ─────────────────────────────
  for (let iterIdx = 0; iterIdx < resolvedConfig.iterationConfigs.length; iterIdx++) {
    const iterCfg = resolvedConfig.iterationConfigs[iterIdx]!;
    const iterBudgetUsd = (iterCfg.budgetPercent / 100) * totalBudget;
    const iterTracker = createIterationBudgetTracker(iterBudgetUsd, costTracker, iterIdx);

    // Kill / abort / deadline checks at iteration boundary
    if (options?.signal?.aborted) {
      logger.warn('Run aborted via signal', { iteration: iterIdx + 1, phaseName: 'loop' });
      stopReason = 'killed';
      break;
    }
    if (await isRunKilled(db, runId, logger)) {
      logger.warn('Run killed externally', { iteration: iterIdx + 1, phaseName: 'loop' });
      stopReason = 'killed';
      break;
    }
    if (options?.deadlineMs && Date.now() >= options.deadlineMs) {
      logger.warn('Wall clock deadline reached', { iteration: iterIdx + 1, phaseName: 'loop' });
      stopReason = 'deadline';
      break;
    }

    iteration++;
    const iterType = iterCfg.agentType;
    logger.info(`Starting iteration ${iteration} (${iterType})`, { iteration, iterIdx, budgetUsd: iterBudgetUsd, phaseName: 'loop' });

    // Snapshot at iteration start
    iterationSnapshots.push(recordSnapshot(iteration, iterType, 'start', pool, ratings, matchCounts, {
      budgetAllocated: iterBudgetUsd,
    }));

    let iterStopReason: IterationStopReason = 'iteration_complete';
    let iterVariantsCreated = 0;
    let iterMatchesCompleted = 0;

    try {
      if (iterType === 'generate') {
        // ─── Generate iteration ───────────────────────────────
        // Phase 7b: restructured to accumulate parallel + top-up match buffers, then
        // invoke MergeRatingsAgent ONCE at iteration end over the combined buffers.
        // Top-up agents reuse the iteration-start snapshot (option A in decision #8) so
        // there's no data dependency requiring an intermediate merge.
        const initialPoolSnapshot: Variant[] = [...pool];
        const initialRatingsSnapshot = new Map(ratings);
        const initialMatchCountsSnapshot = new Map(matchCounts);

        // Read EVOLUTION_TOPUP_ENABLED once per iteration (not per dispatch). Default
        // true; set to 'false' as a rollback kill-switch if top-up misbehaves in prod.
        const topUpEnabled = process.env.EVOLUTION_TOPUP_ENABLED !== 'false';

        // Budget-aware parallel-batch size: compute how many agents we can afford
        // within iteration budget AT UPPER-BOUND cost (reservation safety).
        const availBudget = iterTracker.getAvailableBudget();
        const maxComp = resolvedConfig.maxComparisonsPerVariant ?? 15;
        const estPerAgent = estimateAgentCost(
          originalText.length, tactics[0]!, resolvedConfig.generationModel,
          resolvedConfig.judgeModel, pool.length, maxComp,
        );
        const maxAffordable = Math.max(1, Math.floor(availBudget / estPerAgent));
        // DISPATCH_SAFETY_CAP is a defense-in-depth rail; budget is the primary governor.
        const parallelDispatchCount = Math.min(DISPATCH_SAFETY_CAP, maxAffordable);

        // Select tactics: per-iteration guidance takes precedence over strategy-level, then round-robin.
        const guidance = iterCfg.generationGuidance ?? resolvedConfig.generationGuidance;
        const selectTactic = (i: number): string => {
          if (guidance && guidance.length > 0) {
            const rng = new SeededRandom(deriveSeed(randomSeed, `iter${iteration}`, `tactic_sel${i}`));
            return selectTacticWeighted(guidance, rng);
          }
          return tactics[i % tactics.length]!;
        };

        const parallelTactics = Array.from({ length: parallelDispatchCount }, (_, i) => selectTactic(i));
        logger.info('Dispatching generate iteration (parallel batch)', {
          iteration, iterIdx,
          parallelDispatchCount, maxAffordable, safetyCap: DISPATCH_SAFETY_CAP,
          iterBudgetUsd, availBudget, estPerAgent,
          tactics: parallelTactics,
          topUpEnabled,
          selectionMode: guidance ? (iterCfg.generationGuidance ? 'iteration-weighted' : 'strategy-weighted') : 'round-robin',
          phaseName: 'generation',
        });

        const iterSourceMode = iterCfg.sourceMode ?? 'seed';
        const iterQualityCutoff = iterCfg.qualityCutoff;
        const seedVariantForResolve = { id: options?.seedVariantId ?? '', text: originalText };

        // Bug fix (20260421): in pool mode, parents must be drawn from variants
        // produced by THIS run only — never from arena entries that came from prior
        // runs of the same prompt. Arena entries still participate in ranking
        // (in-iteration rankSingleVariant uses `initialPoolSnapshot` unfiltered),
        // they're just excluded as candidate *parents*. Computed once per iteration;
        // reused by both the parallel batch and top-up dispatches below.
        const inRunPool = initialPoolSnapshot.filter((v) => !v.fromArena);
        const poolForParentResolve = iterSourceMode === 'pool' ? inRunPool : initialPoolSnapshot;
        const arenaOnlyPool = initialPoolSnapshot.length > 0 && inRunPool.length === 0;

        // Helper: build the AgentContext + kick off one GFSA agent run.
        const dispatchOneAgent = (tactic: string, phase: 'parallel' | 'top_up') => {
          const execOrder = ++executionOrder;
          const pickRng = createSeededRng(hashSeed(runId, iteration, execOrder));
          const resolved = resolveParent({
            sourceMode: iterSourceMode,
            qualityCutoff: iterQualityCutoff,
            seedVariant: seedVariantForResolve,
            pool: poolForParentResolve,
            ratings: initialRatingsSnapshot,
            rng: pickRng,
            warn: (msg, c) => logger.warn(msg, { ...c, phaseName: 'generation', iteration, execOrder, dispatchPhase: phase }),
          });
          // Relabel the generic empty_pool fallback when the real cause was "we
          // filtered out arena entries and nothing in-run was left". Gives operators
          // a distinct log string to grep for without changing resolveParent's type.
          if (iterSourceMode === 'pool' && resolved.fallbackReason === 'empty_pool' && arenaOnlyPool) {
            logger.warn('resolveParent: no same-run variants available, fell back to seed', {
              phaseName: 'generation',
              iteration,
              execOrder,
              dispatchPhase: phase,
              fallbackReason: 'no_same_run_variants',
              inRunSize: 0,
              arenaFilteredCount: initialPoolSnapshot.length,
            });
          }
          const ctxForAgent: AgentContext = {
            db, runId, iteration,
            executionOrder: execOrder,
            invocationId: '',
            randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `gfsa${execOrder}`),
            logger, costTracker: iterTracker, config: resolvedConfig,
            agentIndex: execOrder,
            rawProvider: llmProvider,
            defaultModel: resolvedConfig.generationModel,
            generationTemperature: resolvedConfig.generationTemperature,
          };
          const agent = new GenerateFromPreviousArticleAgent();
          return agent.run({
            parentText: resolved.text,
            tactic,
            initialPool: initialPoolSnapshot,
            initialRatings: initialRatingsSnapshot,
            initialMatchCounts: initialMatchCountsSnapshot,
            cache: comparisonCache,
            parentVariantId: resolved.variantId,
          }, ctxForAgent);
        };

        // ─── Parallel batch ─────────────────────────────────────
        const parallelPromises = parallelTactics.map((t) => dispatchOneAgent(t, 'parallel'));
        const parallelResults = await Promise.allSettled(parallelPromises);

        // Accumulate surfaced + discarded from parallel batch. Do NOT merge yet.
        const surfacedVariants: Variant[] = [];
        const surfacedBuffers: MergeMatchEntry[][] = [];
        const discardedIds: string[] = [];
        const discardReasonsMap: Record<string, { elo: number; top15Cutoff: number }> = {};
        let parallelSpend = 0;
        let parallelSuccesses = 0;
        let topUpDispatched = 0;
        let topUpStopReason: 'floor' | 'safety_cap' | 'budget_exhausted' | 'killed' | 'deadline' | 'no_budget_at_start' | 'feature_disabled' | null = null;

        const absorbResult = (r: PromiseSettledResult<Awaited<ReturnType<GenerateFromPreviousArticleAgent['run']>>>): boolean => {
          // Returns true if a fatal run-level error should re-throw.
          if (r.status === 'rejected') {
            if (r.reason instanceof IterationBudgetExceededError) {
              iterStopReason = 'iteration_budget_exceeded';
              return false;
            }
            if (r.reason instanceof BudgetExceededError) {
              throw r.reason;
            }
            logger.warn('generateFromPreviousArticle agent rejected', {
              phaseName: 'generation',
              error: (r.reason instanceof Error ? r.reason.message : String(r.reason)).slice(0, 500),
            });
            return false;
          }
          if (r.value.budgetExceeded) { iterStopReason = 'iteration_budget_exceeded'; return false; }
          if (!r.value.success || !r.value.result) return false;

          const out = r.value.result;
          if (out.surfaced && out.variant) {
            surfacedVariants.push(out.variant);
            surfacedBuffers.push(out.matches.map((m) => ({ match: m, idA: m.winnerId, idB: m.loserId })));
          } else if (out.variant && !out.surfaced) {
            discardedVariants.push(out.variant);
            discardedIds.push(out.variant.id);
            if (out.discardReason) discardReasonsMap[out.variant.id] = out.discardReason;
            if (out.localRating) discardedLocalRatings.set(out.variant.id, out.localRating);
          }
          return false;
        };

        for (const r of parallelResults) {
          absorbResult(r);
          if (r.status === 'fulfilled' && r.value.success && r.value.cost > 0) {
            parallelSpend += r.value.cost;
            parallelSuccesses += 1;
          }
        }

        // Measure actualAvgCostPerAgent from parallel batch's real spends.
        let actualAvgCost: number | null = null;
        if (parallelSuccesses > 0) {
          actualAvgCost = parallelSpend / parallelSuccesses;
          if (iterIdx === 0) actualAvgCostPerAgent = actualAvgCost;
        }
        if (!actualAvgCost || !Number.isFinite(actualAvgCost) || actualAvgCost <= 0) {
          logger.warn('actualAvgCostPerAgent fallback to initialAgentCostEstimate', {
            phaseName: 'generation', iteration, iterIdx, parallelSuccesses,
            reason: 'scope_zero_or_no_success',
          });
          actualAvgCost = estPerAgent;
        }

        // ─── Top-up phase ───────────────────────────────────────
        if (topUpEnabled && iterStopReason === 'iteration_complete') {
          // Kill / deadline check before entering top-up loop.
          if (options?.signal?.aborted) {
            topUpStopReason = 'killed';
          } else if (options?.deadlineMs && Date.now() >= options.deadlineMs) {
            topUpStopReason = 'deadline';
          } else if (await isRunKilled(db, runId, logger)) {
            topUpStopReason = 'killed';
          }

          if (topUpStopReason === null) {
            const sequentialFloor = resolveSequentialFloor(
              resolvedConfig, iterBudgetUsd, estPerAgent, actualAvgCost,
            );
            let topUpSpend = 0;
            let remaining = iterBudgetUsd - parallelSpend - topUpSpend;

            while (remaining - actualAvgCost >= sequentialFloor) {
              // Safety cap (parallel + top-up total).
              if (parallelDispatchCount + topUpDispatched >= DISPATCH_SAFETY_CAP) {
                topUpStopReason = 'safety_cap';
                break;
              }
              // Bounded kill-check: every 5 top-up dispatches hit the DB.
              if (topUpDispatched > 0 && topUpDispatched % 5 === 0) {
                if (options?.signal?.aborted) { topUpStopReason = 'killed'; break; }
                if (options?.deadlineMs && Date.now() >= options.deadlineMs) { topUpStopReason = 'deadline'; break; }
                if (await isRunKilled(db, runId, logger)) { topUpStopReason = 'killed'; break; }
              }
              // Cheap per-dispatch signal check.
              if (options?.signal?.aborted) { topUpStopReason = 'killed'; break; }

              const topUpTactic = selectTactic(parallelDispatchCount + topUpDispatched);
              const topUpResult = await Promise.allSettled([dispatchOneAgent(topUpTactic, 'top_up')]);
              absorbResult(topUpResult[0]!);

              if (topUpResult[0]!.status === 'fulfilled' && topUpResult[0]!.value.success) {
                topUpSpend += topUpResult[0]!.value.cost;
                topUpDispatched += 1;
              } else {
                // Failed top-up dispatch — stop to avoid burning budget on more failures.
                topUpStopReason = 'budget_exhausted';
                break;
              }
              remaining = iterBudgetUsd - parallelSpend - topUpSpend;
            }
            if (topUpStopReason === null) topUpStopReason = 'budget_exhausted';

            logger.info('Top-up loop complete', {
              phaseName: 'generation', iteration, iterIdx,
              parallelDispatched: parallelDispatchCount,
              topUpDispatched,
              topUpStopReason,
              actualAvgCost, sequentialFloor,
              remainingIterBudget: remaining,
            });
          }
        } else if (!topUpEnabled) {
          topUpStopReason = 'feature_disabled';
        }

        iterVariantsCreated = surfacedVariants.length;

        // Update observables: iter 0 = parallel bucket, later iters = sequential bucket,
        // consistent with pre-Phase-7 labeling. Total dispatches per iter = parallel + top-up.
        const totalIterDispatches = parallelDispatchCount + topUpDispatched;
        if (iterIdx === 0) {
          parallelDispatchedCount = totalIterDispatches;
        } else {
          sequentialDispatchedCount += totalIterDispatches;
        }

        // ─── Pre-merge spend log ────────────────────────────────
        // If the merge throws, the wasted cost is attributable from logs even without
        // persisted invocation rows.
        logger.info('iteration pre-merge accounting', {
          phaseName: 'generation', iteration, iterIdx,
          parallelBatchSize: parallelDispatchCount, topUpBatchSize: topUpDispatched,
          parallelSpend, topUpSpend: iterTracker.getTotalSpent() - parallelSpend,
          totalIterSpend: iterTracker.getTotalSpent(),
        });

        // ─── Single merge pass over combined buffers ────────────
        const mergeExecOrder = ++executionOrder;
        const mergeCtx: AgentContext = {
          db, runId, iteration,
          executionOrder: mergeExecOrder,
          invocationId: '',
          randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `merge${mergeExecOrder}`),
          logger, costTracker: iterTracker, config: resolvedConfig,
        };
        const mergeAgent = new MergeRatingsAgent();
        const mergeResult = await mergeAgent.run({
          iterationType: 'generate',
          matchBuffers: surfacedBuffers,
          newVariants: surfacedVariants,
          pool, ratings, matchCounts, matchHistory: allMatches,
        }, mergeCtx);

        if (mergeResult.budgetExceeded) iterStopReason = 'iteration_budget_exceeded';

        // Track top-K elo history and snapshot iteration end (with discarded info).
        const topK = resolvedConfig.tournamentTopK ?? 5;
        const eloValues = topKEloValues(ratings, topK);
        eloHistory.push(eloValues);

        iterationSnapshots.push(recordSnapshot(iteration, 'generate', 'end', pool, ratings, matchCounts, {
          discardedVariantIds: discardedIds,
          discardReasons: discardReasonsMap,
          stopReason: iterStopReason,
          budgetAllocated: iterBudgetUsd,
          budgetSpent: iterTracker.getTotalSpent(),
        }));

        logger.info('Generate iteration complete', {
          iteration, iterIdx,
          surfaced: surfacedVariants.length,
          discarded: discardedIds.length,
          iterStopReason,
          budgetSpent: iterTracker.getTotalSpent(),
          topEloValues: eloValues.slice(0, 5),
          phaseName: 'generation',
        });

      } else if (iterType === 'swiss') {
        // ─── Swiss iteration ──────────────────────────────────
        // Loop SwissRankingAgent + MergeRatingsAgent until convergence, no pairs, or iteration budget.
        let swissRound = 0;
        const MAX_SWISS_ROUNDS = 10; // Safety cap within a single swiss iteration

        while (swissRound < MAX_SWISS_ROUNDS) {
          swissRound++;

          const eligibleIds = computeEligibleIds(pool, ratings);
          if (eligibleIds.length < 2) {
            iterStopReason = 'iteration_no_pairs';
            break;
          }
          if (allConverged(eligibleIds, ratings)) {
            iterStopReason = 'iteration_converged';
            break;
          }

          const candidatePairs = swissPairing(eligibleIds, ratings, completedPairs, MAX_PAIRS_PER_ROUND);
          if (candidatePairs.length === 0) {
            iterStopReason = 'iteration_no_pairs';
            break;
          }

          const swissExecOrder = ++executionOrder;
          const swissCtx: AgentContext = {
            db, runId, iteration,
            executionOrder: swissExecOrder,
            invocationId: '',
            randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `swiss${swissExecOrder}`),
            logger, costTracker: iterTracker, config: resolvedConfig,
            rawProvider: llmProvider,
            defaultModel: resolvedConfig.generationModel,
            generationTemperature: resolvedConfig.generationTemperature,
          };
          const swissAgent = new SwissRankingAgent();
          const swissResult = await swissAgent.run({
            eligibleIds,
            completedPairs,
            pool,
            ratings,
            cache: comparisonCache,
          }, swissCtx);

          const swissOutput = swissResult.result;
          if (!swissOutput || swissOutput.status === 'no_pairs') {
            iterStopReason = 'iteration_no_pairs';
            break;
          }

          // Merge unconditionally — paid-for matches must reach global ratings before budget exit.
          const mergeExecOrder = ++executionOrder;
          const mergeCtx: AgentContext = {
            db, runId, iteration,
            executionOrder: mergeExecOrder,
            invocationId: '',
            randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `merge${mergeExecOrder}`),
            logger, costTracker: iterTracker, config: resolvedConfig,
          };
          const mergeAgent = new MergeRatingsAgent();
          const mergeBuffers: MergeMatchEntry[][] = [
            swissOutput.matches.map((m: SwissRankingMatchEntry) => ({ match: m.match, idA: m.idA, idB: m.idB })),
          ];
          const mergeResult = await mergeAgent.run({
            iterationType: 'swiss',
            matchBuffers: mergeBuffers,
            newVariants: [],
            pool, ratings, matchCounts, matchHistory: allMatches,
          }, mergeCtx);

          iterMatchesCompleted += swissOutput.matches.length;

          // Update completedPairs from this round's matches.
          for (const m of swissOutput.matches) {
            completedPairs.add(pairKey(m.idA, m.idB));
          }

          if (swissResult.budgetExceeded || mergeResult.budgetExceeded || swissOutput.status === 'budget') {
            iterStopReason = 'iteration_budget_exceeded';
            break;
          }
        }

        const topK = resolvedConfig.tournamentTopK ?? 5;
        const eloValues = topKEloValues(ratings, topK);
        eloHistory.push(eloValues);

        iterationSnapshots.push(recordSnapshot(iteration, 'swiss', 'end', pool, ratings, matchCounts, {
          stopReason: iterStopReason,
          budgetAllocated: iterBudgetUsd,
          budgetSpent: iterTracker.getTotalSpent(),
        }));

        logger.info('Swiss iteration complete', {
          iteration, iterIdx,
          rounds: swissRound,
          matchesCompleted: iterMatchesCompleted,
          iterStopReason,
          budgetSpent: iterTracker.getTotalSpent(),
          topEloValues: eloValues.slice(0, 5),
          phaseName: 'ranking',
        });
      }
    } catch (err) {
      // Run-level BudgetExceededError stops the entire run.
      if (err instanceof BudgetExceededError && !(err instanceof IterationBudgetExceededError)) {
        logger.warn('Run-level budget exceeded', { iteration, iterIdx, phaseName: 'loop', error: err.message });
        stopReason = 'total_budget_exceeded';

        // Record partial iteration result.
        iterStopReason = 'iteration_budget_exceeded';
        iterationResults.push({
          iteration,
          agentType: iterType,
          stopReason: iterStopReason,
          budgetAllocated: iterBudgetUsd,
          budgetSpent: iterTracker.getTotalSpent(),
          variantsCreated: iterVariantsCreated,
          matchesCompleted: iterMatchesCompleted,
        });
        break;
      }
      throw err; // Re-throw unexpected errors.
    }

    // Record iteration result.
    iterationResults.push({
      iteration,
      agentType: iterType,
      stopReason: iterStopReason,
      budgetAllocated: iterBudgetUsd,
      budgetSpent: iterTracker.getTotalSpent(),
      variantsCreated: iterVariantsCreated,
      matchesCompleted: iterMatchesCompleted,
    });
  }

  // ─── Winner determination ──────────────────────────────────
  // Pool may be empty when seed generation failed before any variants were added.
  // finalizeRun handles empty pool by marking the run failed.
  let winner: Variant | undefined;
  if (pool.length > 0) {
    const winResult = selectWinner(pool, ratings);
    winner = pool.find((v) => v.id === winResult.winnerId) ?? pool[0];
    logger.info('Winner determined', { winnerId: winner?.id, winnerElo: winResult.elo, winnerUncertainty: winResult.uncertainty, phaseName: 'winner_determination' });
  }

  logger.info('Evolution complete', {
    stopReason, iterations: iteration, poolSize: pool.length,
    totalCost: costTracker.getTotalSpent(), winnerId: winner?.id,
    phaseName: 'evolution_complete',
  });

  return {
    winner: winner!,
    pool,
    ratings,
    matchHistory: allMatches,
    totalCost: costTracker.getTotalSpent(),
    iterationsRun: iteration,
    stopReason,
    iterationResults,
    eloHistory,
    uncertaintyHistory,
    diversityHistory,
    matchCounts: Object.fromEntries(matchCounts),
    discardedVariants,
    discardedLocalRatings,
    iterationSnapshots,
    randomSeed,
    isSeeded: options?.seedVariantId ? true : undefined,
    budgetFloorObservables: {
      initialAgentCostEstimate,
      actualAvgCostPerAgent,
      parallelDispatched: parallelDispatchedCount,
      sequentialDispatched: sequentialDispatchedCount,
    },
    budgetFloorConfig: {
      minBudgetAfterParallelFraction: resolvedConfig.minBudgetAfterParallelFraction,
      minBudgetAfterParallelAgentMultiple: resolvedConfig.minBudgetAfterParallelAgentMultiple,
      minBudgetAfterSequentialFraction: resolvedConfig.minBudgetAfterSequentialFraction,
      minBudgetAfterSequentialAgentMultiple: resolvedConfig.minBudgetAfterSequentialAgentMultiple,
    },
  };
}
