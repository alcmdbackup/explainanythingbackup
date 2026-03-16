// The main V2 evolution function: orchestrates generate→rank→evolve in a flat loop.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TextVariation } from '../types';
import { BudgetExceededError } from '../types';
import type { Rating } from '../core/rating';
import type { ComparisonResult } from '../comparison';
import type { EvolutionConfig, EvolutionResult, V2Match } from './types';
import { BudgetExceededWithPartialResults } from './errors';
import { createTextVariation } from '../core/textVariationFactory';
import { generateVariants } from './generate';
import { rankPool } from './rank';
import { evolveVariants } from './evolve';
import { createCostTracker } from './cost-tracker';
import { createV2LLMClient } from './llm-client';
import { createInvocation, updateInvocation } from './invocations';
import type { RunLogger } from './run-logger';

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

async function isRunKilled(db: SupabaseClient, runId: string, logger?: RunLogger): Promise<boolean> {
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
 * Run the V2 evolution pipeline: generate→rank→evolve loop with cost tracking.
 * Returns the best variant, full pool, ratings, and run metadata.
 */
export async function evolveArticle(
  originalText: string,
  llmProvider: { complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> },
  db: SupabaseClient,
  runId: string,
  config: EvolutionConfig,
  options?: { logger?: RunLogger },
): Promise<EvolutionResult> {
  validateConfig(config);

  // Apply defaults
  const resolvedConfig: EvolutionConfig = {
    ...config,
    strategiesPerRound: config.strategiesPerRound ?? 3,
    calibrationOpponents: config.calibrationOpponents ?? 5,
    tournamentTopK: config.tournamentTopK ?? 5,
  };

  const logger = options?.logger;
  const costTracker = createCostTracker(resolvedConfig.budgetUsd);
  const llm = createV2LLMClient(llmProvider, costTracker, resolvedConfig.generationModel);

  // Local state
  const pool: TextVariation[] = [];
  const ratings = new Map<string, Rating>();
  const matchCounts = new Map<string, number>();
  const allMatches: V2Match[] = [];
  const muHistory: number[][] = [];
  const diversityHistory: number[] = [];
  const comparisonCache = new Map<string, ComparisonResult>();

  // Insert baseline
  const baseline = createTextVariation({
    text: originalText,
    strategy: 'baseline',
    iterationBorn: 0,
    parentIds: [],
    version: 0,
  });
  pool.push(baseline);

  let stopReason: EvolutionResult['stopReason'] = 'iterations_complete';
  let iterationsRun = 0;
  let executionOrder = 0;

  for (let iter = 1; iter <= resolvedConfig.iterations; iter++) {
    // Kill detection at iteration boundary
    if (await isRunKilled(db, runId, logger)) {
      stopReason = 'killed';
      break;
    }

    logger?.info(`Starting iteration ${iter}`, { iteration: iter, phaseName: 'loop' });

    const newVariantIds: string[] = [];

    // ─── Generate phase ──────────────────────────────────────
    const genInvId = await createInvocation(db, runId, iter, 'generation', ++executionOrder);
    const genCostBefore = costTracker.getTotalSpent();

    try {
      const generated = await generateVariants(
        originalText,
        iter,
        llm,
        resolvedConfig,
      );
      for (const v of generated) {
        pool.push(v);
        newVariantIds.push(v.id);
      }
      await updateInvocation(db, genInvId, {
        cost_usd: costTracker.getTotalSpent() - genCostBefore,
        success: true,
        execution_detail: { variantsAdded: generated.length },
      });
    } catch (error) {
      if (error instanceof BudgetExceededWithPartialResults) {
        for (const v of error.partialVariants) {
          pool.push(v);
          newVariantIds.push(v.id);
        }
        await updateInvocation(db, genInvId, {
          cost_usd: costTracker.getTotalSpent() - genCostBefore,
          success: false,
          error_message: error.message,
        });
        stopReason = 'budget_exceeded';
        iterationsRun = iter;
        break;
      }
      if (error instanceof BudgetExceededError) {
        await updateInvocation(db, genInvId, {
          cost_usd: costTracker.getTotalSpent() - genCostBefore,
          success: false,
          error_message: error.message,
        });
        stopReason = 'budget_exceeded';
        iterationsRun = iter;
        break;
      }
      throw error;
    }

    // ─── Rank phase ──────────────────────────────────────────
    const rankInvId = await createInvocation(db, runId, iter, 'ranking', ++executionOrder);
    const rankCostBefore = costTracker.getTotalSpent();

    try {
      const budgetFraction = resolvedConfig.budgetUsd > 0
        ? 1 - costTracker.getAvailableBudget() / resolvedConfig.budgetUsd
        : 0;

      const rankResult = await rankPool(
        pool,
        ratings,
        matchCounts,
        newVariantIds,
        llm,
        resolvedConfig,
        budgetFraction,
        comparisonCache,
      );

      // Merge rating updates
      for (const [id, r] of Object.entries(rankResult.ratingUpdates)) {
        ratings.set(id, r);
      }

      // Merge match count increments
      for (const [id, delta] of Object.entries(rankResult.matchCountIncrements)) {
        matchCounts.set(id, (matchCounts.get(id) ?? 0) + delta);
      }

      allMatches.push(...rankResult.matches);

      // Record muHistory: top-K mu values
      const topK = resolvedConfig.tournamentTopK ?? 5;
      const muValues = [...ratings.values()]
        .map((r) => r.mu)
        .sort((a, b) => b - a)
        .slice(0, topK);
      muHistory.push(muValues);

      await updateInvocation(db, rankInvId, {
        cost_usd: costTracker.getTotalSpent() - rankCostBefore,
        success: true,
        execution_detail: { matchesPlayed: rankResult.matches.length },
      });

      // Convergence check
      if (rankResult.converged) {
        stopReason = 'converged';
        iterationsRun = iter;
        break;
      }
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        await updateInvocation(db, rankInvId, {
          cost_usd: costTracker.getTotalSpent() - rankCostBefore,
          success: false,
          error_message: error.message,
        });
        stopReason = 'budget_exceeded';
        iterationsRun = iter;
        break;
      }
      throw error;
    }

    // ─── Evolve phase ────────────────────────────────────────
    const evolveInvId = await createInvocation(db, runId, iter, 'evolution', ++executionOrder);
    const evolveCostBefore = costTracker.getTotalSpent();

    try {
      const evolved = await evolveVariants(
        pool,
        ratings,
        iter,
        llm,
        resolvedConfig,
      );
      for (const v of evolved) {
        pool.push(v);
        newVariantIds.push(v.id);
      }
      await updateInvocation(db, evolveInvId, {
        cost_usd: costTracker.getTotalSpent() - evolveCostBefore,
        success: true,
        execution_detail: { variantsAdded: evolved.length },
      });
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        await updateInvocation(db, evolveInvId, {
          cost_usd: costTracker.getTotalSpent() - evolveCostBefore,
          success: false,
          error_message: error.message,
        });
        stopReason = 'budget_exceeded';
        iterationsRun = iter;
        break;
      }
      throw error;
    }

    iterationsRun = iter;
  }

  if (iterationsRun === 0) iterationsRun = resolvedConfig.iterations;

  // ─── Winner determination ──────────────────────────────────
  // Highest mu, tie-broken by lowest sigma
  let winner = pool[0]; // baseline fallback
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
  };
}
