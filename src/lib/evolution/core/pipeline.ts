// Pipeline orchestrator with two modes: minimal (Slice A) and full phase-aware (Slice B).
// Full pipeline uses PoolSupervisor for EXPANSION→COMPETITION phase transitions, checkpoint/resume.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { serializeState } from './state';
import { getOrdinal, ordinalToEloScale, createRating } from './rating';
import { PoolSupervisor, supervisorConfigFromRunConfig } from './supervisor';
import type { SupervisorResumeState, PhaseConfig } from './supervisor';
import type { PipelineState, EvolutionLogger, PipelinePhase, AgentResult, ExecutionContext, EvolutionRunSummary, AgentExecutionDetail } from '../types';
import { BudgetExceededError, BASELINE_STRATEGY, EvolutionRunSummarySchema } from '../types';
import { ComparisonCache } from './comparisonCache';
import { isTransientError } from './errorClassification';
import type { EvolutionFeatureFlags } from './featureFlags';
import { createAppSpan } from '../../../../instrumentation';
import { v4 as uuidv4 } from 'uuid';
import { extractStrategyConfig, hashStrategyConfig, labelStrategyConfig } from './strategyConfig';
import { buildFlowCritiquePrompt, parseFlowCritiqueResponse } from '../flowRubric';
import type { Critique } from '../types';

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
  totalCostUsd?: number,
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
      const [, runUpdate] = await Promise.all([
        supabase.from('evolution_checkpoints').upsert(checkpoint, {
          onConflict: 'run_id,iteration,last_agent',
        }),
        supabase.from('content_evolution_runs').update({
          current_iteration: state.iteration,
          phase,
          last_heartbeat: new Date().toISOString(),
          runner_agents_completed: state.pool.length,
          ...(totalCostUsd != null && { total_cost_usd: totalCostUsd }),
        }).eq('id', runId),
      ]);

      if (runUpdate.error) throw runUpdate.error;
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

/** Mark run as failed in DB. Only transitions from non-terminal states. */
async function markRunFailed(runId: string, agentName: string | null, error: unknown): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  const message = agentName
    ? `Agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`
    : `Pipeline error: ${error instanceof Error ? error.message : String(error)}`;
  await supabase.from('content_evolution_runs').update({
    status: 'failed',
    error_message: message.substring(0, 500),
    completed_at: new Date().toISOString(),
  }).eq('id', runId).in('status', ['pending', 'claimed', 'running']);
}

/** Mark run as paused (budget exceeded). */
async function markRunPaused(runId: string, error: BudgetExceededError): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  await supabase.from('content_evolution_runs').update({
    status: 'paused',
    error_message: error.message,
  }).eq('id', runId);
}

/** Compute the final Elo score from the top-rated variant. Returns null if pool is empty. */
function computeFinalElo(ctx: ExecutionContext): number | null {
  const topVariant = ctx.state.getTopByRating(1)[0];
  if (!topVariant) return null;
  return ordinalToEloScale(getOrdinal(ctx.state.ratings.get(topVariant.id) ?? createRating()));
}

/** Update strategy_configs aggregates via RPC. Logs on failure. */
async function updateStrategyAggregates(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  runId: string,
  strategyId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  const finalElo = computeFinalElo(ctx);
  if (finalElo === null) return;

  const { error } = await supabase.rpc('update_strategy_aggregates', {
    p_strategy_id: strategyId,
    p_cost_usd: ctx.costTracker.getTotalSpent(),
    p_final_elo: finalElo,
  });

  if (error) {
    logger.warn('Failed to update strategy aggregates', { runId, strategyId, error: error.message });
  } else {
    logger.info('Strategy aggregates updated', { runId, strategyId, finalElo });
  }
}

/** Link run to strategy config and update aggregates for Elo optimization dashboard. */
async function linkStrategyConfig(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  const supabase = await createSupabaseServiceClient();

  // If strategy_config_id is already set (pre-selected strategy), just update aggregates.
  const { data: runRow } = await supabase
    .from('content_evolution_runs')
    .select('strategy_config_id')
    .eq('id', runId)
    .single();

  if (runRow?.strategy_config_id) {
    await updateStrategyAggregates(supabase, runId, runRow.strategy_config_id, ctx, logger);
    return;
  }

  const stratConfig = extractStrategyConfig(ctx.payload.config, ctx.payload.config.budgetCaps ?? {});
  const configHash = hashStrategyConfig(stratConfig);

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
    const { data: created, error: createErr } = await supabase
      .from('strategy_configs')
      .insert({
        config_hash: configHash,
        name: `Strategy ${configHash.slice(0, 6)}`,
        label: labelStrategyConfig(stratConfig),
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

  await updateStrategyAggregates(supabase, runId, strategyId, ctx, logger);
}

/** Map a strategy name to its owning agent for cost attribution. */
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

function getAgentForStrategy(strategy: string): string | null {
  const direct = STRATEGY_TO_AGENT[strategy];
  if (direct) return direct;
  if (strategy.startsWith('critique_edit_')) return 'iterativeEditing';
  if (strategy.startsWith('section_decomposition_')) return 'sectionDecomposition';
  return null;
}

/** Validate and persist cost prediction, then refresh agent baselines. Non-fatal on failure. */
async function persistCostPrediction(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  runId: string,
  costEstimateDetail: unknown,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  const { computeCostPrediction, refreshAgentCostBaselines, RunCostEstimateSchema, CostPredictionSchema } = await import('../index');

  const estimateParsed = RunCostEstimateSchema.safeParse(costEstimateDetail);
  if (!estimateParsed.success) {
    logger.warn('cost_estimate_detail failed Zod validation — skipping prediction', {
      runId, errors: estimateParsed.error.issues.map(i => i.message),
    });
    return;
  }

  const prediction = computeCostPrediction(estimateParsed.data, ctx.costTracker.getAllAgentCosts());
  const parsed = CostPredictionSchema.safeParse(prediction);
  if (!parsed.success) {
    logger.warn('Cost prediction failed Zod validation — skipping write', {
      runId, errors: parsed.error.issues.map(i => i.message),
    });
    return;
  }

  const { error: predErr } = await supabase
    .from('content_evolution_runs')
    .update({ cost_prediction: parsed.data })
    .eq('id', runId);
  if (predErr) {
    logger.warn('Failed to persist cost_prediction', { runId, error: predErr.message });
  }

  // Refresh baselines for future estimates (best-effort, non-blocking)
  refreshAgentCostBaselines(30).catch((err: unknown) => {
    logger.warn('refreshAgentCostBaselines failed (non-blocking)', {
      runId, error: err instanceof Error ? err.message : String(err),
    });
  });
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
    const variants = ctx.state.pool.filter((v) => getAgentForStrategy(v.strategy) === agentName);
    if (variants.length === 0) continue;

    const avgElo = variants.reduce((s, v) => s + (ctx.state.ratings.get(v.id)?.mu ?? 25), 0) / variants.length;
    const eloGain = avgElo - 25;
    const eloPerDollar = costUsd > 0 ? eloGain / costUsd : null;

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

  for (const strategy of Object.values(strategyEffectiveness)) {
    strategy.avgOrdinal /= strategy.count;
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

/** Auto-link run to prompt by resolving from config or explanation title. Non-fatal on failure. */
async function autoLinkPrompt(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  try {
    const supabase = await createSupabaseServiceClient();

    const { data: run } = await supabase
      .from('content_evolution_runs')
      .select('prompt_id, config')
      .eq('id', runId)
      .single();

    if (run?.prompt_id) return;

    const configPrompt = (run?.config as Record<string, unknown>)?.prompt;
    if (typeof configPrompt === 'string' && configPrompt.trim()) {
      const topicId = await findTopicByPrompt(supabase, configPrompt.trim());
      if (topicId) {
        await linkPromptToRun(supabase, runId, topicId);
        logger.info('Auto-linked prompt via config JSONB', { runId, promptId: topicId });
        return;
      }
    }

    const { data: bankEntry } = await supabase
      .from('hall_of_fame_entries')
      .select('topic_id')
      .eq('evolution_run_id', runId)
      .limit(1)
      .single();

    if (bankEntry?.topic_id) {
      await linkPromptToRun(supabase, runId, bankEntry.topic_id);
      logger.info('Auto-linked prompt via bank entry', { runId, promptId: bankEntry.topic_id });
      return;
    }

    if (ctx.payload.explanationId) {
      const { data: explanation } = await supabase
        .from('explanations')
        .select('explanation_title')
        .eq('id', ctx.payload.explanationId)
        .single();

      if (explanation?.explanation_title) {
        const topicId = await findTopicByPrompt(supabase, explanation.explanation_title.trim());
        if (topicId) {
          await linkPromptToRun(supabase, runId, topicId);
          logger.info('Auto-linked prompt via explanation title', { runId, promptId: topicId });
          return;
        }
      }
    }

    logger.warn('Could not auto-link prompt_id (no match found)', { runId });
  } catch (error) {
    logger.warn('Auto-link prompt failed (non-fatal)', {
      runId, error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function findTopicByPrompt(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  promptText: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('hall_of_fame_topics')
    .select('id')
    .ilike('prompt', promptText)
    .is('deleted_at', null)
    .single();
  return data?.id ?? null;
}

async function linkPromptToRun(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  runId: string,
  topicId: string,
): Promise<void> {
  await supabase.from('content_evolution_runs')
    .update({ prompt_id: topicId })
    .eq('id', runId);
}

/** Feed top 3 variants into hall_of_fame_entries (hall of fame). Non-fatal on failure. */
async function feedHallOfFame(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  try {
    const supabase = await createSupabaseServiceClient();
    const top3 = ctx.state.getTopByRating(3);
    if (top3.length === 0) {
      logger.info('No variants to feed into hall of fame', { runId });
      return;
    }

    // Resolve topic_id: prefer prompt_id already linked on the run
    const { data: run } = await supabase
      .from('content_evolution_runs')
      .select('prompt_id')
      .eq('id', runId)
      .single();

    let topicId: string | null = run?.prompt_id ?? null;

    // Fallback: resolve topic from explanation title
    if (!topicId && ctx.payload.explanationId) {
      const { data: explanation } = await supabase
        .from('explanations')
        .select('explanation_title')
        .eq('id', ctx.payload.explanationId)
        .single();

      if (explanation?.explanation_title) {
        const trimmed = explanation.explanation_title.trim();
        // Select or insert topic
        const { data: existing } = await supabase
          .from('hall_of_fame_topics')
          .select('id')
          .ilike('prompt', trimmed)
          .is('deleted_at', null)
          .single();

        if (existing) {
          topicId = existing.id;
        } else {
          const { data: created } = await supabase
            .from('hall_of_fame_topics')
            .insert({ prompt: trimmed, title: ctx.payload.title })
            .select('id')
            .single();
          topicId = created?.id ?? null;
        }
      }
    }

    if (!topicId) {
      logger.warn('Cannot feed hall of fame — no topic resolved', { runId });
      return;
    }

    const model = ctx.payload.config.generationModel ?? 'deepseek-chat';
    const runCost = ctx.costTracker.getTotalSpent();
    // Split cost evenly across top 3 for per-entry attribution
    const perEntryCost = runCost / top3.length;

    for (let i = 0; i < top3.length; i++) {
      const variant = top3[i];
      const rank = i + 1;
      const genMethod = rank === 1 ? 'evolution_winner' : 'evolution_top3';

      // Upsert: use evolution_run_id + rank as natural key (unique index)
      const { data: entry, error: entryErr } = await supabase
        .from('hall_of_fame_entries')
        .upsert(
          {
            topic_id: topicId,
            content: variant.text,
            generation_method: genMethod,
            model,
            total_cost_usd: perEntryCost,
            evolution_run_id: runId,
            evolution_variant_id: variant.id,
            rank,
            metadata: {},
          },
          { onConflict: 'evolution_run_id,rank' },
        )
        .select('id')
        .single();

      if (entryErr || !entry) {
        logger.warn('Failed to upsert hall-of-fame entry', {
          runId, rank, error: entryErr?.message,
        });
        continue;
      }

      // Initialize Elo rating (skip if already exists from previous run)
      const eloScore = ordinalToEloScale(
        getOrdinal(ctx.state.ratings.get(variant.id) ?? createRating()),
      );
      await supabase.from('hall_of_fame_elo')
        .upsert(
          {
            topic_id: topicId,
            entry_id: entry.id,
            elo_rating: eloScore,
            match_count: 0,
          },
          { onConflict: 'topic_id,entry_id' },
        );
    }

    logger.info('Hall of fame updated', { runId, topicId, entriesInserted: top3.length });

    // Auto re-rank after insertion (non-fatal). Dynamic import avoids circular deps.
    try {
      const { runHallOfFameComparisonInternal } = await import('@/lib/services/hallOfFameActions');
      const result = await runHallOfFameComparisonInternal(topicId, 'system', 'gpt-4.1-nano', 1);
      if (result.success) {
        logger.info('Auto re-ranking completed', { runId, topicId, ...result.data });
      } else {
        logger.warn('Auto re-ranking failed', { runId, topicId, error: result.error?.message });
      }
    } catch (reRankError) {
      logger.warn('Auto re-ranking threw (non-fatal)', {
        runId, topicId, error: reRankError instanceof Error ? reRankError.message : String(reRankError),
      });
    }
  } catch (error) {
    logger.warn('Feed hall of fame failed (non-fatal)', {
      runId, error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Check if the top variant's latest critique has all dimension scores >= threshold. */
export function qualityThresholdMet(state: PipelineState, threshold: number): boolean {
  if (!state.allCritiques || state.allCritiques.length === 0) return false;
  const topVariant = state.getTopByRating(1)[0];
  if (!topVariant) return false;
  const critique = [...state.allCritiques].reverse().find(c => c.variationId === topVariant.id);
  if (!critique) return false;
  const scores = Object.values(critique.dimensionScores);
  if (scores.length === 0) return false;
  return scores.every(s => s >= threshold);
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

  let minimalExecutionOrder = 0;
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
      await persistAgentInvocation(runId, ctx.state.iteration, agent.name, minimalExecutionOrder++, result, logger);
      await persistCheckpoint(runId, ctx.state, agent.name, 'EXPANSION', logger, 3, ctx.costTracker.getTotalSpent());
    } catch (error) {
      // Save partial progress before handling error
      await persistCheckpoint(runId, ctx.state, agent.name, 'EXPANSION', logger, 3, ctx.costTracker.getTotalSpent()).catch(() => {});

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

        // Single-article quality threshold: stop early when all critique dimensions >= 8
        if (ctx.payload.config.singleArticle && qualityThresholdMet(ctx.state, 8)) {
          logger.info('Stopping pipeline', { reason: 'quality_threshold' });
          stopReason = 'quality_threshold';
          break;
        }

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
            await persistCheckpoint(runId, ctx.state, 'flowCritique', phase, logger, 3, ctx.costTracker.getTotalSpent());
          } catch (error) {
            if (error instanceof BudgetExceededError) {
              logger.warn('Budget exceeded during flow critique', { error: error.message });
              await markRunPaused(runId, error);
              throw error;
            }
            logger.warn('Flow critique pass failed (non-fatal)', { error: String(error) });
          }
        }

        // Feature-flag-gated editing + evolution agents
        executionOrder = await runGatedAgents([
          { configKey: 'runIterativeEditing', agent: agents.iterativeEditing, flagKey: 'iterativeEditingEnabled' },
          { configKey: 'runTreeSearch', agent: agents.treeSearch, flagKey: 'treeSearchEnabled' },
          { configKey: 'runSectionDecomposition', agent: agents.sectionDecomposition, flagKey: 'sectionDecompositionEnabled' },
          { configKey: 'runDebate', agent: agents.debate, flagKey: 'debateEnabled' },
          { configKey: 'runEvolution', agent: agents.evolution, flagKey: 'evolvePoolEnabled' },
        ], config, options.featureFlags, runId, ctx, phase, logger, executionOrder);

        // === Calibration (EXPANSION) or Tournament (COMPETITION) ===
        if (config.runCalibration) {
          const useTournament = phase === 'COMPETITION' && options.featureFlags?.tournamentEnabled !== false;
          const rankingAgent = useTournament ? agents.tournament : agents.calibration;
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
        await persistCheckpointWithSupervisor(runId, ctx.state, supervisor, phase, logger, ctx.costTracker.getTotalSpent());
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

// ─── Agent invocation persistence ────────────────────────────────

const MAX_DETAIL_BYTES = 100_000;

/** Slice known large arrays per detail type to fit within JSONB byte cap. */
export function sliceLargeArrays(detail: AgentExecutionDetail): AgentExecutionDetail {
  switch (detail.detailType) {
    case 'tournament':
      return { ...detail, rounds: detail.rounds.slice(0, 30) };
    case 'calibration':
      return {
        ...detail,
        entrants: detail.entrants.slice(0, 50).map(e => ({
          ...e, matches: e.matches.slice(0, 20),
        })),
      };
    case 'iterativeEditing':
      return { ...detail, cycles: detail.cycles.slice(0, 10) };
    default:
      return detail;
  }
}

/** Cap execution detail JSONB to 100KB via 2-phase truncation. */
export function truncateDetail(detail: AgentExecutionDetail): AgentExecutionDetail {
  const encoded = new TextEncoder().encode(JSON.stringify(detail));
  if (encoded.length <= MAX_DETAIL_BYTES) return detail;

  // Phase 1: Slice known large arrays
  const sliced = sliceLargeArrays(detail);
  const recheck = new TextEncoder().encode(JSON.stringify(sliced));
  if (recheck.length <= MAX_DETAIL_BYTES) {
    return { ...sliced, _truncated: true } as AgentExecutionDetail;
  }

  // Phase 2: Strip to base fields only
  return {
    detailType: detail.detailType,
    totalCost: detail.totalCost,
    _truncated: true,
  } as AgentExecutionDetail;
}

/** Persist a per-agent-per-iteration invocation record. Non-blocking — logs warning on failure. */
export async function persistAgentInvocation(
  runId: string,
  iteration: number,
  agentName: string,
  executionOrder: number,
  result: AgentResult,
  logger: EvolutionLogger,
): Promise<void> {
  try {
    const detail = result.executionDetail
      ? truncateDetail(result.executionDetail)
      : {};
    const supabase = await createSupabaseServiceClient();
    await supabase.from('evolution_agent_invocations').upsert({
      run_id: runId,
      iteration,
      agent_name: agentName,
      execution_order: executionOrder,
      success: result.success,
      cost_usd: result.costUsd,
      skipped: result.skipped ?? false,
      error_message: result.error ?? null,
      execution_detail: detail,
    }, { onConflict: 'run_id,iteration,agent_name' });
  } catch (err) {
    logger.warn('Failed to persist agent invocation', {
      agent: agentName, iteration, error: String(err),
    });
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
      logger.debug('Executing agent', { agent: agent.name, iteration: ctx.state.iteration, phase, attempt });
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
      await persistAgentInvocation(runId, ctx.state.iteration, agent.name, executionOrder, result, logger);
      await persistCheckpoint(runId, ctx.state, agent.name, phase, logger, 3, ctx.costTracker.getTotalSpent());
      return result;
    } catch (error) {
      agentSpan.recordException(error as Error);
      agentSpan.setStatus({ code: 2, message: (error as Error).message });

      if (error instanceof BudgetExceededError) {
        await persistCheckpoint(runId, ctx.state, agent.name, phase, logger, 3, ctx.costTracker.getTotalSpent()).catch(() => {});
        logger.warn('Budget exceeded, pausing run', { agent: agent.name, error: error.message });
        await markRunPaused(runId, error);
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
      await persistCheckpoint(runId, ctx.state, agent.name, phase, logger, 3, ctx.costTracker.getTotalSpent()).catch(() => {});
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
  let critiqued = 0;

  // Critique all variants that don't already have a flow critique this iteration
  const existingFlowIds = new Set(
    (state.allCritiques ?? [])
      .filter((c) => c.scale === '0-5')
      .map((c) => c.variationId),
  );

  const toCritique = state.pool.filter((v) => !existingFlowIds.has(v.id));

  for (const variant of toCritique) {
    try {
      const prompt = buildFlowCritiquePrompt(variant.text);
      const response = await llmClient.complete(prompt, 'flowCritique');
      const result = parseFlowCritiqueResponse(response);

      if (result) {
        const flowCritique: Critique = {
          variationId: variant.id,
          dimensionScores: result.scores,
          goodExamples: {},
          badExamples: Object.fromEntries(
            Object.entries(result.frictionSentences).filter(([, v]) => v.length > 0),
          ),
          notes: {},
          reviewer: 'llm',
          scale: '0-5',
        };

        if (!state.allCritiques) state.allCritiques = [];
        state.allCritiques.push(flowCritique);

        // Write flow scores to dimensionScores with flow: prefix (visible to visualization)
        if (!state.dimensionScores) state.dimensionScores = {};
        if (!state.dimensionScores[variant.id]) state.dimensionScores[variant.id] = {};
        for (const [dim, score] of Object.entries(result.scores)) {
          state.dimensionScores[variant.id][`flow:${dim}`] = score;
        }

        critiqued++;
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      logger.warn('Flow critique failed for variant (non-fatal)', {
        variantId: variant.id,
        error: String(err),
      });
    }
  }

  return { critiqued, costUsd: costTracker.getAgentCost('flowCritique') };
}
