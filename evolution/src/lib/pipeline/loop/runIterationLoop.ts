// Orchestrator-driven evolution loop.
// Each iteration is one of two types:
//   - Generate: N parallel GenerateFromSeedArticleAgent invocations + 1 MergeRatingsAgent
//   - Swiss:    1 SwissRankingAgent invocation + 1 MergeRatingsAgent
// The first iteration is always generate; subsequent iterations are swiss until a stop condition.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variant } from '../../types';
import { createVariant } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import { createRating, isConverged, DEFAULT_CONVERGENCE_SIGMA } from '../../shared/computeRatings';
import type { EvolutionConfig, EvolutionResult, V2Match } from '../infra/types';

import { createCostTracker } from '../infra/trackBudget';
import { createEvolutionLLMClient } from '../infra/createEvolutionLLMClient';
import type { EntityLogger } from '../infra/createEntityLogger';
import { selectWinner } from '../../shared/selectWinner';
import { GenerateFromSeedArticleAgent, deepCloneRatings } from '../../core/agents/generateFromSeedArticle';
import { CreateSeedArticleAgent } from '../../core/agents/createSeedArticle';
import { SwissRankingAgent, type SwissRankingMatchEntry } from '../../core/agents/SwissRankingAgent';
import { MergeRatingsAgent, type MergeMatchEntry } from '../../core/agents/MergeRatingsAgent';
import { swissPairing, pairKey, MAX_PAIRS_PER_ROUND } from './swissPairing';
import { computeTop15Cutoff } from './rankSingleVariant';
import { DEFAULT_GENERATE_STRATEGIES, type IterationSnapshot } from '../../schemas';
import { deriveSeed } from '../../shared/seededRandom';
import type { AgentContext } from '../../core/types';
import { estimateAgentCost } from '../infra/estimateCosts';

// ─── Config validation ───────────────────────────────────────────

function validateConfig(config: EvolutionConfig): void {
  // iterations is now optional (deprecated). Only validate range if present.
  if (config.iterations !== undefined && (config.iterations < 1 || config.iterations > 100)) {
    throw new Error(`Invalid iterations: ${config.iterations} (must be 1-100)`);
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
  if (config.numVariants !== undefined && (config.numVariants < 1 || config.numVariants > 100)) {
    throw new Error(`Invalid numVariants: ${config.numVariants} (must be 1-100)`);
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

function topKMuValues(ratings: ReadonlyMap<string, Rating>, k: number): number[] {
  return [...ratings.values()].map((r) => r.mu).sort((a, b) => b - a).slice(0, k);
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
    discardReasons?: Record<string, { mu: number; top15Cutoff: number }>;
  },
): IterationSnapshot {
  const ratingsObj = Object.fromEntries(
    [...ratings.entries()].map(([id, r]) => [id, { mu: r.mu, sigma: r.sigma }]),
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
  const sortedByMu = pool
    .map((v) => ({ id: v.id, mu: ratings.get(v.id)?.mu ?? 0 }))
    .sort((a, b) => b.mu - a.mu);
  const top15Cutoff = computeTop15Cutoff(ratings);

  const eligible = sortedByMu.filter(({ id }) => {
    const r = ratings.get(id);
    if (!r) return false;
    return r.mu + ELIGIBILITY_Z_SCORE * r.sigma >= top15Cutoff;
  });

  if (eligible.length < MIN_SWISS_POOL) {
    return sortedByMu.slice(0, MIN_SWISS_POOL).map((e) => e.id);
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
    return r ? isConverged(r, DEFAULT_CONVERGENCE_SIGMA) : false;
  });
}

// ─── Main function ───────────────────────────────────────────────

/**
 * Run the orchestrator-driven evolution pipeline. Each iteration is one work-batch + merge.
 */
export async function evolveArticle(
  originalText: string,
  llmProvider: { complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> },
  db: SupabaseClient,
  runId: string,
  config: EvolutionConfig,
  options?: {
    logger?: EntityLogger;
    initialPool?: Array<Variant & { mu?: number; sigma?: number }>;
    experimentId?: string;
    strategyId?: string;
    deadlineMs?: number;
    signal?: AbortSignal;
    randomSeed?: bigint;
    /** When set, skip eager baseline creation and run CreateSeedArticleAgent in iteration 1. */
    seedPrompt?: string;
  },
): Promise<EvolutionResult> {
  validateConfig(config);

  const numVariants = config.numVariants ?? 9;
  const strategies = config.strategies && config.strategies.length > 0
    ? config.strategies
    : [...DEFAULT_GENERATE_STRATEGIES];

  // Apply defaults for legacy fields too (some metric paths still read them).
  const resolvedConfig: EvolutionConfig = {
    ...config,
    iterations: config.iterations ?? 5,
    strategiesPerRound: config.strategiesPerRound ?? 3,
    calibrationOpponents: config.calibrationOpponents ?? 5,
    tournamentTopK: config.tournamentTopK ?? 5,
    numVariants,
    strategies,
  };

  const noopLogger: EntityLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const logger = options?.logger ?? noopLogger;
  const costTracker = createCostTracker(resolvedConfig.budgetUsd);
  const llm = createEvolutionLLMClient(llmProvider, costTracker, resolvedConfig.generationModel, logger, db, runId, resolvedConfig.generationTemperature);
  const randomSeed = options?.randomSeed ?? BigInt(0);

  logger.info('Config validation passed', {
    budgetUsd: resolvedConfig.budgetUsd,
    generationModel: resolvedConfig.generationModel, judgeModel: resolvedConfig.judgeModel,
    numVariants, strategies,
    phaseName: 'config_validation',
  });

  // Local state
  const pool: Variant[] = [];
  const ratings = new Map<string, Rating>();
  const matchCounts = new Map<string, number>();
  const allMatches: V2Match[] = [];
  const muHistory: number[][] = [];
  const diversityHistory: number[] = [];
  const comparisonCache = new Map<string, ComparisonResult>();
  const completedPairs = new Set<string>();
  const iterationSnapshots: IterationSnapshot[] = [];
  const discardedVariants: Variant[] = [];

  // Insert baseline — deferred when seedPrompt is set (CreateSeedArticleAgent creates it in iter 1).
  if (!options?.seedPrompt) {
    const baseline = createVariant({ text: originalText, strategy: 'baseline', iterationBorn: 0, parentIds: [], version: 0 });
    pool.push(baseline);
    ratings.set(baseline.id, createRating());
    logger.debug('Baseline variant added', { variantId: baseline.id, poolSize: pool.length, phaseName: 'initialization' });
  }

  // Load initial pool entries (e.g., arena entries with existing ratings).
  if (options?.initialPool) {
    for (const entry of options.initialPool) {
      pool.push(entry);
      ratings.set(entry.id,
        entry.mu !== undefined && entry.sigma !== undefined
          ? { mu: entry.mu, sigma: entry.sigma }
          : createRating(),
      );
    }
    logger.info('Initial pool loaded', { entriesLoaded: options.initialPool.length, poolSize: pool.length, phaseName: 'initialization' });
  }

  let stopReason: EvolutionResult['stopReason'] = 'iterations_complete';
  let iteration = 0;
  let executionOrder = 0;
  let budgetExhausted = false;
  let isSeeded = false;
  // currentOriginalText is the base article for variant generation; set by seed agent when present.
  let currentOriginalText = originalText;
  let variantsStillNeeded = numVariants;
  let actualAvgCostPerAgent: number | null = null; // Runtime feedback from parallel batch

  // Budget thresholds for parallel→sequential→swiss flow.
  // Supports two unit modes per phase (see schemas.ts for full semantics):
  //   - Fraction: floor = totalBudget * fraction (0-1)
  //   - Agent-multiple: floor = agentCost * N (N = "keep room for N more agents")
  // Parallel uses initial cost estimate (no runtime data available yet).
  // Sequential uses runtime `actualAvgCostPerAgent` feedback, falling back to initial.
  const totalBudget = resolvedConfig.budgetUsd;
  const initialAgentCostEstimate = estimateAgentCost(
    originalText.length, strategies[0]!, resolvedConfig.generationModel,
    resolvedConfig.judgeModel, 1, resolvedConfig.maxComparisonsPerVariant ?? 15,
  );

  function resolveParallelFloor(): number {
    if (resolvedConfig.minBudgetAfterParallelFraction != null) {
      return totalBudget * resolvedConfig.minBudgetAfterParallelFraction;
    }
    if (resolvedConfig.minBudgetAfterParallelAgentMultiple != null) {
      if (!Number.isFinite(initialAgentCostEstimate) || initialAgentCostEstimate <= 0) return 0;
      return initialAgentCostEstimate * resolvedConfig.minBudgetAfterParallelAgentMultiple;
    }
    return 0;
  }

  function resolveSequentialFloor(): number {
    if (resolvedConfig.minBudgetAfterSequentialFraction != null) {
      return totalBudget * resolvedConfig.minBudgetAfterSequentialFraction;
    }
    if (resolvedConfig.minBudgetAfterSequentialAgentMultiple != null) {
      const useActual = actualAvgCostPerAgent != null && Number.isFinite(actualAvgCostPerAgent) && actualAvgCostPerAgent > 0;
      const agentCost = useActual ? (actualAvgCostPerAgent as number) : initialAgentCostEstimate;
      if (!Number.isFinite(agentCost) || agentCost <= 0) return 0;
      return agentCost * resolvedConfig.minBudgetAfterSequentialAgentMultiple;
    }
    return 0;
  }

  // Parallel dispatch only happens on iteration 1, so parallelFloor is stable once computed.
  const parallelFloor = resolveParallelFloor();
  const parallelBudget = totalBudget - parallelFloor;

  // ─── nextIteration() decision function ───────────────────────────
  async function nextIteration(): Promise<'generate' | 'swiss' | 'done'> {
    // Kill / abort / deadline checks at iteration boundary
    if (options?.signal?.aborted) {
      logger.warn('Run aborted via signal', { iteration: iteration + 1, phaseName: 'loop' });
      stopReason = 'killed';
      return 'done';
    }
    if (await isRunKilled(db, runId, logger)) {
      logger.warn('Run killed externally', { iteration: iteration + 1, phaseName: 'loop' });
      stopReason = 'killed';
      return 'done';
    }
    if (options?.deadlineMs && Date.now() >= options.deadlineMs) {
      logger.warn('Wall clock deadline reached', { iteration: iteration + 1, phaseName: 'loop' });
      stopReason = 'time_limit';
      return 'done';
    }

    if (iteration === 0) return 'generate';
    if (budgetExhausted) {
      stopReason = 'budget_exceeded';
      return 'done';
    }

    // Sequential generate fallback: if variants still needed and budget allows
    if (variantsStillNeeded > 0) {
      const availBudget = costTracker.getAvailableBudget();
      const estCost = actualAvgCostPerAgent ?? estimateAgentCost(
        originalText.length, strategies[0]!, resolvedConfig.generationModel,
        resolvedConfig.judgeModel, pool.length, resolvedConfig.maxComparisonsPerVariant ?? 15,
      );
      if (availBudget - estCost >= resolveSequentialFloor()) {
        return 'generate';
      }
    }

    if (iteration >= MAX_ORCHESTRATOR_ITERATIONS) {
      logger.warn('Max orchestrator iterations reached', { iteration, max: MAX_ORCHESTRATOR_ITERATIONS, phaseName: 'loop' });
      stopReason = 'iterations_complete';
      return 'done';
    }

    const eligibleIds = computeEligibleIds(pool, ratings);
    if (eligibleIds.length < 2) return 'done';
    if (allConverged(eligibleIds, ratings)) {
      stopReason = 'converged';
      return 'done';
    }

    const candidatePairs = swissPairing(eligibleIds, ratings, completedPairs, MAX_PAIRS_PER_ROUND);
    if (candidatePairs.length === 0) {
      stopReason = 'no_pairs';
      return 'done';
    }

    return 'swiss';
  }

  // Main loop
  while (true) {
    const iterType = await nextIteration();
    if (iterType === 'done') break;
    iteration++;

    logger.info(`Starting iteration ${iteration} (${iterType})`, { iteration, phaseName: 'loop' });

    // Snapshot at iteration start
    iterationSnapshots.push(recordSnapshot(iteration, iterType, 'start', pool, ratings, matchCounts));

    if (iterType === 'generate') {
      // Seed agent: runs once at start of iteration 1 for prompt-based runs without an arena seed.
      if (options?.seedPrompt && !isSeeded) {
        const seedExecOrder = ++executionOrder;
        const seedCtx: AgentContext = {
          db, runId, iteration,
          executionOrder: seedExecOrder,
          invocationId: '',
          randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `seed${seedExecOrder}`),
          logger, costTracker, config: resolvedConfig,
        };
        const seedAgent = new CreateSeedArticleAgent();
        const seedResult = await seedAgent.run({
          promptText: options.seedPrompt,
          llm,
          initialPool: [...pool],
          initialRatings: deepCloneRatings(ratings),
          initialMatchCounts: new Map(matchCounts),
          cache: comparisonCache,
        }, seedCtx);

        if (!seedResult.success || !seedResult.result?.variant || !seedResult.result.surfaced) {
          logger.warn('Seed agent failed or variant discarded — stopping run', {
            phaseName: 'seed_generation',
            success: seedResult.success,
            budgetExceeded: seedResult.budgetExceeded,
          });
          stopReason = 'seed_failed';
          break;
        }

        const seedVariant = seedResult.result.variant;
        currentOriginalText = seedVariant.text;

        // Add seed variant to pool with fresh rating.
        pool.push(seedVariant);
        ratings.set(seedVariant.id, createRating());
        matchCounts.set(seedVariant.id, 0);

        // Create and add baseline from seed text.
        const seedBaseline = createVariant({
          text: seedVariant.text,
          strategy: 'baseline',
          iterationBorn: iteration,
          parentIds: [],
          version: 0,
        });
        pool.push(seedBaseline);
        ratings.set(seedBaseline.id, createRating());
        matchCounts.set(seedBaseline.id, 0);

        // Buffer seed's matches for MergeRatingsAgent at end of this iteration.
        if (seedResult.result.matches.length > 0) {
          allMatches.push(...seedResult.result.matches);
        }

        isSeeded = true;
        logger.info('Seed agent succeeded; baseline created from seed', {
          seedVariantId: seedVariant.id, baselineId: seedBaseline.id,
          poolSize: pool.length, phaseName: 'seed_generation',
        });
      }

      // Capture iteration-start snapshot for the parallel agents
      const initialPoolSnapshot: Variant[] = [...pool];
      const initialRatingsSnapshot = new Map(ratings);
      const initialMatchCountsSnapshot = new Map(matchCounts);

      // Budget-aware dispatch: compute how many agents we can afford.
      const isFirstGenerate = iteration === 1;
      let dispatchCount: number;
      if (isFirstGenerate) {
        // Parallel dispatch: respect minBudgetAfterParallel floor
        const availBudget = costTracker.getAvailableBudget();
        const effectiveBudget = Math.min(availBudget, parallelBudget);
        const maxComp = resolvedConfig.maxComparisonsPerVariant ?? 15;
        const estPerAgent = estimateAgentCost(
          originalText.length, strategies[0]!, resolvedConfig.generationModel,
          resolvedConfig.judgeModel, pool.length, maxComp,
        );
        const maxAffordable = Math.max(1, Math.floor(effectiveBudget / estPerAgent));
        dispatchCount = Math.min(numVariants, maxAffordable);
        logger.info('Budget-aware parallel dispatch', {
          iteration, numVariantsRequested: numVariants, estPerAgent,
          availableBudget: availBudget, parallelBudget, parallelFloor,
          maxAffordable, dispatchCount, phaseName: 'generation',
        });
      } else {
        // Sequential fallback: one agent at a time
        dispatchCount = 1;
        logger.info('Sequential generate fallback', {
          iteration, variantsStillNeeded,
          availableBudget: costTracker.getAvailableBudget(),
          sequentialFloor: resolveSequentialFloor(), phaseName: 'generation',
        });
      }

      logger.info('Dispatching generate iteration', {
        iteration,
        numAgents: dispatchCount,
        strategies: Array.from({ length: dispatchCount }, (_, i) => strategies[i % strategies.length]!),
        phaseName: 'generation',
      });
      const dispatchPromises = Array.from({ length: dispatchCount }, (_, i) => {
        const strategy = strategies[i % strategies.length]!;
        const execOrder = ++executionOrder;
        const agentIndex = i + 1;
        const ctxForAgent: AgentContext = {
          db,
          runId,
          iteration,
          executionOrder: execOrder,
          invocationId: '', // patched by Agent.run()
          randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `gfsa${execOrder}`),
          logger,
          costTracker,
          config: resolvedConfig,
          agentIndex,
        };
        const agent = new GenerateFromSeedArticleAgent();
        return agent.run({
          originalText: currentOriginalText ?? '',
          strategy,
          llm,
          initialPool: initialPoolSnapshot,
          initialRatings: initialRatingsSnapshot,
          initialMatchCounts: initialMatchCountsSnapshot,
          cache: comparisonCache,
        }, ctxForAgent);
      });

      const results = await Promise.allSettled(dispatchPromises);

      const surfacedVariants: Variant[] = [];
      const surfacedBuffers: MergeMatchEntry[][] = [];
      const discardedIds: string[] = [];
      const discardReasonsMap: Record<string, { mu: number; top15Cutoff: number }> = {};

      for (const r of results) {
        if (r.status === 'rejected') {
          logger.warn('generateFromSeedArticle agent rejected', {
            phaseName: 'generation',
            error: (r.reason instanceof Error ? r.reason.message : String(r.reason)).slice(0, 500),
          });
          continue;
        }
        if (r.value.budgetExceeded) {
          budgetExhausted = true;
          continue;
        }
        if (!r.value.success || !r.value.result) continue;

        const out = r.value.result;
        if (out.surfaced && out.variant) {
          surfacedVariants.push(out.variant);
          surfacedBuffers.push(out.matches.map((m) => ({ match: m, idA: m.winnerId, idB: m.loserId })));
        } else if (out.variant && !out.surfaced) {
          discardedVariants.push(out.variant);
          discardedIds.push(out.variant.id);
          if (out.discardReason) {
            discardReasonsMap[out.variant.id] = out.discardReason;
          }
        }
      }

      // Track variants generated and compute runtime cost feedback
      variantsStillNeeded -= surfacedVariants.length;
      if (isFirstGenerate) {
        // Compute actualAvgCostPerAgent from successful agents for sequential dispatch estimates
        const completedCosts: number[] = [];
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.success && r.value.cost > 0) {
            completedCosts.push(r.value.cost);
          }
        }
        if (completedCosts.length > 0) {
          actualAvgCostPerAgent = completedCosts.reduce((a, b) => a + b, 0) / completedCosts.length;
        }
      }

      const mergeExecOrder = ++executionOrder;
      const mergeCtx: AgentContext = {
        db, runId, iteration,
        executionOrder: mergeExecOrder,
        invocationId: '',
        randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `merge${mergeExecOrder}`),
        logger, costTracker, config: resolvedConfig,
      };
      const mergeAgent = new MergeRatingsAgent();
      const mergeResult = await mergeAgent.run({
        iterationType: 'generate',
        matchBuffers: surfacedBuffers,
        newVariants: surfacedVariants,
        pool, ratings, matchCounts, matchHistory: allMatches,
      }, mergeCtx);

      if (mergeResult.budgetExceeded) budgetExhausted = true;

      // Track top-K mu history and snapshot iteration end (with discarded info).
      const topK = resolvedConfig.tournamentTopK ?? 5;
      const muValues = topKMuValues(ratings, topK);
      muHistory.push(muValues);

      iterationSnapshots.push(recordSnapshot(iteration, 'generate', 'end', pool, ratings, matchCounts, {
        discardedVariantIds: discardedIds,
        discardReasons: discardReasonsMap,
      }));

      logger.info('Generate iteration complete', {
        iteration,
        surfaced: surfacedVariants.length,
        discarded: discardedIds.length,
        topMuValues: muValues.slice(0, 5),
        phaseName: 'generation',
      });
    } else if (iterType === 'swiss') {
      // Compute eligible set, dispatch swiss agent.
      const eligibleIds = computeEligibleIds(pool, ratings);

      const swissExecOrder = ++executionOrder;
      const swissCtx: AgentContext = {
        db, runId, iteration,
        executionOrder: swissExecOrder,
        invocationId: '',
        randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `swiss${swissExecOrder}`),
        logger, costTracker, config: resolvedConfig,
      };
      const swissAgent = new SwissRankingAgent();
      const swissResult = await swissAgent.run({
        eligibleIds,
        completedPairs,
        pool,
        ratings,
        cache: comparisonCache,
        llm,
      }, swissCtx);

      if (swissResult.budgetExceeded) budgetExhausted = true;

      const swissOutput = swissResult.result;
      if (!swissOutput || swissOutput.status === 'no_pairs') {
        stopReason = 'no_pairs';
        iterationSnapshots.push(recordSnapshot(iteration, 'swiss', 'end', pool, ratings, matchCounts));
        break;
      }

      // Merge unconditionally — paid-for matches must reach global ratings before budget exit.
      const mergeExecOrder = ++executionOrder;
      const mergeCtx: AgentContext = {
        db, runId, iteration,
        executionOrder: mergeExecOrder,
        invocationId: '',
        randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `merge${mergeExecOrder}`),
        logger, costTracker, config: resolvedConfig,
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
      if (mergeResult.budgetExceeded) budgetExhausted = true;

      // Update completedPairs from this iteration's matches.
      for (const m of swissOutput.matches) {
        completedPairs.add(pairKey(m.idA, m.idB));
      }

      const topK = resolvedConfig.tournamentTopK ?? 5;
      const muValues = topKMuValues(ratings, topK);
      muHistory.push(muValues);

      iterationSnapshots.push(recordSnapshot(iteration, 'swiss', 'end', pool, ratings, matchCounts));

      logger.info('Swiss iteration complete', {
        iteration,
        matchesApplied: swissOutput.matches.length,
        topMuValues: muValues.slice(0, 5),
        phaseName: 'ranking',
      });

      if (swissOutput.status === 'budget') {
        budgetExhausted = true;
      }
    }
  }

  // ─── Winner determination ──────────────────────────────────
  // Pool may be empty when seed generation failed before any variants were added.
  // finalizeRun handles empty pool by marking the run failed.
  let winner: Variant | undefined;
  if (pool.length > 0) {
    const winResult = selectWinner(pool, ratings);
    winner = pool.find((v) => v.id === winResult.winnerId) ?? pool[0];
    logger.info('Winner determined', { winnerId: winner?.id, winnerMu: winResult.mu, winnerSigma: winResult.sigma, phaseName: 'winner_determination' });
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
    muHistory,
    diversityHistory,
    matchCounts: Object.fromEntries(matchCounts),
    discardedVariants,
    iterationSnapshots,
    randomSeed,
    isSeeded: isSeeded || undefined,
  };
}
