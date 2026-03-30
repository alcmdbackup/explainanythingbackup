// The main V2 evolution function: orchestrates generate→rank in a flat loop.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variant } from '../../types';
import { createVariant } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import type { EvolutionConfig, EvolutionResult, V2Match } from '../infra/types';
import type { RankResult } from './rankVariants';

import { createCostTracker } from '../infra/trackBudget';
import { createV2LLMClient } from '../infra/createLLMClient';
import type { EntityLogger } from '../infra/createEntityLogger';
import { GenerationAgent } from '../../core/agents/GenerationAgent';
import { RankingAgent } from '../../core/agents/RankingAgent';
import { getEntity } from '../../core/entityRegistry';
import { writeMetric } from '../../metrics/writeMetrics';
import type { ExecutionContext } from '../../core/types';

// ─── Config validation ───────────────────────────────────────────

function validateConfig(config: EvolutionConfig): void {
  if (config.iterations < 1 || config.iterations > 100) {
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
  if (config.strategiesPerRound !== undefined && config.strategiesPerRound < 1) {
    throw new Error(`Invalid strategiesPerRound: ${config.strategiesPerRound} (must be >= 1)`);
  }
  if (config.calibrationOpponents !== undefined && config.calibrationOpponents < 1) {
    throw new Error(`Invalid calibrationOpponents: ${config.calibrationOpponents} (must be >= 1)`);
  }
  if (config.tournamentTopK !== undefined && config.tournamentTopK < 1) {
    throw new Error(`Invalid tournamentTopK: ${config.tournamentTopK} (must be >= 1)`);
  }
}

// ─── Kill detection ──────────────────────────────────────────────

async function isRunKilled(db: SupabaseClient, runId: string, logger?: EntityLogger): Promise<boolean> {
  try {
    const { data, error } = await db
      .from('evolution_runs')
      .select('status')
      .eq('id', runId)
      .single();

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

// ─── Main function ───────────────────────────────────────────────

/**
 * Run the V2 evolution pipeline: generate→rank loop with cost tracking.
 * Returns the best variant, full pool, ratings, and run metadata.
 */
export async function evolveArticle(
  originalText: string,
  llmProvider: { complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> },
  db: SupabaseClient,
  runId: string,
  config: EvolutionConfig,
  options?: { logger?: EntityLogger; initialPool?: Array<Variant & { mu?: number; sigma?: number }>; experimentId?: string; strategyId?: string; deadlineMs?: number; signal?: AbortSignal },
): Promise<EvolutionResult> {
  validateConfig(config);

  // Apply defaults
  const resolvedConfig: EvolutionConfig = {
    ...config,
    strategiesPerRound: config.strategiesPerRound ?? 3,
    calibrationOpponents: config.calibrationOpponents ?? 5,
    tournamentTopK: config.tournamentTopK ?? 5,
  };

  const noopLogger: EntityLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const logger = options?.logger ?? noopLogger;
  const costTracker = createCostTracker(resolvedConfig.budgetUsd);
  const llm = createV2LLMClient(llmProvider, costTracker, resolvedConfig.generationModel);

  logger.info('Config validation passed', {
    iterations: resolvedConfig.iterations, budgetUsd: resolvedConfig.budgetUsd,
    generationModel: resolvedConfig.generationModel, judgeModel: resolvedConfig.judgeModel,
    strategiesPerRound: resolvedConfig.strategiesPerRound,
    calibrationOpponents: resolvedConfig.calibrationOpponents,
    tournamentTopK: resolvedConfig.tournamentTopK,
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

  // Insert baseline
  const baseline = createVariant({
    text: originalText,
    strategy: 'baseline',
    iterationBorn: 0,
    parentIds: [],
    version: 0,
  });
  pool.push(baseline);
  logger.debug('Baseline variant added', { variantId: baseline.id, poolSize: pool.length, phaseName: 'initialization' });

  // Prepend initial pool entries (e.g., arena entries with existing ratings)
  if (options?.initialPool) {
    for (const entry of options.initialPool) {
      pool.push(entry);
      if (entry.mu !== undefined && entry.sigma !== undefined) {
        ratings.set(entry.id, { mu: entry.mu, sigma: entry.sigma });
      }
    }
    logger.info('Initial pool loaded', { entriesLoaded: options.initialPool.length, poolSize: pool.length, phaseName: 'initialization' });
  }

  let stopReason: EvolutionResult['stopReason'] = 'iterations_complete';
  let iterationsRun = 0;
  let executionOrder = 0;

  for (let iter = 1; iter <= resolvedConfig.iterations; iter++) {
    // Abort signal check (highest priority — process being killed)
    if (options?.signal?.aborted) {
      logger.warn('Run aborted via signal', { iteration: iter, phaseName: 'loop' });
      stopReason = 'killed';
      break;
    }

    // Kill detection at iteration boundary
    if (await isRunKilled(db, runId, logger)) {
      logger.warn('Run killed externally', { iteration: iter, phaseName: 'loop' });
      stopReason = 'killed';
      break;
    }

    // Wall clock deadline check
    if (options?.deadlineMs && Date.now() >= options.deadlineMs) {
      logger.warn('Wall clock deadline reached', { iteration: iter, phaseName: 'loop' });
      stopReason = 'time_limit';
      break;
    }

    logger.info(`Starting iteration ${iter}`, { iteration: iter, phaseName: 'loop' });

    const newVariantIds: string[] = [];
    const agentCtx = { db, runId, iteration: iter, executionOrder: 0, logger, costTracker, config: resolvedConfig };

    // ─── Generate phase ──────────────────────────────────────
    agentCtx.executionOrder = ++executionOrder;
    const genAgent = new GenerationAgent();
    const genResult = await genAgent.run(
      { text: originalText, llm },
      agentCtx,
    );
    if (genResult.success && genResult.result) {
      for (const v of genResult.result) { pool.push(v); newVariantIds.push(v.id); }
      logger.info('Generation complete', { iteration: iter, newVariants: genResult.result.length, poolSize: pool.length, phaseName: 'generation' });
    } else if (genResult.budgetExceeded) {
      if (genResult.partialResult) {
        for (const v of genResult.partialResult as Variant[]) { pool.push(v); newVariantIds.push(v.id); }
      }
      logger.warn('Budget exceeded during generation', { iteration: iter, totalSpent: costTracker.getTotalSpent(), phaseName: 'budget' });
      stopReason = 'budget_exceeded'; iterationsRun = iter; break;
    } else {
      logger.warn('Generation failed (non-budget)', { iteration: iter, phaseName: 'generation' });
    }

    // ─── Rank phase ──────────────────────────────────────────
    agentCtx.executionOrder = ++executionOrder;
    const budgetFraction = resolvedConfig.budgetUsd > 0
      ? 1 - costTracker.getAvailableBudget() / resolvedConfig.budgetUsd
      : 0;

    const rankAgent = new RankingAgent();
    const rankPhase = await rankAgent.run(
      { pool, ratings, matchCounts, newEntrantIds: newVariantIds, llm, budgetFraction, cache: comparisonCache },
      agentCtx,
    );

    // Apply ranking results (works for both full success and partial budget-exceeded results)
    const rankResult = rankPhase.result ?? (rankPhase.partialResult as RankResult | undefined);
    if (rankResult) {
      for (const [id, r] of Object.entries(rankResult.ratingUpdates)) { ratings.set(id, r); }
      for (const [id, delta] of Object.entries(rankResult.matchCountIncrements)) {
        matchCounts.set(id, (matchCounts.get(id) ?? 0) + delta);
      }
      allMatches.push(...rankResult.matches);
    }

    if (rankPhase.success && rankResult) {
      const topK = resolvedConfig.tournamentTopK ?? 5;
      const muValues = [...ratings.values()].map((r) => r.mu).sort((a, b) => b - a).slice(0, topK);
      muHistory.push(muValues);
      logger.info('Ranking complete', { iteration: iter, matchCount: rankResult.matches.length, topMuValues: muValues.slice(0, 5), phaseName: 'ranking' });
      if (rankResult.converged) {
        logger.info('Convergence detected', { iteration: iter, topMuValues: muValues, phaseName: 'convergence' });
        stopReason = 'converged'; iterationsRun = iter; break;
      }
    } else if (rankPhase.budgetExceeded) {
      logger.warn('Budget exceeded during ranking', { iteration: iter, totalSpent: costTracker.getTotalSpent(), phaseName: 'budget' });
      stopReason = 'budget_exceeded'; iterationsRun = iter; break;
    }

    // ─── Write execution metrics ─────────────────────────────
    try {
      const execCtx: ExecutionContext = { costTracker, phaseName: 'generation' };
      for (const def of getEntity('run').metrics.duringExecution) {
        const value = def.compute(execCtx);
        await writeMetric(db, 'run', runId, def.name as import('../../metrics/types').MetricName, value, 'during_execution');
      }
      // Dynamic per-agent cost metrics
      for (const [phase, cost] of Object.entries(costTracker.getPhaseCosts())) {
        await writeMetric(db, 'run', runId, `agentCost:${phase}` as const, cost as number, 'during_execution');
      }
    } catch (metricsErr) {
      const errMsg = metricsErr instanceof Error ? metricsErr.message : String(metricsErr);
      const errStack = metricsErr instanceof Error ? metricsErr.stack?.slice(0, 1000) : undefined;
      logger.warn('Execution metrics write failed', {
        phaseName: 'metrics',
        error: errMsg.slice(0, 500),
        errorType: metricsErr instanceof Error ? metricsErr.constructor.name : typeof metricsErr,
        errorStack: errStack,
        runId,
      });
    }

    iterationsRun = iter;
  }

  if (iterationsRun === 0) iterationsRun = resolvedConfig.iterations;

  // ─── Winner determination ──────────────────────────────────
  // Highest mu, tie-broken by lowest sigma
  let winner = pool[0]!; // baseline fallback
  let bestMu = -Infinity;
  let bestSigma = Infinity;

  for (const v of pool) {
    const r = ratings.get(v.id);
    if (!r) continue;
    if (r.mu > bestMu || (r.mu === bestMu && r.sigma < bestSigma)) {
      winner = v;
      bestMu = r.mu;
      bestSigma = r.sigma;
    }
  }

  logger.info('Winner determined', { winnerId: winner.id, winnerMu: bestMu, winnerSigma: bestSigma, phaseName: 'winner_determination' });
  logger.info('Evolution complete', {
    stopReason, iterations: iterationsRun, poolSize: pool.length,
    totalCost: costTracker.getTotalSpent(), winnerId: winner.id,
    phaseName: 'evolution_complete',
  });

  return {
    winner,
    pool,
    ratings,
    matchHistory: allMatches,
    totalCost: costTracker.getTotalSpent(),
    iterationsRun,
    stopReason,
    muHistory,
    diversityHistory,
    matchCounts: Object.fromEntries(matchCounts),
  };
}
