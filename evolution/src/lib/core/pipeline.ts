// Pipeline orchestrator with two modes: minimal (Slice A) and full phase-aware (Slice B).
// Full pipeline uses PoolSupervisor for EXPANSION→COMPETITION phase transitions, checkpoint/resume.

import { v4 as uuidv4 } from 'uuid';

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

import { createAppSpan } from '../../../../instrumentation';
import { buildFlowCritiquePrompt, parseFlowCritiqueResponse } from '../flowRubric';
import type { AgentResult, EvolutionLogger, EvolutionRunSummary, ExecutionContext, PipelinePhase, PipelineState, TextVariation } from '../types';
import { BASELINE_STRATEGY, BudgetExceededError, EvolutionRunSummarySchema, LLMRefusalError } from '../types';
import { ComparisonCache } from './comparisonCache';
import { runCritiqueBatch } from './critiqueBatch';
import { isTransientError } from './errorClassification';
import { autoLinkPrompt, syncToArena, loadArenaEntries } from './arenaIntegration';
import { createScopedLLMClient } from './llmClient';
import { linkStrategyConfig, persistAgentMetrics, persistCostPrediction } from './metricsWriter';
import { checkpointAndMarkContinuationPending, computeAndPersistAttribution, createAgentInvocation, markRunFailed, persistCheckpoint, persistVariants, updateAgentInvocation } from './persistence';
import { captureBeforeState, computeDiffMetrics } from './pipelineUtilities';
import { createRating, getOrdinal } from './rating';
import { PoolSupervisor, supervisorConfigFromRunConfig } from './supervisor';
import type { SupervisorResumeState } from './supervisor';

export interface PipelineAgent {
  readonly name: string;
  execute(ctx: ExecutionContext): Promise<AgentResult>;
  canExecute(state: PipelineState): boolean;
}

export function insertBaselineVariant(state: PipelineState): void {
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
  const localPool = state.pool.filter((v) => !v.fromArena);
  const topVariants = state.getTopByRating(5).filter((v) => !v.fromArena).map((v) => ({
    id: v.id,
    strategy: v.strategy,
    ordinal: getOrdinal(state.ratings.get(v.id) ?? createRating()),
    isBaseline: v.strategy === BASELINE_STRATEGY,
  }));

  const allByRating = state.getTopByRating(state.getPoolSize()).filter((v) => !v.fromArena);
  const baselineIdx = allByRating.findIndex((v) => v.strategy === BASELINE_STRATEGY);
  const baselineVariant = baselineIdx >= 0 ? allByRating[baselineIdx] : undefined;

  if (!baselineVariant) {
    ctx.logger.warn('Baseline variant not found in pool', { runId: ctx.runId });
  }

  const matches = state.matchHistory;
  const avgConfidence = matches.length
    ? matches.reduce((s, m) => s + m.confidence, 0) / matches.length : 0;
  const decisiveRate = matches.length
    ? matches.filter((m) => m.confidence >= 0.7).length / matches.length : 0;

  const strategyEffectiveness: Record<string, { count: number; avgOrdinal: number }> = {};
  for (const v of localPool) {
    const ord = getOrdinal(state.ratings.get(v.id) ?? createRating());
    const entry = strategyEffectiveness[v.strategy] ??= { count: 0, avgOrdinal: 0 };
    entry.count++;
    entry.avgOrdinal += ord;
  }

  for (const entry of Object.values(strategyEffectiveness)) {
    entry.avgOrdinal /= entry.count;
  }

  const resumeState = supervisor?.getResumeState();

  return {
    version: 2,
    stopReason,
    finalPhase: supervisor?.currentPhase ?? 'EXPANSION',
    totalIterations: state.iteration,
    durationSeconds,
    ordinalHistory: resumeState?.ordinalHistory ?? [],
    diversityHistory: resumeState?.diversityHistory ?? [],
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

  const persistSummary = async (): Promise<void> => {
    if (!summary) return;
    const { error: summaryErr } = await supabase.from('evolution_runs')
      .update({ run_summary: summary }).eq('id', runId);
    if (summaryErr) {
      logger.warn('Failed to persist run_summary (column may not exist yet)', {
        runId, error: summaryErr.message,
      });
    }
  };

  const persistCostPredictionBlock = async (): Promise<void> => {
    try {
      const { data: runRow } = await supabase
        .from('evolution_runs')
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
  };

  await Promise.all([
    persistSummary(),
    persistVariants(runId, ctx, logger),
    persistAgentMetrics(runId, ctx, logger),
    persistCostPredictionBlock(),
    linkStrategyConfig(runId, ctx, logger),
  ]);

  // Sequential: attribution UPDATEs rows that persistVariants/persistAgentMetrics INSERT
  await computeAndPersistAttribution(runId, ctx, logger);

  // Sequential: autoLinkPrompt must complete before syncToArena
  await autoLinkPrompt(runId, ctx, logger);
  await syncToArena(runId, ctx, logger, ctx.state.lastSyncedMatchIndex);

  // Non-fatal: prune mid-iteration checkpoints for this run to reduce storage
  await pruneCheckpoints(runId, logger);

  await logger.flush?.();
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
  await supabase.from('evolution_runs').update({
    status: 'running',
    started_at: new Date().toISOString(),
    pipeline_type: 'minimal',
  }).eq('id', runId);

  // Load existing Arena entries into pool before baseline insertion
  const arenaTopicId = await loadArenaEntries(runId, ctx, logger);
  if (arenaTopicId) ctx.arenaTopicId = arenaTopicId;

  insertBaselineVariant(ctx.state);

  let executionOrder = 0;
  let budgetExhausted = false;
  for (const agent of agents) {
    if (!agent.canExecute(ctx.state)) {
      logger.debug('Skipping agent (preconditions not met)', { agent: agent.name });
      continue;
    }

    try {
      const invocationId = await createAgentInvocation(runId, ctx.state.iteration, agent.name, executionOrder++);
      const agentCtx = createAgentCtx(ctx, invocationId);
      const beforeState = captureBeforeState(ctx.state);
      const agentStartMs = Date.now();
      const result = await agent.execute(agentCtx);
      const durationMs = Date.now() - agentStartMs;
      const diffMetrics = computeDiffMetrics(beforeState, ctx.state);
      const invocationCost = ctx.costTracker.getInvocationCost(invocationId);
      logger.debug('Agent completed', { agent: agent.name, durationMs });
      await updateAgentInvocation(invocationId, {
        success: result.success,
        costUsd: invocationCost,
        skipped: result.skipped,
        error: result.error,
        executionDetail: result.executionDetail,
        diffMetrics,
      });
      await persistCheckpoint(runId, ctx.state, agent.name, 'EXPANSION', logger, 3, ctx.costTracker.getTotalSpent());
    } catch (error) {
      await persistCheckpoint(runId, ctx.state, agent.name, 'EXPANSION', logger, 3, ctx.costTracker.getTotalSpent())
        .catch(() => {});

      if (error instanceof BudgetExceededError) {
        logger.warn('Budget exceeded, completing run gracefully', { agent: agent.name, error: error.message });
        budgetExhausted = true;
        break;
      }

      logger.error('Agent failed', { agent: agent.name, error: String(error) });
      await markRunFailed(runId, agent.name, error);
      await logger.flush?.().catch(() => {});
      throw error;
    }
  }

  await supabase.from('evolution_runs').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_variants: ctx.state.pool.filter((v) => !v.fromArena).length,
    total_cost_usd: ctx.costTracker.getTotalSpent(),
    error_message: budgetExhausted ? 'budget_exhausted' : null,
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

export interface FullPipelineOptions {
  supervisorResume?: SupervisorResumeState;
  startMs?: number;
  maxDurationMs?: number;
  continuationCount?: number;
  /** Agent names remaining from a mid-iteration continuation yield. Used to resume mid-iteration. */
  resumeAgentNames?: string[];
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

    await supabase.from('evolution_runs').update({
      status: 'running',
      // Only set started_at on fresh runs — resumes preserve original start time
      ...((options.continuationCount ?? 0) === 0 && { started_at: new Date().toISOString() }),
      pipeline_type: ctx.payload.config.singleArticle ? 'single' : 'full',
    }).eq('id', runId).in('status', ['claimed']);

    const supervisorCfg = supervisorConfigFromRunConfig(ctx.payload.config);
    const supervisor = new PoolSupervisor(supervisorCfg);

    if (!ctx.comparisonCache) {
      ctx.comparisonCache = new ComparisonCache();
    }

    if (ctx.costTracker.getTotalReserved() !== 0) {
      logger.warn('Unexpected non-zero reservation on resume', {
        totalReserved: ctx.costTracker.getTotalReserved(),
      });
    }

    if (options.supervisorResume) {
      const r = options.supervisorResume;
      supervisor.setPhaseFromResume(r.phase);
      supervisor.ordinalHistory = r.ordinalHistory ?? [];
      supervisor.diversityHistory = r.diversityHistory ?? [];
    }

    let stopReason = 'completed';
    let previousPhase = supervisor.currentPhase;
    let yieldedAgentNames: string[] | undefined;
    // On a mid-iteration resume, only the first iteration uses the saved agent list.
    let pendingResumeAgents = options.resumeAgentNames;

    const isNearTimeout = (): boolean => {
      if (!options.maxDurationMs || !options.startMs) return false;
      const elapsedMs = Date.now() - options.startMs;
      const safetyMarginMs = Math.min(120_000, Math.max(60_000, elapsedMs * 0.10));
      return options.maxDurationMs - elapsedMs < safetyMarginMs;
    };

    // Load existing Arena entries into pool before baseline insertion (skip on resume)
    if (!options.supervisorResume) {
      const arenaTopicId = await loadArenaEntries(runId, ctx, logger);
      if (arenaTopicId) ctx.arenaTopicId = arenaTopicId;
    }

    insertBaselineVariant(ctx.state);

    for (let i = ctx.state.iteration; i < ctx.payload.config.maxIterations; i++) {
      // Check timeout before advancing iteration to avoid skipping iterations on resume
      if (isNearTimeout()) {
        stopReason = 'continuation_timeout';
        break;
      }

      const isResumedIteration = !!pendingResumeAgents;
      if (!isResumedIteration) {
        ctx.state.startNewIteration();
      }
      let executionOrder = 0;

      const { data: statusCheck } = await supabase
        .from('evolution_runs')
        .select('status')
        .eq('id', runId)
        .single();

      if (statusCheck?.status === 'failed') {
        stopReason = 'killed';
        logger.info('Run was externally killed — stopping pipeline', { runId });
        break;
      }

      if (!isResumedIteration) {
        supervisor.beginIteration(ctx.state);
      }
      const config = supervisor.getPhaseConfig(ctx.state);
      const phase = config.phase;

      // Consume pending resume agents for this iteration; subsequent iterations use the full list.
      const agentsToRun = pendingResumeAgents ?? config.activeAgents;
      pendingResumeAgents = undefined;

      const iterSpan = createAppSpan('evolution.iteration', {
        iteration: ctx.state.iteration,
        phase,
        pool_size: ctx.state.getPoolSize(),
        ...(isResumedIteration && { resumed_mid_iteration: 1, agents_remaining: agentsToRun.length }),
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

        logger.info(isResumedIteration ? 'Iteration resumed mid-iteration' : 'Iteration start', {
          iteration: ctx.state.iteration,
          phase,
          poolSize: ctx.state.getPoolSize(),
          ...(isResumedIteration && { agentsRemaining: agentsToRun.length }),
        });

        const availableBudget = ctx.costTracker.getAvailableBudget();
        const [shouldStop, reason] = supervisor.shouldStop(ctx.state, availableBudget);
        if (shouldStop) {
          logger.info('Stopping pipeline', { reason });
          stopReason = reason;
          break;
        }

        // Pass time context to agents for intra-agent time awareness
        if (options.maxDurationMs && options.startMs) {
          ctx.timeContext = { startMs: options.startMs, maxDurationMs: options.maxDurationMs };
        }

        try {
          for (const agentName of agentsToRun) {
            // Inter-agent timeout check: yield before Vercel hard-kills the process.
            if (isNearTimeout()) {
              const currentIdx = agentsToRun.indexOf(agentName);
              yieldedAgentNames = agentsToRun.slice(currentIdx);
              stopReason = 'continuation_timeout';
              logger.info('Inter-agent timeout — yielding for continuation', {
                iteration: ctx.state.iteration,
                phase,
                lastCompletedAgent: currentIdx > 0 ? agentsToRun[currentIdx - 1] : 'none',
                remainingAgents: yieldedAgentNames,
              });
              break;
            }

            if (agentName === 'ranking') {
              const rankingAgent = phase === 'COMPETITION' ? agents.tournament : agents.calibration;
              await runAgent(runId, rankingAgent, ctx, phase, logger, executionOrder++);
            } else if (agentName === 'flowCritique') {
              try {
                const flowInvocationId = await createAgentInvocation(runId, ctx.state.iteration, 'flowCritique', executionOrder++);
                const flowCtx = createAgentCtx(ctx, flowInvocationId);
                const flowResult = await runFlowCritiques(flowCtx, logger);
                const flowCost = ctx.costTracker.getInvocationCost(flowInvocationId);
                await updateAgentInvocation(flowInvocationId, {
                  success: true,
                  costUsd: flowCost,
                });
                logger.info('Flow critique pass complete', {
                  critiqued: flowResult.critiqued,
                  costUsd: flowCost,
                  iteration: ctx.state.iteration,
                });
                await persistCheckpoint(runId, ctx.state, 'flowCritique', phase, logger, 3, ctx.costTracker.getTotalSpent());
              } catch (error) {
                if (error instanceof BudgetExceededError) throw error;
                logger.warn('Flow critique pass failed (non-fatal)', { error: String(error) });
              }
            } else {
              const agent = agents[agentName as keyof PipelineAgents];
              if (agent) {
                await runAgent(runId, agent, ctx, phase, logger, executionOrder++);
              }
            }
          }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            stopReason = 'budget_exhausted';
            break;
          }
          throw error;
        }

        // Break iteration loop if we yielded mid-iteration
        if (stopReason === 'continuation_timeout') break;

        const top = ctx.state.getTopByRating(3);
        for (const v of top) {
          const ord = getOrdinal(ctx.state.ratings.get(v.id) ?? createRating());
          logger.debug('Top variant', { id: v.id, ordinal: ord.toFixed(1), strategy: v.strategy });
        }

        // Mid-run arena sync: send new matches since last watermark (non-fatal)
        if (ctx.arenaTopicId) {
          try {
            const preWatermark = ctx.state.matchHistory.length;
            await syncToArena(runId, ctx, logger, ctx.state.lastSyncedMatchIndex);
            ctx.state.lastSyncedMatchIndex = preWatermark;
          } catch (syncErr) {
            logger.warn('Mid-run arena sync failed (non-fatal)', { runId, error: syncErr instanceof Error ? syncErr.message : String(syncErr) });
          }
        }

        await persistCheckpoint(runId, ctx.state, 'iteration_complete', phase, logger, 3, ctx.costTracker.getTotalSpent(), supervisor);
      } finally {
        iterSpan.end();
      }
    }

    const totalCost = ctx.costTracker.getTotalSpent();

    if (stopReason === 'continuation_timeout') {
      const lastAgent = yieldedAgentNames ? 'continuation_yield' : 'iteration_complete';
      await checkpointAndMarkContinuationPending(
        runId, ctx.state, supervisor, supervisor.currentPhase, logger,
        totalCost, lastAgent, yieldedAgentNames,
      );
    } else if (stopReason !== 'killed') {
      await supabase.from('evolution_runs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        total_variants: ctx.state.pool.filter((v) => !v.fromArena).length,
        total_cost_usd: totalCost,
        error_message: stopReason === 'completed' ? null : stopReason,
      }).eq('id', runId).in('status', ['running']);

      const durationSeconds = (Date.now() - (options.startMs ?? Date.now())) / 1000;
      await finalizePipelineRun(runId, ctx, logger, stopReason, durationSeconds, supervisor);
    }

    pipelineSpan.setAttributes({
      stop_reason: stopReason,
      total_cost_usd: totalCost,
      total_variants: ctx.state.pool.filter((v) => !v.fromArena).length,
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

    await logger.flush?.().catch(() => {});
    await markRunFailed(runId, null, error);
    throw error;
  } finally {
    pipelineSpan.end();
  }
}

/**
 * Create a scoped ExecutionContext for a single agent invocation.
 * Shallow copy — costTracker/state/logger shared, invocationId/llmClient scoped.
 */
export function createAgentCtx(ctx: ExecutionContext, invocationId: string): ExecutionContext {
  return {
    ...ctx,
    invocationId,
    llmClient: createScopedLLMClient(ctx.llmClient, invocationId),
  };
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
    persistCheckpoint(runId, ctx.state, agent.name, phase, logger, 3, ctx.costTracker.getTotalSpent());

  // Create invocation row upfront to get UUID for cost attribution
  const invocationId = await createAgentInvocation(runId, ctx.state.iteration, agent.name, executionOrder);
  const agentCtx = createAgentCtx(ctx, invocationId);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const agentSpan = createAppSpan(`evolution.agent.${agent.name}`, {
      agent: agent.name,
      iteration: ctx.state.iteration,
      phase,
      attempt,
    });

    try {
      const beforeState = captureBeforeState(ctx.state);
      const agentStartMs = Date.now();
      const result = await agent.execute(agentCtx);
      const durationMs = Date.now() - agentStartMs;
      const diffMetrics = computeDiffMetrics(beforeState, ctx.state);
      const invocationCost = ctx.costTracker.getInvocationCost(invocationId);
      agentSpan.setAttributes({
        success: result.success ? 1 : 0,
        cost_usd: invocationCost,
        variants_added: result.variantsAdded ?? 0,
        duration_ms: durationMs,
      });
      logger.debug('Agent completed', { agent: agent.name, durationMs, phase });
      await updateAgentInvocation(invocationId, {
        success: result.success,
        costUsd: invocationCost,
        skipped: result.skipped,
        error: result.error,
        executionDetail: result.executionDetail,
        diffMetrics,
      });
      await saveCheckpoint();
      return result;
    } catch (error) {
      const errorMsg = (error as Error).message;
      agentSpan.recordException(error as Error);
      agentSpan.setStatus({ code: 2, message: errorMsg });

      if (error instanceof BudgetExceededError) {
        await saveCheckpoint().catch(() => {});
        logger.warn('Budget exceeded, completing gracefully', { agent: agent.name, error: error.message });
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

/** Prune mid-iteration checkpoints, keeping one per (run_id, iteration). Non-fatal. */
export async function pruneCheckpoints(runId: string, logger: EvolutionLogger): Promise<void> {
  try {
    const supabase = await createSupabaseServiceClient();

    const { data: keepRows, error: keepErr } = await supabase
      .rpc('get_latest_checkpoint_ids_per_iteration', { p_run_id: runId });

    if (keepErr) {
      logger.warn('Checkpoint pruning: failed to get keeper IDs', { runId, error: keepErr.message });
      return;
    }

    const keepIds = (keepRows ?? []).map((r: { id: string }) => r.id);
    if (keepIds.length === 0) return;

    const { error: deleteErr, count } = await supabase
      .from('evolution_checkpoints')
      .delete({ count: 'exact' })
      .eq('run_id', runId)
      .not('id', 'in', `(${keepIds.join(',')})`);

    if (deleteErr) {
      logger.warn('Checkpoint pruning: delete failed', { runId, error: deleteErr.message });
      return;
    }

    if (count && count > 0) {
      logger.info('Checkpoints pruned', { runId, deleted: count, kept: keepIds.length });
    }
  } catch (error) {
    logger.warn('Checkpoint pruning failed (non-fatal)', { runId, error: String(error) });
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

  const toCritique = state.pool.filter((v) => !v.fromArena && !existingFlowIds.has(v.id));

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
