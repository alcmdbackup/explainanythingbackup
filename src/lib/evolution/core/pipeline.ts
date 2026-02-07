// Pipeline orchestrator with two modes: minimal (Slice A) and full phase-aware (Slice B).
// Full pipeline uses PoolSupervisor for EXPANSION→COMPETITION phase transitions, checkpoint/resume.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { serializeState } from './state';
import { getOrdinal, ordinalToEloScale, createRating } from './rating';
import { PoolSupervisor, supervisorConfigFromRunConfig } from './supervisor';
import type { SupervisorResumeState } from './supervisor';
import type { PipelineState, EvolutionLogger, PipelinePhase, AgentResult, ExecutionContext, EvolutionRunSummary } from '../types';
import { BudgetExceededError, BASELINE_STRATEGY, EvolutionRunSummarySchema } from '../types';
import { ComparisonCache } from './comparisonCache';
import type { EvolutionFeatureFlags } from './featureFlags';
import { createAppSpan } from '../../../../instrumentation';
import { v4 as uuidv4 } from 'uuid';
import { extractStrategyConfig, hashStrategyConfig, labelStrategyConfig } from './strategyConfig';

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

/** Persist all pool variants to content_evolution_variants. Best-effort — errors are logged, not thrown. */
async function persistVariants(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  const topVariant = ctx.state.getTopByRating(1)[0];

  const rows = ctx.state.pool.map((v) => ({
    id: v.id,
    run_id: runId,
    explanation_id: ctx.payload.explanationId || null,
    variant_content: v.text,
    elo_score: ordinalToEloScale(getOrdinal(ctx.state.ratings.get(v.id) ?? createRating())),
    generation: v.version,
    parent_variant_id: v.parentIds.length > 0 ? v.parentIds[0] : null,
    agent_name: v.strategy,
    match_count: ctx.state.matchCounts.get(v.id) ?? 0,
    is_winner: topVariant ? v.id === topVariant.id : false,
  }));

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('content_evolution_variants')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    logger.warn('Failed to persist variants (non-fatal)', { runId, error: error.message });
  } else {
    logger.info('Variants persisted', { runId, count: rows.length });
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

/** Link run to strategy config and update aggregates for Elo optimization dashboard. */
async function linkStrategyConfig(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  const supabase = await createSupabaseServiceClient();

  // Extract strategy config from run config
  const defaultBudgetCaps = ctx.payload.config.budgetCaps ?? {};
  const stratConfig = extractStrategyConfig(ctx.payload.config, defaultBudgetCaps);
  const configHash = hashStrategyConfig(stratConfig);
  const label = labelStrategyConfig(stratConfig);

  // Get or create strategy_configs entry
  const { data: existing } = await supabase
    .from('strategy_configs')
    .select('id')
    .eq('config_hash', configHash)
    .single();

  let strategyId: string;
  if (existing) {
    strategyId = existing.id;
  } else {
    // Create new strategy entry
    const { data: created, error: createErr } = await supabase
      .from('strategy_configs')
      .insert({
        config_hash: configHash,
        name: `Strategy ${configHash.slice(0, 6)}`,
        label,
        config: stratConfig,
      })
      .select('id')
      .single();

    if (createErr || !created) {
      logger.warn('Failed to create strategy config', { runId, error: createErr?.message });
      return;
    }
    strategyId = created.id;
  }

  // Link run to strategy
  const { error: linkErr } = await supabase
    .from('content_evolution_runs')
    .update({ strategy_config_id: strategyId })
    .eq('id', runId);

  if (linkErr) {
    logger.warn('Failed to link run to strategy config', { runId, strategyId, error: linkErr.message });
    return;
  }

  // Get final Elo from top variant
  const topVariant = ctx.state.getTopByRating(1)[0];
  const finalElo = topVariant
    ? ordinalToEloScale(getOrdinal(ctx.state.ratings.get(topVariant.id) ?? createRating()))
    : null;
  const totalCost = ctx.costTracker.getTotalSpent();

  // Update strategy aggregates via RPC
  if (finalElo !== null) {
    const { error: aggErr } = await supabase.rpc('update_strategy_aggregates', {
      p_strategy_id: strategyId,
      p_cost_usd: totalCost,
      p_final_elo: finalElo,
    });

    if (aggErr) {
      logger.warn('Failed to update strategy aggregates', { runId, strategyId, error: aggErr.message });
    } else {
      logger.info('Strategy config linked and aggregates updated', { runId, strategyId, finalElo });
    }
  }
}

/** Strategy-to-agent mapping for cost attribution. */
const STRATEGY_TO_AGENT: Record<string, string> = {
  structural_transform: 'generation',
  lexical_simplify: 'generation',
  grounding_enhance: 'generation',
  mutate_clarity: 'evolution',
  mutate_structure: 'evolution',
  crossover: 'evolution',
  creative_exploration: 'evolution',
  debate_synthesis: 'debate',
  original_baseline: 'original',
  outline_generation: 'outlineGeneration',
  mutate_outline: 'outlineGeneration',
};

/** Map a strategy name to its agent, handling dynamic patterns. */
function getAgentForStrategy(strategy: string): string | null {
  if (STRATEGY_TO_AGENT[strategy]) return STRATEGY_TO_AGENT[strategy];
  if (strategy.startsWith('critique_edit_')) return 'iterativeEditing';
  if (strategy.startsWith('section_decomposition_')) return 'sectionDecomposition';
  return null;
}

/** Persist per-agent cost metrics for Elo/dollar optimization analysis. */
async function persistAgentMetrics(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  const agentCosts = ctx.costTracker.getAllAgentCosts();

  for (const [agentName, costUsd] of Object.entries(agentCosts)) {
    // Find variants produced by this agent
    const variants = ctx.state.pool.filter((v) => getAgentForStrategy(v.strategy) === agentName);
    // Use mu (mean) from OpenSkill rating as the Elo equivalent
    const avgElo = variants.length > 0
      ? variants.reduce((s, v) => s + (ctx.state.ratings.get(v.id)?.mu ?? 25), 0) / variants.length
      : null;
    // OpenSkill default mu is 25 (not 1200 like traditional Elo)
    const eloGain = avgElo ? avgElo - 25 : null;
    const eloPerDollar = eloGain && costUsd > 0 ? eloGain / costUsd : null;

    const { error } = await supabase.from('evolution_run_agent_metrics').upsert({
      run_id: runId,
      agent_name: agentName,
      cost_usd: costUsd,
      variants_generated: variants.length,
      avg_elo: avgElo,
      elo_gain: eloGain,
      elo_per_dollar: eloPerDollar,
    }, { onConflict: 'run_id,agent_name' });

    if (error) {
      logger.warn(`Failed to persist agent metrics for ${agentName}`, { runId, error: error.message });
    }
  }

  logger.info('Agent metrics persisted', { runId, agentCount: Object.keys(agentCosts).length });
}

/** Insert the original text as a baseline variant for rating comparison. Idempotent via BASELINE_STRATEGY check. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function insertBaselineVariant(state: PipelineState, runId: string): void {
  // Check if baseline already exists by strategy (not by ID prefix)
  const existingBaseline = state.pool.find(v => v.strategy === BASELINE_STRATEGY);
  if (existingBaseline) return;

  // Use proper UUID for database compatibility
  const baselineId = uuidv4();
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
  const avgConfidence = matches.length > 0
    ? matches.reduce((s, m) => s + m.confidence, 0) / matches.length : 0;
  const decisiveRate = matches.length > 0
    ? matches.filter((m) => m.confidence >= 0.7).length / matches.length : 0;

  const strategyEffectiveness: Record<string, { count: number; avgOrdinal: number }> = {};
  for (const v of state.pool) {
    const ord = getOrdinal(state.ratings.get(v.id) ?? createRating());
    if (!strategyEffectiveness[v.strategy]) {
      strategyEffectiveness[v.strategy] = { count: 0, avgOrdinal: 0 };
    }
    strategyEffectiveness[v.strategy].count++;
    strategyEffectiveness[v.strategy].avgOrdinal += ord;
  }
  for (const s of Object.values(strategyEffectiveness)) {
    s.avgOrdinal = s.avgOrdinal / s.count;
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

/** Shared post-completion: persist run summary, variants, agent metrics, and strategy config. */
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

  // Link run to strategy config for Elo optimization dashboard
  await linkStrategyConfig(runId, ctx, logger);
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
      supervisor.ordinalHistory = r.ordinalHistory ?? [];
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

        // === Outline Generation (COMPETITION only — optional) ===
        if (config.runOutlineGeneration && agents.outlineGeneration) {
          if (options.featureFlags?.outlineGenerationEnabled === false) {
            logger.info('Outline generation agent disabled by feature flag', { iteration: ctx.state.iteration });
          } else {
            await runAgent(runId, agents.outlineGeneration, ctx, phase, logger);
          }
        }

        // === Reflection (Slice C — optional) ===
        if (config.runReflection && agents.reflection) {
          await runAgent(runId, agents.reflection, ctx, phase, logger);
        }

        // === Iterative Editing (COMPETITION only — optional) ===
        if (config.runIterativeEditing && agents.iterativeEditing) {
          if (options.featureFlags?.iterativeEditingEnabled === false) {
            logger.info('Iterative editing agent disabled by feature flag', { iteration: ctx.state.iteration });
          } else {
            await runAgent(runId, agents.iterativeEditing, ctx, phase, logger);
          }
        }

        // === Tree Search (COMPETITION only — optional) ===
        if (config.runTreeSearch && agents.treeSearch) {
          if (options.featureFlags?.treeSearchEnabled === false) {
            logger.info('Tree search agent disabled by feature flag', { iteration: ctx.state.iteration });
          } else {
            await runAgent(runId, agents.treeSearch, ctx, phase, logger);
          }
        }

        // === Section Decomposition (COMPETITION only — optional) ===
        if (config.runSectionDecomposition && agents.sectionDecomposition) {
          if (options.featureFlags?.sectionDecompositionEnabled === false) {
            logger.info('Section decomposition agent disabled by feature flag', { iteration: ctx.state.iteration });
          } else {
            await runAgent(runId, agents.sectionDecomposition, ctx, phase, logger);
          }
        }

        // === Debate (COMPETITION only — optional) ===
        if (config.runDebate && agents.debate) {
          if (options.featureFlags?.debateEnabled === false) {
            logger.info('Debate agent disabled by feature flag', { iteration: ctx.state.iteration });
          } else {
            await runAgent(runId, agents.debate, ctx, phase, logger);
          }
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
        const top = ctx.state.getTopByRating(3);
        for (const v of top) {
          const ord = getOrdinal(ctx.state.ratings.get(v.id) ?? createRating());
          logger.debug('Top variant', { id: v.id, ordinal: ord.toFixed(1), strategy: v.strategy });
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
      variants_generated: ctx.state.getPoolSize(),
      total_cost_usd: totalCost,
      error_message: stopReason === 'completed' ? null : stopReason,
    }).eq('id', runId);

    // Persist summary, variants, agent metrics, and strategy config
    const durationSeconds = (Date.now() - (options.startMs ?? Date.now())) / 1000;
    await finalizePipelineRun(runId, ctx, logger, stopReason, durationSeconds, supervisor);

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
