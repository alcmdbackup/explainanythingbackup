// Pipeline orchestrator with two modes: minimal (Slice A) and full phase-aware (Slice B).
// Full pipeline uses PoolSupervisor for EXPANSION→COMPETITION phase transitions, checkpoint/resume.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { serializeState } from './state';
import { getOrdinal, createRating } from './rating';
import { PoolSupervisor, supervisorConfigFromRunConfig } from './supervisor';
import type { SupervisorResumeState } from './supervisor';
import type { PipelineState, EvolutionLogger, PipelinePhase, AgentResult, ExecutionContext, EvolutionRunSummary } from '../types';
import { BudgetExceededError, LLMRefusalError, BASELINE_STRATEGY, EvolutionRunSummarySchema } from '../types';
import { ComparisonCache } from './comparisonCache';
import { isTransientError } from './errorClassification';
import { createAppSpan } from '../../../../instrumentation';
import { v4 as uuidv4 } from 'uuid';
import { linkStrategyConfig, persistCostPrediction, persistAgentMetrics } from './metricsWriter';
import { persistCheckpoint, persistVariants, markRunFailed, markRunPaused, checkpointAndMarkContinuationPending } from './persistence';
import { persistAgentInvocation } from './pipelineUtilities';
import { buildFlowCritiquePrompt, parseFlowCritiqueResponse } from '../flowRubric';
import type { TextVariation } from '../types';
import { runCritiqueBatch } from './critiqueBatch';
import { autoLinkPrompt, feedHallOfFame } from './hallOfFameIntegration';

/** Agent interface for pipeline execution. */
export interface PipelineAgent {
  readonly name: string;
  execute(ctx: ExecutionContext): Promise<AgentResult>;
  canExecute(state: PipelineState): boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function insertBaselineVariant(state: PipelineState, runId: string): void {
  const existingBaseline = state.pool.find(v => v.strategy === BASELINE_STRATEGY);
  if (existingBaseline) return;

  state.addToPool({
    id: uuidv4(),
    text: state.originalText,
    version: 0,
    parentIds: [],
    strategy: BASELINE_STRATEGY,
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
  });
}

export function buildRunSummary(
  ctx: ExecutionContext,
  stopReason: string,
  durationSeconds: number,
  supervisor?: PoolSupervisor,
): EvolutionRunSummary {
  const state = ctx.state;
  const topVariants = state.getTopByRating(5).map((v) => ({
    id: v.id,
    strategy: v.strategy,
    ordinal: getOrdinal(state.ratings.get(v.id) ?? createRating()),
    isBaseline: v.strategy === BASELINE_STRATEGY,
  }));

  const allByRating = state.getTopByRating(state.getPoolSize());
  const baselineIdx = allByRating.findIndex((v) => v.strategy === BASELINE_STRATEGY);
  const baselineVariant = baselineIdx >= 0 ? allByRating[baselineIdx] : undefined;

  if (baselineIdx < 0) {
    ctx.logger.warn('Baseline variant not found in pool', { runId: ctx.runId });
  }

  const matches = state.matchHistory;
  const avgConfidence = matches.length
    ? matches.reduce((s, m) => s + m.confidence, 0) / matches.length : 0;
  const decisiveRate = matches.length
    ? matches.filter((m) => m.confidence >= 0.7).length / matches.length : 0;

  const strategyEffectiveness: Record<string, { count: number; avgOrdinal: number }> = {};
  for (const v of state.pool) {
    const ord = getOrdinal(state.ratings.get(v.id) ?? createRating());
    const entry = strategyEffectiveness[v.strategy] ??= { count: 0, avgOrdinal: 0 };
    entry.count++;
    entry.avgOrdinal += ord;
  }

  for (const entry of Object.values(strategyEffectiveness)) {
    entry.avgOrdinal /= entry.count;
  }

  return {
    version: 2,
    stopReason,
    finalPhase: supervisor?.currentPhase ?? 'EXPANSION',
    totalIterations: state.iteration,
    durationSeconds,
    ordinalHistory: supervisor?.getResumeState().ordinalHistory ?? [],
    diversityHistory: supervisor?.getResumeState().diversityHistory ?? [],
    matchStats: { totalMatches: matches.length, avgConfidence, decisiveRate },
    topVariants,
    baselineRank: baselineIdx >= 0 ? baselineIdx + 1 : null,
    baselineOrdinal: baselineVariant
      ? getOrdinal(state.ratings.get(baselineVariant.id) ?? createRating())
      : null,
    strategyEffectiveness,
    metaFeedback: state.metaFeedback,
  };
}

export function validateRunSummary(
  raw: EvolutionRunSummary,
  logger: EvolutionLogger,
  runId: string,
): EvolutionRunSummary | null {
  const result = EvolutionRunSummarySchema.safeParse(raw);
  if (!result.success) {
    logger.error('Run summary Zod validation failed — saving null', {
      runId,
      errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }
  return result.data;
}

export async function finalizePipelineRun(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
  stopReason: string,
  durationSeconds: number,
  supervisor?: PoolSupervisor,
): Promise<void> {
  const supabase = await createSupabaseServiceClient();

  const rawSummary = buildRunSummary(ctx, stopReason, durationSeconds, supervisor);
  const summary = validateRunSummary(rawSummary, logger, runId);

  if (summary) {
    const { error: summaryErr } = await supabase.from('content_evolution_runs')
      .update({ run_summary: summary }).eq('id', runId);
    if (summaryErr) {
      logger.warn('Failed to persist run_summary (column may not exist yet)', {
        runId, error: summaryErr.message,
      });
    }
  }

  await persistVariants(runId, ctx, logger);
  await persistAgentMetrics(runId, ctx, logger);
  try {
    const { data: runRow } = await supabase
      .from('content_evolution_runs')
      .select('cost_estimate_detail')
      .eq('id', runId)
      .single();

    if (runRow?.cost_estimate_detail) {
      await persistCostPrediction(supabase, runId, runRow.cost_estimate_detail, ctx, logger);
    }
  } catch (err) {
    logger.warn('Cost prediction computation failed (non-blocking)', {
      runId, error: err instanceof Error ? err.message : String(err),
    });
  }

  await linkStrategyConfig(runId, ctx, logger);
  await autoLinkPrompt(runId, ctx, logger);
  await feedHallOfFame(runId, ctx, logger);

  if (logger.flush) {
    await logger.flush();
  }
}

export async function executeMinimalPipeline(
  runId: string,
  agents: PipelineAgent[],
  ctx: ExecutionContext,
  logger: EvolutionLogger,
  options?: { startMs?: number },
): Promise<void> {
  if (!ctx.comparisonCache) {
    ctx.comparisonCache = new ComparisonCache();
  }

  const supabase = await createSupabaseServiceClient();
  await supabase.from('content_evolution_runs').update({
    status: 'running',
    started_at: new Date().toISOString(),
    pipeline_type: 'minimal',
  }).eq('id', runId);

  insertBaselineVariant(ctx.state, runId);

  let executionOrder = 0;
  for (const agent of agents) {
    if (!agent.canExecute(ctx.state)) {
      logger.debug('Skipping agent (preconditions not met)', { agent: agent.name });
      continue;
    }

    try {
      const result = await agent.execute(ctx);
      await persistAgentInvocation(runId, ctx.state.iteration, agent.name, executionOrder++, result, logger);
      await persistCheckpoint(runId, ctx.state, agent.name, 'EXPANSION', logger, 3, ctx.costTracker.getTotalSpent(), ctx.comparisonCache);
    } catch (error) {
      await persistCheckpoint(runId, ctx.state, agent.name, 'EXPANSION', logger, 3, ctx.costTracker.getTotalSpent(), ctx.comparisonCache)
        .catch(() => {});

      if (error instanceof BudgetExceededError) {
        logger.warn('Budget exceeded, pausing run', { agent: agent.name, error: error.message });
        await markRunPaused(runId, error);

        if (logger.flush) {
          await logger.flush().catch(() => {});
        }
        return;
      }

      logger.error('Agent failed', { agent: agent.name, error: String(error) });
      await markRunFailed(runId, agent.name, error);

      if (logger.flush) {
        await logger.flush().catch(() => {});
      }

      throw error;
    }
  }

  await supabase.from('content_evolution_runs').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_variants: ctx.state.getPoolSize(),
    variants_generated: ctx.state.getPoolSize(),
    total_cost_usd: ctx.costTracker.getTotalSpent(),
  }).eq('id', runId);

  const durationSeconds = (Date.now() - (options?.startMs ?? Date.now())) / 1000;
  await finalizePipelineRun(runId, ctx, logger, 'completed', durationSeconds, undefined);

  logger.info('Pipeline completed', {
    poolSize: ctx.state.getPoolSize(),
    totalCost: ctx.costTracker.getTotalSpent(),
  });
}

export interface PipelineAgents {
  generation: PipelineAgent;
  calibration: PipelineAgent;
  tournament: PipelineAgent;
  evolution: PipelineAgent;
  reflection?: PipelineAgent;
  iterativeEditing?: PipelineAgent;
  treeSearch?: PipelineAgent;
  sectionDecomposition?: PipelineAgent;
  debate?: PipelineAgent;
  proximity?: PipelineAgent;
  metaReview?: PipelineAgent;
  outlineGeneration?: PipelineAgent;
}

export type AgentName = keyof PipelineAgents | 'flowCritique';

export interface FullPipelineOptions {
  supervisorResume?: SupervisorResumeState;
  startMs?: number;
  resumeComparisonCacheEntries?: Array<[string, import('./comparisonCache').CachedMatch]>;
  maxDurationMs?: number;
  continuationCount?: number;
}

export async function executeFullPipeline(
  runId: string,
  agents: PipelineAgents,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
  options: FullPipelineOptions = {},
): Promise<{ stopReason: string; supervisorState?: SupervisorResumeState }> {
  const pipelineSpan = createAppSpan('evolution.pipeline.full', {
    run_id: runId,
    max_iterations: ctx.payload.config.maxIterations,
    budget_cap_usd: ctx.costTracker.getAvailableBudget(),
  });

  try {
    const MAX_CONTINUATIONS = 10;
    if ((options.continuationCount ?? 0) >= MAX_CONTINUATIONS) {
      await markRunFailed(runId, null, new Error(`Max continuation limit (${MAX_CONTINUATIONS}) reached`));
      return { stopReason: 'max_continuations_exceeded' };
    }

    const supabase = await createSupabaseServiceClient();

    await supabase.from('content_evolution_runs').update({
      status: 'running',
      started_at: new Date().toISOString(),
      pipeline_type: ctx.payload.config.singleArticle ? 'single' : 'full',
    }).eq('id', runId).in('status', ['claimed']);

    const supervisorCfg = supervisorConfigFromRunConfig(ctx.payload.config);
    const supervisor = new PoolSupervisor(supervisorCfg);

    if (!ctx.comparisonCache) {
      if (options.resumeComparisonCacheEntries && options.resumeComparisonCacheEntries.length > 0) {
        ctx.comparisonCache = ComparisonCache.fromEntries(options.resumeComparisonCacheEntries);
        logger.info('Restored comparison cache from checkpoint', { entries: options.resumeComparisonCacheEntries.length });
      } else {
        ctx.comparisonCache = new ComparisonCache();
      }
    }

    if (ctx.costTracker.getTotalReserved() !== 0) {
      logger.warn('Unexpected non-zero reservation on resume', {
        totalReserved: ctx.costTracker.getTotalReserved(),
      });
    }

    if (options.supervisorResume) {
      const r = options.supervisorResume;
      supervisor.setPhaseFromResume(r.phase, r.strategyRotationIndex);
      supervisor.ordinalHistory = r.ordinalHistory ?? [];
      supervisor.diversityHistory = r.diversityHistory ?? [];
    }

    let stopReason = 'completed';
    let previousPhase = supervisor.currentPhase;

    insertBaselineVariant(ctx.state, runId);

    for (let i = ctx.state.iteration; i < ctx.payload.config.maxIterations; i++) {
      ctx.state.startNewIteration();
      let executionOrder = 0;

      if (options.maxDurationMs && options.startMs) {
        const elapsedMs = Date.now() - options.startMs;
        const safetyMarginMs = Math.min(120_000, Math.max(60_000, elapsedMs * 0.10));
        if (options.maxDurationMs - elapsedMs < safetyMarginMs) {
          stopReason = 'continuation_timeout';
          break;
        }
      }

      const { data: statusCheck } = await supabase
        .from('content_evolution_runs')
        .select('status')
        .eq('id', runId)
        .single();

      if (statusCheck?.status === 'failed') {
        stopReason = 'killed';
        logger.info('Run was externally killed — stopping pipeline', { runId });
        break;
      }

      supervisor.beginIteration(ctx.state);
      const config = supervisor.getPhaseConfig(ctx.state);
      const phase = config.phase;

      const iterSpan = createAppSpan('evolution.iteration', {
        iteration: ctx.state.iteration,
        phase,
        pool_size: ctx.state.getPoolSize(),
      });

      try {
        if (phase !== previousPhase) {
          logger.info('Phase transition', {
            from: previousPhase,
            to: phase,
            poolSize: ctx.state.getPoolSize(),
            diversity: ctx.state.diversityScore,
            iteration: ctx.state.iteration,
          });
          previousPhase = phase;
        }

        logger.info('Iteration start', {
          iteration: ctx.state.iteration,
          phase,
          poolSize: ctx.state.getPoolSize(),
        });

        const availableBudget = ctx.costTracker.getAvailableBudget();
        const [shouldStop, reason] = supervisor.shouldStop(ctx.state, availableBudget);
        if (shouldStop) {
          logger.info('Stopping pipeline', { reason });
          stopReason = reason;
          break;
        }

        for (const agentName of config.activeAgents) {
          if (agentName === 'ranking') {
            const rankingAgent = phase === 'COMPETITION' ? agents.tournament : agents.calibration;
            await runAgent(runId, rankingAgent, ctx, phase, logger, executionOrder++);
          } else if (agentName === 'flowCritique') {
            try {
              const flowResult = await runFlowCritiques(ctx, logger);
              logger.info('Flow critique pass complete', {
                critiqued: flowResult.critiqued,
                costUsd: flowResult.costUsd,
                iteration: ctx.state.iteration,
              });
              await persistCheckpoint(runId, ctx.state, 'flowCritique', phase, logger, 3, ctx.costTracker.getTotalSpent(), ctx.comparisonCache);
            } catch (error) {
              if (error instanceof BudgetExceededError) {
                logger.warn('Budget exceeded during flow critique', { error: error.message });
                await markRunPaused(runId, error);
                throw error;
              }
              logger.warn('Flow critique pass failed (non-fatal)', { error: String(error) });
            }
          } else {
            const agent = agents[agentName as keyof PipelineAgents];
            if (agent) {
              await runAgent(runId, agent, ctx, phase, logger, executionOrder++);
            }
          }
        }

        const top = ctx.state.getTopByRating(3);
        for (const v of top) {
          const ord = getOrdinal(ctx.state.ratings.get(v.id) ?? createRating());
          logger.debug('Top variant', { id: v.id, ordinal: ord.toFixed(1), strategy: v.strategy });
        }

        await persistCheckpointWithSupervisor(runId, ctx.state, supervisor, phase, logger, ctx.costTracker.getTotalSpent(), ctx.comparisonCache);
      } finally {
        iterSpan.end();
      }
    }

    const totalCost = ctx.costTracker.getTotalSpent();

    if (stopReason === 'continuation_timeout') {
      await checkpointAndMarkContinuationPending(
        runId, ctx.state, supervisor, supervisor.currentPhase, logger,
        totalCost, ctx.comparisonCache,
      );
    } else if (stopReason !== 'killed') {
      await supabase.from('content_evolution_runs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        total_variants: ctx.state.getPoolSize(),
        variants_generated: ctx.state.getPoolSize(),
        total_cost_usd: totalCost,
        error_message: stopReason === 'completed' ? null : stopReason,
      }).eq('id', runId).in('status', ['running']);

      const durationSeconds = (Date.now() - (options.startMs ?? Date.now())) / 1000;
      await finalizePipelineRun(runId, ctx, logger, stopReason, durationSeconds, supervisor);
    }

    pipelineSpan.setAttributes({
      stop_reason: stopReason,
      total_cost_usd: totalCost,
      total_variants: ctx.state.getPoolSize(),
      final_phase: supervisor.currentPhase,
    });

    logger.info('Full pipeline completed', {
      poolSize: ctx.state.getPoolSize(),
      totalCost,
      stopReason,
      finalPhase: supervisor.currentPhase,
    });

    return { stopReason, supervisorState: supervisor.getResumeState() };
  } catch (error) {
    pipelineSpan.recordException(error as Error);
    pipelineSpan.setStatus({ code: 2, message: (error as Error).message });

    if (logger.flush) {
      await logger.flush().catch(() => {});
    }

    await markRunFailed(runId, null, error);
    throw error;
  } finally {
    pipelineSpan.end();
  }
}

async function runAgent(
  runId: string,
  agent: PipelineAgent,
  ctx: ExecutionContext,
  phase: PipelinePhase,
  logger: EvolutionLogger,
  executionOrder: number,
  maxRetries: number = 1,
): Promise<AgentResult | null> {
  if (!agent.canExecute(ctx.state)) {
    logger.debug('Skipping agent (preconditions not met)', { agent: agent.name, phase });
    return null;
  }

  const saveCheckpoint = (): Promise<void> =>
    persistCheckpoint(runId, ctx.state, agent.name, phase, logger, 3, ctx.costTracker.getTotalSpent(), ctx.comparisonCache);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const agentSpan = createAppSpan(`evolution.agent.${agent.name}`, {
      agent: agent.name,
      iteration: ctx.state.iteration,
      phase,
      attempt,
    });

    try {
      const result = await agent.execute(ctx);
      agentSpan.setAttributes({
        success: result.success ? 1 : 0,
        cost_usd: result.costUsd,
        variants_added: result.variantsAdded ?? 0,
      });
      await persistAgentInvocation(runId, ctx.state.iteration, agent.name, executionOrder, result, logger);
      await saveCheckpoint();
      return result;
    } catch (error) {
      const errorMsg = (error as Error).message;
      agentSpan.recordException(error as Error);
      agentSpan.setStatus({ code: 2, message: errorMsg });

      if (error instanceof BudgetExceededError) {
        await saveCheckpoint().catch(() => {});
        logger.warn('Budget exceeded, pausing run', { agent: agent.name, error: error.message });
        await markRunPaused(runId, error);
        throw error;
      }

      if (error instanceof LLMRefusalError) {
        await saveCheckpoint().catch(() => {});
        logger.error('LLM refusal (content policy) — not retryable', { agent: agent.name, error: error.message });
        await markRunFailed(runId, agent.name, error);
        throw error;
      }

      if (isTransientError(error) && attempt < maxRetries) {
        const backoffMs = 1000 * Math.pow(2, attempt);
        logger.warn('Agent failed with transient error, retrying', {
          agent: agent.name,
          attempt: attempt + 1,
          maxRetries,
          backoffMs,
          error: (error as Error).message,
        });
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      await saveCheckpoint().catch(() => {});
      logger.error('Agent failed', { agent: agent.name, error: String(error), attempts: attempt + 1 });
      await markRunFailed(runId, agent.name, error);
      throw error;
    } finally {
      agentSpan.end();
    }
  }

  throw new Error('Unreachable: runAgent loop exhausted without return or throw');
}

async function persistCheckpointWithSupervisor(
  runId: string,
  state: PipelineState,
  supervisor: PoolSupervisor,
  phase: PipelinePhase,
  logger: EvolutionLogger,
  totalCostUsd?: number,
  comparisonCache?: ComparisonCache,
): Promise<void> {
  const checkpoint = {
    run_id: runId,
    iteration: state.iteration,
    phase,
    last_agent: 'iteration_complete',
    state_snapshot: {
      ...serializeState(state),
      supervisorState: supervisor.getResumeState(),
      ...(totalCostUsd != null && { costTrackerTotalSpent: totalCostUsd }),
      ...(comparisonCache && comparisonCache.size > 0 && { comparisonCacheEntries: comparisonCache.entries() }),
    },
  };

  try {
    const supabase = await createSupabaseServiceClient();
    await supabase.from('evolution_checkpoints').upsert(checkpoint, {
      onConflict: 'run_id,iteration,last_agent',
    });
    await supabase.from('content_evolution_runs').update({
      current_iteration: state.iteration,
      phase,
      last_heartbeat: new Date().toISOString(),
      runner_agents_completed: state.pool.length,
      ...(totalCostUsd != null && { total_cost_usd: totalCostUsd }),
    }).eq('id', runId);
  } catch (error) {
    logger.warn('Iteration checkpoint failed', { error: String(error) });
  }
}

export async function runFlowCritiques(
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<{ critiqued: number; costUsd: number }> {
  const { state, llmClient, costTracker } = ctx;

  const existingFlowIds = new Set(
    (state.allCritiques ?? [])
      .filter((c) => c.scale === '0-5')
      .map((c) => c.variationId),
  );

  const toCritique = state.pool.filter((v) => !existingFlowIds.has(v.id));

  const { critiques, entries } = await runCritiqueBatch<TextVariation>(llmClient, {
    items: toCritique,
    buildPrompt: (variant) => buildFlowCritiquePrompt(variant.text),
    agentName: 'flowCritique',
    parseResponse: (raw, variant) => {
      const result = parseFlowCritiqueResponse(raw);
      if (!result) return null;
      return {
        variationId: variant.id,
        dimensionScores: result.scores,
        goodExamples: {},
        badExamples: Object.fromEntries(
          Object.entries(result.frictionSentences).filter(([, v]) => v.length > 0),
        ),
        notes: {},
        reviewer: 'llm',
        scale: '0-5' as const,
      };
    },
    parallel: false,
    logger,
  });

  if (critiques.length > 0) {
    if (!state.allCritiques) state.allCritiques = [];
    state.allCritiques.push(...critiques);

    if (!state.dimensionScores) state.dimensionScores = {};
    for (const entry of entries) {
      if (entry.status === 'success' && entry.critique) {
        const variantId = entry.item.id;
        if (!state.dimensionScores[variantId]) state.dimensionScores[variantId] = {};
        for (const [dim, score] of Object.entries(entry.critique.dimensionScores)) {
          state.dimensionScores[variantId][`flow:${dim}`] = score;
        }
      }
    }
  }

  return { critiqued: critiques.length, costUsd: costTracker.getAgentCost('flowCritique') };
}
