// Pipeline orchestrator with two modes: minimal (Slice A) and full phase-aware (Slice B).
// Full pipeline uses PoolSupervisor for EXPANSION→COMPETITION phase transitions, checkpoint/resume.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { serializeState } from './state';
import { PoolSupervisor, supervisorConfigFromRunConfig } from './supervisor';
import type { SupervisorResumeState } from './supervisor';
import type { PipelineState, EvolutionLogger, PipelinePhase, AgentResult, ExecutionContext, EvolutionRunSummary } from '../types';
import { BudgetExceededError, BASELINE_STRATEGY, EvolutionRunSummarySchema } from '../types';
import { ComparisonCache } from './comparisonCache';
import type { EvolutionFeatureFlags } from './featureFlags';
import { createAppSpan } from '../../../../instrumentation';

/** Agent interface for pipeline execution. */
export interface PipelineAgent {
  readonly name: string;
  execute(ctx: ExecutionContext): Promise<AgentResult>;
  canExecute(state: PipelineState): boolean;
}

/** Persist checkpoint to DB with retry. */
async function persistCheckpoint(
  runId: string,
  state: PipelineState,
  agentName: string,
  phase: PipelinePhase,
  logger: EvolutionLogger,
  maxRetries = 3,
): Promise<void> {
  const checkpoint = {
    run_id: runId,
    iteration: state.iteration,
    phase,
    last_agent: agentName,
    state_snapshot: serializeState(state),
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
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
      }).eq('id', runId);
      return;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      logger.warn('Checkpoint write failed, retrying', { attempt, error: String(error) });
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/** Mark run as failed in DB. */
async function markRunFailed(runId: string, agentName: string, error: unknown): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  await supabase.from('content_evolution_runs').update({
    status: 'failed',
    error_message: `Agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`,
  }).eq('id', runId);
}

/** Mark run as paused (budget exceeded). */
async function markRunPaused(runId: string, error: BudgetExceededError): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  await supabase.from('content_evolution_runs').update({
    status: 'paused',
    error_message: error.message,
  }).eq('id', runId);
}

/** Insert the original text as a baseline variant for Elo comparison. Idempotent via poolIds guard. */
export function insertBaselineVariant(state: PipelineState, runId: string): void {
  const baselineId = `baseline-${runId}`;
  if (state.poolIds.has(baselineId)) return;
  state.addToPool({
    id: baselineId,
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
  const topVariants = state.getTopByElo(5).map((v) => ({
    id: v.id,
    strategy: v.strategy,
    elo: state.eloRatings.get(v.id) ?? 1200,
    isBaseline: v.strategy === BASELINE_STRATEGY,
  }));

  const allByElo = state.getTopByElo(state.getPoolSize());
  const baselineIdx = allByElo.findIndex((v) => v.strategy === BASELINE_STRATEGY);
  const baselineVariant = baselineIdx >= 0 ? allByElo[baselineIdx] : undefined;

  if (baselineIdx < 0) {
    ctx.logger.warn('Baseline variant not found in pool', { runId: ctx.runId });
  }

  const matches = state.matchHistory;
  const avgConfidence = matches.length > 0
    ? matches.reduce((s, m) => s + m.confidence, 0) / matches.length : 0;
  const decisiveRate = matches.length > 0
    ? matches.filter((m) => m.confidence >= 0.7).length / matches.length : 0;

  const strategyEffectiveness: Record<string, { count: number; avgElo: number }> = {};
  for (const v of state.pool) {
    const elo = state.eloRatings.get(v.id) ?? 1200;
    if (!strategyEffectiveness[v.strategy]) {
      strategyEffectiveness[v.strategy] = { count: 0, avgElo: 0 };
    }
    strategyEffectiveness[v.strategy].count++;
    strategyEffectiveness[v.strategy].avgElo += elo;
  }
  for (const s of Object.values(strategyEffectiveness)) {
    s.avgElo = s.avgElo / s.count;
  }

  return {
    version: 1,
    stopReason,
    finalPhase: supervisor?.currentPhase ?? 'EXPANSION',
    totalIterations: state.iteration,
    durationSeconds,
    eloHistory: supervisor?.getResumeState().eloHistory ?? [],
    diversityHistory: supervisor?.getResumeState().diversityHistory ?? [],
    matchStats: { totalMatches: matches.length, avgConfidence, decisiveRate },
    topVariants,
    baselineRank: baselineIdx >= 0 ? baselineIdx + 1 : null,
    baselineElo: baselineVariant
      ? (state.eloRatings.get(baselineVariant.id) ?? null)
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
  }).eq('id', runId);

  insertBaselineVariant(ctx.state, runId);

  for (const agent of agents) {
    if (!agent.canExecute(ctx.state)) {
      logger.info('Skipping agent (preconditions not met)', { agent: agent.name });
      continue;
    }

    try {
      logger.info('Executing agent', { agent: agent.name, iteration: ctx.state.iteration });
      const result = await agent.execute(ctx);
      logger.info('Agent completed', {
        agent: agent.name,
        success: result.success,
        costUsd: result.costUsd,
        variantsAdded: result.variantsAdded,
      });
      await persistCheckpoint(runId, ctx.state, agent.name, 'EXPANSION', logger);
    } catch (error) {
      // Save partial progress before handling error
      await persistCheckpoint(runId, ctx.state, agent.name, 'EXPANSION', logger).catch(() => {});

      if (error instanceof BudgetExceededError) {
        logger.warn('Budget exceeded, pausing run', { agent: agent.name, error: error.message });
        await markRunPaused(runId, error);
        return;
      }

      logger.error('Agent failed', { agent: agent.name, error: String(error) });
      await markRunFailed(runId, agent.name, error);
      throw error;
    }
  }

  // Mark run completed
  await supabase.from('content_evolution_runs').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_variants: ctx.state.getPoolSize(),
    total_cost_usd: ctx.costTracker.getTotalSpent(),
  }).eq('id', runId);

  // Persist run summary separately — column may not exist if migration is pending
  const durationSeconds = (Date.now() - (options?.startMs ?? Date.now())) / 1000;
  const rawSummary = buildRunSummary(ctx, 'completed', durationSeconds, undefined);
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
  proximity?: PipelineAgent;
  metaReview?: PipelineAgent;
}

/** Options for full pipeline execution. */
export interface FullPipelineOptions {
  /** Restore supervisor state from a previous checkpoint. */
  supervisorResume?: SupervisorResumeState;
  /** Per-agent feature flags (defaults to all-enabled if omitted). */
  featureFlags?: EvolutionFeatureFlags;
  /** Start timestamp for run duration tracking. */
  startMs?: number;
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
): Promise<{ stopReason: string; supervisorState: SupervisorResumeState }> {
  const pipelineSpan = createAppSpan('evolution.pipeline.full', {
    run_id: runId,
    max_iterations: ctx.payload.config.maxIterations,
    budget_cap_usd: ctx.costTracker.getAvailableBudget(),
  });

  try {
    const supabase = await createSupabaseServiceClient();
    await supabase.from('content_evolution_runs').update({
      status: 'running',
      started_at: new Date().toISOString(),
    }).eq('id', runId);

    // Construct supervisor
    const supervisorCfg = supervisorConfigFromRunConfig(ctx.payload.config);
    const supervisor = new PoolSupervisor(supervisorCfg);

    // Inject comparison cache for cross-iteration deduplication
    if (!ctx.comparisonCache) {
      ctx.comparisonCache = new ComparisonCache();
    }

    // Restore from checkpoint if resuming
    if (options.supervisorResume) {
      const r = options.supervisorResume;
      supervisor.setPhaseFromResume(r.phase, r.strategyRotationIndex);
      supervisor.eloHistory = r.eloHistory ?? [];
      supervisor.diversityHistory = r.diversityHistory ?? [];
    }

    let stopReason = 'completed';
    let previousPhase = supervisor.currentPhase;

    insertBaselineVariant(ctx.state, runId);

    for (let i = ctx.state.iteration; i < ctx.payload.config.maxIterations; i++) {
      ctx.state.startNewIteration();

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

        // Check stopping conditions
        const availableBudget = ctx.costTracker.getAvailableBudget();
        const [shouldStop, reason] = supervisor.shouldStop(ctx.state, availableBudget);
        if (shouldStop) {
          logger.info('Stopping pipeline', { reason });
          stopReason = reason;
          break;
        }

        // === Generation ===
        if (config.runGeneration) {
          await runAgent(runId, agents.generation, ctx, phase, logger);
        }

        // === Reflection (Slice C — optional) ===
        if (config.runReflection && agents.reflection) {
          await runAgent(runId, agents.reflection, ctx, phase, logger);
        }

        // === Evolution (evolvePool) ===
        if (config.runEvolution) {
          if (options.featureFlags?.evolvePoolEnabled === false) {
            logger.info('Evolution agent disabled by feature flag', { iteration: ctx.state.iteration });
          } else {
            await runAgent(runId, agents.evolution, ctx, phase, logger);
          }
        }

        // === Calibration (EXPANSION) or Tournament (COMPETITION) ===
        if (config.runCalibration) {
          const useTournament = phase === 'COMPETITION' && options.featureFlags?.tournamentEnabled !== false;
          const rankingAgent = useTournament ? agents.tournament : agents.calibration;
          await runAgent(runId, rankingAgent, ctx, phase, logger);
        }

        // === Proximity / diversity tracking (optional) ===
        if (config.runProximity && agents.proximity) {
          await runAgent(runId, agents.proximity, ctx, phase, logger);
        }

        // === Meta-review (Slice C — optional) ===
        if (config.runMetaReview && agents.metaReview) {
          await runAgent(runId, agents.metaReview, ctx, phase, logger);
        }

        // Report top performers
        const top = ctx.state.getTopByElo(3);
        for (const v of top) {
          const elo = ctx.state.eloRatings.get(v.id) ?? 1200;
          logger.debug('Top variant', { id: v.id, elo: elo.toFixed(0), strategy: v.strategy });
        }

        // Persist iteration checkpoint with supervisor state
        await persistCheckpointWithSupervisor(runId, ctx.state, supervisor, phase, logger);
      } finally {
        iterSpan.end();
      }
    }

    // Mark run completed
    const totalCost = ctx.costTracker.getTotalSpent();
    await supabase.from('content_evolution_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      total_variants: ctx.state.getPoolSize(),
      total_cost_usd: totalCost,
      error_message: stopReason === 'completed' ? null : stopReason,
    }).eq('id', runId);

    // Persist run summary separately — column may not exist if migration is pending
    const durationSeconds = (Date.now() - (options.startMs ?? Date.now())) / 1000;
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
    throw error;
  } finally {
    pipelineSpan.end();
  }
}

/** Run a single agent with error handling, checkpoint, and OTel span. */
async function runAgent(
  runId: string,
  agent: PipelineAgent,
  ctx: ExecutionContext,
  phase: PipelinePhase,
  logger: EvolutionLogger,
): Promise<AgentResult | null> {
  if (!agent.canExecute(ctx.state)) {
    logger.debug('Skipping agent (preconditions not met)', { agent: agent.name, phase });
    return null;
  }

  const agentSpan = createAppSpan(`evolution.agent.${agent.name}`, {
    agent: agent.name,
    iteration: ctx.state.iteration,
    phase,
  });

  try {
    logger.debug('Executing agent', { agent: agent.name, iteration: ctx.state.iteration, phase });
    const result = await agent.execute(ctx);
    agentSpan.setAttributes({
      success: result.success ? 1 : 0,
      cost_usd: result.costUsd,
      variants_added: result.variantsAdded ?? 0,
    });
    logger.info('Agent completed', {
      agent: agent.name,
      success: result.success,
      costUsd: result.costUsd,
      variantsAdded: result.variantsAdded,
      matchesPlayed: result.matchesPlayed,
    });
    await persistCheckpoint(runId, ctx.state, agent.name, phase, logger);
    return result;
  } catch (error) {
    agentSpan.recordException(error as Error);
    agentSpan.setStatus({ code: 2, message: (error as Error).message });
    await persistCheckpoint(runId, ctx.state, agent.name, phase, logger).catch(() => {});

    if (error instanceof BudgetExceededError) {
      logger.warn('Budget exceeded, pausing run', { agent: agent.name, error: error.message });
      await markRunPaused(runId, error);
      throw error;
    }

    logger.error('Agent failed', { agent: agent.name, error: String(error) });
    await markRunFailed(runId, agent.name, error);
    throw error;
  } finally {
    agentSpan.end();
  }
}

/** Persist checkpoint including supervisor resume state. */
async function persistCheckpointWithSupervisor(
  runId: string,
  state: PipelineState,
  supervisor: PoolSupervisor,
  phase: PipelinePhase,
  logger: EvolutionLogger,
): Promise<void> {
  const checkpoint = {
    run_id: runId,
    iteration: state.iteration,
    phase,
    last_agent: 'iteration_complete',
    state_snapshot: {
      ...serializeState(state),
      supervisorState: supervisor.getResumeState(),
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
    }).eq('id', runId);
  } catch (error) {
    logger.warn('Iteration checkpoint failed', { error: String(error) });
  }
}
