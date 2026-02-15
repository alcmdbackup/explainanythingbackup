// Pipeline orchestrator with two modes: minimal (Slice A) and full phase-aware (Slice B).
// Full pipeline uses PoolSupervisor for EXPANSION→COMPETITION phase transitions, checkpoint/resume.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { serializeState } from './state';
import { getOrdinal, createRating } from './rating';
import { PoolSupervisor, supervisorConfigFromRunConfig } from './supervisor';
import type { SupervisorResumeState, PhaseConfig } from './supervisor';
import type { PipelineState, EvolutionLogger, PipelinePhase, AgentResult, ExecutionContext, EvolutionRunSummary } from '../types';
import { BudgetExceededError, LLMRefusalError, BASELINE_STRATEGY, EvolutionRunSummarySchema } from '../types';
import { ComparisonCache } from './comparisonCache';
import { isTransientError } from './errorClassification';
import type { EvolutionFeatureFlags } from './featureFlags';
import { createAppSpan } from '../../../../instrumentation';
import { v4 as uuidv4 } from 'uuid';
import { linkStrategyConfig, persistCostPrediction, persistAgentMetrics } from './metricsWriter';
import { persistCheckpoint, persistVariants, markRunFailed, markRunPaused } from './persistence';
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

/** Insert the original text as a baseline variant for rating comparison. Idempotent via BASELINE_STRATEGY check. */
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

/** Build a run summary from pipeline state at completion. Works with or without a supervisor. */
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

/** Validate a run summary with Zod safeParse. Returns null on invalid data (non-crashing). */
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

/** Shared post-completion: persist run summary, variants, agent metrics, strategy config, and prompt link. */
export async function finalizePipelineRun(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
  stopReason: string,
  durationSeconds: number,
  supervisor?: PoolSupervisor,
): Promise<void> {
  const supabase = await createSupabaseServiceClient();

  // Persist run summary (column may not exist if migration is pending)
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

  // Persist variants to content_evolution_variants for admin UI
  await persistVariants(runId, ctx, logger);

  // Persist per-agent cost metrics for Elo/dollar optimization
  await persistAgentMetrics(runId, ctx, logger);

  // Compute cost prediction (estimated vs actual) if estimate was stored at queue time
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

  // Link run to strategy config for Elo optimization dashboard
  await linkStrategyConfig(runId, ctx, logger);

  // Auto-link prompt_id if not already set (graceful during transition)
  await autoLinkPrompt(runId, ctx, logger);

  // Feed top 3 variants into Hall of Fame
  await feedHallOfFame(runId, ctx, logger);

  // Flush any remaining buffered log entries to DB
  if (logger.flush) await logger.flush();
}

/**
 * Execute a minimal pipeline: run agents sequentially, checkpoint after each.
 * This is Slice A's simplified version — no phase transitions, single iteration.
 */
export async function executeMinimalPipeline(
  runId: string,
  agents: PipelineAgent[],
  ctx: ExecutionContext,
  logger: EvolutionLogger,
  options?: { startMs?: number },
): Promise<void> {
  // Inject comparison cache if not already present
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
      await persistCheckpoint(runId, ctx.state, agent.name, 'EXPANSION', logger, 3, ctx.costTracker.getTotalSpent(), ctx.comparisonCache).catch(() => {});

      if (error instanceof BudgetExceededError) {
        logger.warn('Budget exceeded, pausing run', { agent: agent.name, error: error.message });
        await markRunPaused(runId, error);
        if (logger.flush) await logger.flush().catch(() => {});
        return;
      }

      logger.error('Agent failed', { agent: agent.name, error: String(error) });
      await markRunFailed(runId, agent.name, error);
      if (logger.flush) await logger.flush().catch(() => {});
      throw error;
    }
  }

  // Mark run completed
  await supabase.from('content_evolution_runs').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_variants: ctx.state.getPoolSize(),
    variants_generated: ctx.state.getPoolSize(),
    total_cost_usd: ctx.costTracker.getTotalSpent(),
  }).eq('id', runId);

  // Persist summary, variants, agent metrics, and strategy config
  const durationSeconds = (Date.now() - (options?.startMs ?? Date.now())) / 1000;
  await finalizePipelineRun(runId, ctx, logger, 'completed', durationSeconds, undefined);

  logger.info('Pipeline completed', {
    poolSize: ctx.state.getPoolSize(),
    totalCost: ctx.costTracker.getTotalSpent(),
  });
}

// ─── Full phase-aware pipeline (Slice B) ────────────────────────

/** Named agents for phase-aware pipeline execution. */
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

/** Type-safe agent name union derived from PipelineAgents keys. */
export type AgentName = keyof PipelineAgents;

/** Entry for a conditionally-executed agent gated by phase config and feature flags. */
interface GatedAgentEntry {
  configKey: keyof PhaseConfig;
  agent: PipelineAgent | undefined;
  flagKey?: keyof EvolutionFeatureFlags;
}

/** Run agents gated by phase config and feature flags. Returns updated executionOrder. */
async function runGatedAgents(
  entries: GatedAgentEntry[],
  config: PhaseConfig,
  featureFlags: EvolutionFeatureFlags | undefined,
  runId: string,
  ctx: ExecutionContext,
  phase: PipelinePhase,
  logger: EvolutionLogger,
  executionOrder: number,
): Promise<number> {
  for (const { configKey, agent, flagKey } of entries) {
    if (!config[configKey] || !agent) continue;
    if (flagKey && featureFlags?.[flagKey] === false) {
      logger.info(`${agent.name} agent disabled by feature flag`, { iteration: ctx.state.iteration });
      continue;
    }
    await runAgent(runId, agent, ctx, phase, logger, executionOrder++);
  }
  return executionOrder;
}

/** Options for full pipeline execution. */
export interface FullPipelineOptions {
  /** Restore supervisor state from a previous checkpoint. */
  supervisorResume?: SupervisorResumeState;
  /** Per-agent feature flags (defaults to all-enabled if omitted). */
  featureFlags?: EvolutionFeatureFlags;
  /** Start timestamp for run duration tracking. */
  startMs?: number;
  /** ERR-3: Restore comparison cache entries from a previous checkpoint. */
  resumeComparisonCacheEntries?: Array<[string, import('./comparisonCache').CachedMatch]>;
}

/**
 * Execute the full phase-aware pipeline using PoolSupervisor for phase transitions.
 * Runs EXPANSION→COMPETITION with agent gating, checkpoint after each agent, and
 * convergence/budget/iteration-based stopping conditions.
 */
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
    const supabase = await createSupabaseServiceClient();

    // Guard: only transition from 'claimed' — .in() prevents overwriting a kill
    await supabase.from('content_evolution_runs').update({
      status: 'running',
      started_at: new Date().toISOString(),
      pipeline_type: ctx.payload.config.singleArticle ? 'single' : 'full',
    }).eq('id', runId).in('status', ['claimed']);

    // Construct supervisor
    // CFG-3: Pass featureFlags to supervisor for future flag-gated phase behavior
    const supervisorCfg = supervisorConfigFromRunConfig(ctx.payload.config, options.featureFlags);
    const supervisor = new PoolSupervisor(supervisorCfg);

    // Inject comparison cache for cross-iteration deduplication
    // ERR-3: Restore from checkpoint if available, otherwise create fresh
    if (!ctx.comparisonCache) {
      if (options.resumeComparisonCacheEntries && options.resumeComparisonCacheEntries.length > 0) {
        ctx.comparisonCache = ComparisonCache.fromEntries(options.resumeComparisonCacheEntries);
        logger.info('Restored comparison cache from checkpoint', { entries: options.resumeComparisonCacheEntries.length });
      } else {
        ctx.comparisonCache = new ComparisonCache();
      }
    }

    // COST-5: Reservations are transient — a fresh/resumed CostTracker must start at zero.
    // Non-zero here would mean orphaned reservations leaked across a resume boundary.
    if (ctx.costTracker.getTotalReserved() !== 0) {
      logger.warn('Unexpected non-zero reservation on resume', {
        totalReserved: ctx.costTracker.getTotalReserved(),
      });
    }

    // Restore from checkpoint if resuming
    if (options.supervisorResume) {
      const r = options.supervisorResume;
      supervisor.setPhaseFromResume(r.phase, r.strategyRotationIndex);
      supervisor.ordinalHistory = r.ordinalHistory ?? [];
      supervisor.diversityHistory = r.diversityHistory ?? [];
    }

    let stopReason = 'completed';
    let previousPhase = supervisor.currentPhase;

    insertBaselineVariant(ctx.state, runId);

    // Propagate feature flags to execution context for agent-level access
    if (options.featureFlags) {
      ctx.featureFlags = options.featureFlags;
    }

    for (let i = ctx.state.iteration; i < ctx.payload.config.maxIterations; i++) {
      ctx.state.startNewIteration();
      let executionOrder = 0;

      // Check if run was externally killed
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

      // Phase detection and config
      supervisor.beginIteration(ctx.state);
      const config = supervisor.getPhaseConfig(ctx.state);
      const phase = config.phase;

      const iterSpan = createAppSpan('evolution.iteration', {
        iteration: ctx.state.iteration,
        phase,
        pool_size: ctx.state.getPoolSize(),
      });

      try {
        // Log phase transition
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

        // Check stopping conditions (includes quality threshold for single-article mode)
        const availableBudget = ctx.costTracker.getAvailableBudget();
        const [shouldStop, reason] = supervisor.shouldStop(ctx.state, availableBudget);
        if (shouldStop) {
          logger.info('Stopping pipeline', { reason });
          stopReason = reason;
          break;
        }

        // === Generation ===
        if (config.runGeneration) {
          await runAgent(runId, agents.generation, ctx, phase, logger, executionOrder++);
        }

        // Pre-edit agents: outline generation + quality critique (run before flow critique + editing)
        executionOrder = await runGatedAgents([
          { configKey: 'runOutlineGeneration', agent: agents.outlineGeneration, flagKey: 'outlineGenerationEnabled' },
          { configKey: 'runReflection', agent: agents.reflection },
        ], config, options.featureFlags, runId, ctx, phase, logger, executionOrder);

        // === Flow Critique (step 3b) — runs after quality critique, before editing agents ===
        if (config.runReflection && options.featureFlags?.flowCritiqueEnabled === true) {
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
        }

        // Feature-flag-gated editing + always-on evolution agents
        executionOrder = await runGatedAgents([
          { configKey: 'runIterativeEditing', agent: agents.iterativeEditing, flagKey: 'iterativeEditingEnabled' },
          { configKey: 'runTreeSearch', agent: agents.treeSearch, flagKey: 'treeSearchEnabled' },
          { configKey: 'runSectionDecomposition', agent: agents.sectionDecomposition },
          { configKey: 'runDebate', agent: agents.debate },
          { configKey: 'runEvolution', agent: agents.evolution },
        ], config, options.featureFlags, runId, ctx, phase, logger, executionOrder);

        // === Calibration (EXPANSION) or Tournament (COMPETITION) ===
        if (config.runCalibration) {
          const rankingAgent = phase === 'COMPETITION' ? agents.tournament : agents.calibration;
          await runAgent(runId, rankingAgent, ctx, phase, logger, executionOrder++);
        }

        // === Proximity / diversity tracking (optional) ===
        if (config.runProximity && agents.proximity) {
          await runAgent(runId, agents.proximity, ctx, phase, logger, executionOrder++);
        }

        // === Meta-review (Slice C — optional) ===
        if (config.runMetaReview && agents.metaReview) {
          await runAgent(runId, agents.metaReview, ctx, phase, logger, executionOrder++);
        }

        // Report top performers
        const top = ctx.state.getTopByRating(3);
        for (const v of top) {
          const ord = getOrdinal(ctx.state.ratings.get(v.id) ?? createRating());
          logger.debug('Top variant', { id: v.id, ordinal: ord.toFixed(1), strategy: v.strategy });
        }

        // Persist iteration checkpoint with supervisor state
        await persistCheckpointWithSupervisor(runId, ctx.state, supervisor, phase, logger, ctx.costTracker.getTotalSpent(), ctx.comparisonCache);
      } finally {
        iterSpan.end();
      }
    }

    // Mark run completed (skip if killed — preserve the kill attribution)
    const totalCost = ctx.costTracker.getTotalSpent();
    if (stopReason !== 'killed') {
      await supabase.from('content_evolution_runs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        total_variants: ctx.state.getPoolSize(),
        variants_generated: ctx.state.getPoolSize(),
        total_cost_usd: totalCost,
        error_message: stopReason === 'completed' ? null : stopReason,
      }).eq('id', runId).in('status', ['running']);

      // Persist summary, variants, agent metrics, and strategy config
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
    // Flush buffered log entries on error so they're visible in admin UI
    if (logger.flush) await logger.flush().catch(() => {});
    // Mark run as failed if not already in a terminal status
    await markRunFailed(runId, null, error);
    throw error;
  } finally {
    pipelineSpan.end();
  }
}

/** Run a single agent with error handling, checkpoint, retry for transient errors, and OTel span.
 *
 * Retry design: NO state rollback on retry. Partial mutations from the failed attempt
 * are safe because the pool is append-only (addToPool dedup via poolIds.has), variants
 * get unique uuid4() IDs, and partial ratings represent valid comparison results.
 *
 * Retry amplification: SDK retries 3× internally (maxRetries: 3 in llms.ts), then this
 * function retries the entire agent once (maxRetries: 1 default). Total = up to 8 LLM
 * call attempts for a persistent transient error. */
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
      await persistCheckpoint(runId, ctx.state, agent.name, phase, logger, 3, ctx.costTracker.getTotalSpent(), ctx.comparisonCache);
      return result;
    } catch (error) {
      const errorMsg = (error as Error).message;
      agentSpan.recordException(error as Error);
      agentSpan.setStatus({ code: 2, message: errorMsg });

      if (error instanceof BudgetExceededError) {
        await persistCheckpoint(runId, ctx.state, agent.name, phase, logger, 3, ctx.costTracker.getTotalSpent(), ctx.comparisonCache).catch(() => {});
        logger.warn('Budget exceeded, pausing run', { agent: agent.name, error: error.message });
        await markRunPaused(runId, error);
        throw error;
      }

      // ERR-6: Content policy refusals are permanent — never retry
      if (error instanceof LLMRefusalError) {
        await persistCheckpoint(runId, ctx.state, agent.name, phase, logger, 3, ctx.costTracker.getTotalSpent(), ctx.comparisonCache).catch(() => {});
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
        // No state rollback — partial mutations are safe (see JSDoc above)
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      // Fatal error or retries exhausted
      await persistCheckpoint(runId, ctx.state, agent.name, phase, logger, 3, ctx.costTracker.getTotalSpent(), ctx.comparisonCache).catch(() => {});
      logger.error('Agent failed', { agent: agent.name, error: String(error), attempts: attempt + 1 });
      await markRunFailed(runId, agent.name, error);
      throw error;
    } finally {
      agentSpan.end();
    }
  }
  // Unreachable — loop always returns or throws
  throw new Error('Unreachable: runAgent loop exhausted without return or throw');
}

/** Persist checkpoint including supervisor resume state. */
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
      // COST-6: Persist cost tracker total spent for accurate budget on resume
      ...(totalCostUsd != null && { costTrackerTotalSpent: totalCostUsd }),
      // ERR-3: Persist comparison cache to avoid re-running comparisons on resume
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

/**
 * Standalone flow critique pass: scores each variant on 5 flow dimensions (0-5).
 * Implemented as a standalone function (NOT via ReflectionAgent.execute()) because
 * ReflectionAgent overwrites state.dimensionScores with the latest critique's scores.
 * This function appends flow Critique objects to state.allCritiques only, preserving quality scores.
 */
export async function runFlowCritiques(
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<{ critiqued: number; costUsd: number }> {
  const { state, llmClient, costTracker } = ctx;

  // Critique all variants that don't already have a flow critique this iteration
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

  // Update state with successful flow critiques
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
