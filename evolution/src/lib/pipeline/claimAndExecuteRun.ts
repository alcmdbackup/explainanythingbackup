// Thin orchestrator: claim a pending run, build context, run pipeline, persist results.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { callLLM } from '@/lib/services/llms';
import { allowedLLMModelSchema } from '@/lib/schemas/schemas';
import { buildRunContext, type ClaimedRun } from './setup/buildRunContext';
import { evolveArticle } from './loop/runIterationLoop';
import { finalizeRun, syncToArena } from './finalize/persistRunResults';
import { classifyError } from './classifyError';
import type { AgentName } from '../core/agentNames';
import { writeMetricMax } from '../metrics/writeMetrics';
import { CreateSeedArticleAgent } from '../core/agents/createSeedArticle';
import { deepCloneRatings } from '../core/agents/generateFromSeedArticle';
import { createCostTracker } from './infra/trackBudget';
import { createEvolutionLLMClient } from './infra/createEvolutionLLMClient';
import { deriveSeed } from '../shared/seededRandom';
import { createRating, ratingToDb } from '../shared/computeRatings';
import type { AgentContext } from '../core/types';
import { evolutionVariantInsertSchema } from '../schemas';

export type { ClaimedRun } from './setup/buildRunContext';

/** System UUID for evolution pipeline LLM calls (llmCallTracking.userid is uuid NOT NULL). */
const EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001';

const DEFAULT_MAX_CONCURRENT_RUNS = 5;

// ─── Types ───────────────────────────────────────────────────────

export interface RunnerOptions {
  runnerId: string;
  maxDurationMs?: number;
  targetRunId?: string;
  /** Optional external Supabase client (e.g. for multi-DB batch runners). Falls back to createSupabaseServiceClient(). */
  db?: SupabaseClient;
  /** If true, claim the run but return immediately without executing the pipeline. */
  dryRun?: boolean;
  /** Optional AbortSignal for external shutdown (e.g. SIGTERM). */
  signal?: AbortSignal;
}

export interface RunnerResult {
  claimed: boolean;
  runId?: string;
  stopReason?: string;
  durationMs?: number;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function startHeartbeat(db: SupabaseClient, runId: string, runnerId: string): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const { data } = await db
        .from('evolution_runs')
        .update({ last_heartbeat: new Date().toISOString() })
        .eq('id', runId)
        .eq('runner_id', runnerId)
        .select('id');
      if (!data || data.length === 0) {
        logger.warn('Heartbeat skipped: runner_id mismatch (run may have been re-claimed)', { runId, runnerId });
      }
    } catch (err) {
      logger.warn('Heartbeat update failed', { runId, error: String(err) });
    }
  }, 30_000);
}

async function markRunFailed(
  db: SupabaseClient,
  runId: string,
  errorMessage: string,
  errorCode?: string,
  errorDetails?: Record<string, unknown>,
): Promise<void> {
  const truncated = errorMessage.slice(0, 2000);
  try {
    // Conditional WHERE error_code IS NULL to prove race-freedom: if persistRunResults
    // already wrote an error_code, this UPDATE is a no-op rather than overwriting it.
    await db
      .from('evolution_runs')
      .update({
        status: 'failed',
        error_message: truncated,
        error_code: errorCode ?? 'unhandled_error',
        ...(errorDetails ? { error_details: errorDetails } : {}),
        completed_at: new Date().toISOString(),
        runner_id: null,
      })
      .eq('id', runId)
      .in('status', ['pending', 'claimed', 'running'])
      .is('error_code', null);
  } catch (err) {
    logger.error(`Failed to mark run ${runId} as failed`, { error: String(err) });
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Claim a pending evolution run from the queue and execute it end-to-end.
 * Handles: concurrent limits → claim → heartbeat → setup → pipeline → finalize → cleanup.
 */
export async function claimAndExecuteRun(
  options: RunnerOptions,
): Promise<RunnerResult> {
  const supabase = options.db ?? await createSupabaseServiceClient();
  const startMs = Date.now();
  const deadlineMs = options.maxDurationMs && options.maxDurationMs > 0
    ? startMs + options.maxDurationMs
    : undefined;

  // Claim a run (concurrent limit enforced server-side via advisory lock in RPC)
  const maxConcurrent = parseInt(process.env.EVOLUTION_MAX_CONCURRENT_RUNS ?? '', 10) || DEFAULT_MAX_CONCURRENT_RUNS;
  const { data: claimedRows, error: claimError } = await supabase
    .rpc('claim_evolution_run', {
      p_runner_id: options.runnerId,
      p_max_concurrent: maxConcurrent,
      ...(options.targetRunId ? { p_run_id: options.targetRunId } : {}),
    });

  if (claimError) {
    logger.error('Evolution runner claim RPC error', { error: claimError.message, runnerId: options.runnerId });
    return { claimed: false, error: `Failed to claim run: ${claimError.message}` };
  }

  // Validate RPC response shape instead of unsafe `as unknown as` cast
  const rows = Array.isArray(claimedRows) ? claimedRows : [];
  const claimedRow = rows[0] as Record<string, unknown> | undefined;
  if (!claimedRow || typeof claimedRow.id !== 'string' || typeof claimedRow.strategy_id !== 'string') {
    if (claimedRow) {
      logger.error('Evolution runner claim RPC returned invalid row shape', {
        runnerId: options.runnerId,
        keys: Object.keys(claimedRow),
      });
    }
    return { claimed: false };
  }

  const runId = claimedRow.id;
  const rawBudget = Number(claimedRow.budget_cap_usd);
  const claimedRun: ClaimedRun = {
    id: runId,
    explanation_id: (claimedRow.explanation_id as number | null) ?? null,
    prompt_id: (claimedRow.prompt_id as string | null) ?? null,
    experiment_id: (claimedRow.experiment_id as string | null) ?? null,
    strategy_id: claimedRow.strategy_id,
    budget_cap_usd: Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : 1.0,
  };

  logger.info('Claimed evolution run', { runId, runnerId: options.runnerId });

  if (options.dryRun) {
    await supabase.from('evolution_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: 'dry-run: no execution performed',
    }).eq('id', runId);
    return { claimed: true, runId, stopReason: 'dry-run', durationMs: Date.now() - startMs };
  }

  let heartbeatInterval: NodeJS.Timeout | null = null;

  try {
    const llmProvider: LLMProvider = {
      async complete(
        prompt: string,
        label: AgentName,
        opts?: { model?: string; temperature?: number; reasoningEffort?: 'none' | 'low' | 'medium' | 'high' },
      ): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number } }> {
        let capturedUsage: { promptTokens: number; completionTokens: number; reasoningTokens?: number } | null = null;
        const text = await callLLM(
          prompt,
          `evolution_${label}`,
          EVOLUTION_SYSTEM_USERID,
          allowedLLMModelSchema.parse(opts?.model ?? 'deepseek-chat'),
          false,
          null,
          null,
          null,
          false,
          {
            temperature: opts?.temperature,
            reasoningEffort: opts?.reasoningEffort,
            onUsage: (u) => {
              capturedUsage = {
                promptTokens: u.promptTokens,
                completionTokens: u.completionTokens,
                reasoningTokens: u.reasoningTokens > 0 ? u.reasoningTokens : undefined,
              };
            },
          },
        );
        // onUsage fires inside saveTrackingAndNotify which is awaited by the LLM call path,
        // so capturedUsage is populated by the time callLLM returns. Fallback to zeros if
        // somehow absent (keeps downstream code safe; Phase 2 will treat missing as "skip token path").
        const usage = capturedUsage ?? { promptTokens: 0, completionTokens: 0 };
        return { text, usage };
      },
    };

    heartbeatInterval = startHeartbeat(supabase, runId, options.runnerId);

    const pipelineResult = await executePipeline(runId, claimedRun, supabase, llmProvider, startMs, options.runnerId, deadlineMs, options.signal);
    return { claimed: true, runId, stopReason: pipelineResult.stopReason, durationMs: Date.now() - startMs };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const code = classifyError(error);
    const details: Record<string, unknown> = error instanceof Error && error.stack
      ? { stack: error.stack.slice(0, 1000) }
      : {};
    logger.error('Evolution pipeline failed', { runId, error: msg, errorCode: code });
    await markRunFailed(supabase, runId, msg, code, details);
    return { claimed: true, runId, error: msg.slice(0, 2000), durationMs: Date.now() - startMs };
  } finally {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
  }
}

// ─── Shared execution logic ──────────────────────────────────────

interface LLMProvider {
  complete(
    prompt: string,
    label: AgentName,
    opts?: { model?: string; temperature?: number; reasoningEffort?: 'none' | 'low' | 'medium' | 'high' },
  ): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number } }>;
}

/** Build context, run evolution loop, finalize, sync arena. Re-throws on failure. */
async function executePipeline(
  runId: string,
  claimedRun: ClaimedRun,
  db: SupabaseClient,
  llmProvider: LLMProvider,
  startMs: number,
  runnerId: string,
  deadlineMs?: number,
  signal?: AbortSignal,
): Promise<{ stopReason: string }> {
  await db
    .from('evolution_runs')
    .update({ status: 'running' })
    .eq('id', runId);

  // Ensure cost metric rows exist even for runs that fail before any LLM call.
  // GREATEST upsert means these zeros never overwrite real values written later.
  // Per supabase/migrations/20260323000002_fix_stale_claim_expiry.sql, runs with
  // stale heartbeats become status='failed' and are never re-claimed, so each runId
  // corresponds to exactly one execution attempt — no reset/DELETE needed.
  for (const metricName of ['cost', 'generation_cost', 'ranking_cost', 'seed_cost'] as const) {
    try {
      await writeMetricMax(db, 'run', runId, metricName, 0, 'during_execution');
    } catch (e) {
      logger.warn('Cost metric zero-init failed (non-fatal)', {
        runId, metricName, err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const contextResult = await buildRunContext(runId, claimedRun, db, llmProvider);
  if ('error' in contextResult) {
    await markRunFailed(db, runId, contextResult.error);
    throw new Error(contextResult.error);
  }

  const { originalText, config, logger: runLogger, initialPool, randomSeed, seedPrompt, seedVariantRow } = contextResult.context;
  runLogger.info('Run context built', {
    initialPoolSize: initialPool.length, phaseName: 'setup', randomSeed: randomSeed.toString(),
    seeded: !!seedPrompt, reusedSeedId: seedVariantRow?.id,
  });

  // Pre-iteration seed generation: when seedPrompt is set and no existing seed content,
  // run CreateSeedArticleAgent here (before the iteration loop) and persist the seed variant.
  let resolvedOriginalText = originalText ?? '';
  let seedVariantId: string | undefined;

  if (seedPrompt && !originalText) {
    const costTracker = createCostTracker(config.budgetUsd);
    const llm = createEvolutionLLMClient(llmProvider, costTracker, config.generationModel, runLogger, db, runId, config.generationTemperature);
    const seedCtx: AgentContext = {
      db, runId, iteration: 0,
      executionOrder: 0,
      invocationId: '',
      randomSeed: deriveSeed(randomSeed, 'pre_iter', 'seed0'),
      logger: runLogger, costTracker, config,
    };
    const seedAgent = new CreateSeedArticleAgent();
    const seedResult = await seedAgent.run({
      promptText: seedPrompt,
      llm,
      initialPool: [...initialPool],
      initialRatings: deepCloneRatings(new Map(initialPool.map((v) => [v.id, createRating()]))),
      initialMatchCounts: new Map<string, number>(),
      cache: new Map(),
    }, seedCtx);

    if (!seedResult.success || !seedResult.result?.variant || !seedResult.result.surfaced) {
      runLogger.warn('Seed agent failed or variant discarded — marking run failed', {
        phaseName: 'seed_generation',
        success: seedResult.success,
        budgetExceeded: seedResult.budgetExceeded,
      });
      await markRunFailed(db, runId, 'Seed generation failed');
      throw new Error('Seed generation failed');
    }

    const seedVariant = seedResult.result.variant;
    resolvedOriginalText = seedVariant.text;
    seedVariantId = seedVariant.id;

    // Persist the seed to evolution_variants with synced_to_arena=true, generation_method='seed'
    const seedRating = ratingToDb(createRating());
    const seedRow = evolutionVariantInsertSchema.parse({
      id: seedVariant.id,
      run_id: runId,
      explanation_id: claimedRun.explanation_id ?? null,
      variant_content: seedVariant.text,
      elo_score: seedRating.elo_score,
      mu: seedRating.mu,
      sigma: seedRating.sigma,
      generation: 0,
      parent_variant_id: null,
      agent_name: 'seed_variant',
      match_count: 0,
      is_winner: false,
      prompt_id: claimedRun.prompt_id ?? null,
      persisted: true,
    });
    const { error: seedInsertError } = await db
      .from('evolution_variants')
      .upsert({ ...seedRow, synced_to_arena: true, generation_method: 'seed' }, { onConflict: 'id' });
    if (seedInsertError) {
      runLogger.warn('Seed variant persist failed (non-fatal)', {
        phaseName: 'seed_generation', error: seedInsertError.message.slice(0, 500),
      });
    }

    runLogger.info('Seed variant generated and persisted in pre-iteration setup', {
      seedVariantId: seedVariant.id, textLength: seedVariant.text.length,
      phaseName: 'seed_generation',
    });
  } else if (seedVariantRow) {
    // Existing seed content from arena — use its ID for parentIds tracking
    seedVariantId = seedVariantRow.id;
  }

  runLogger.info('Starting evolution loop', {
    iterationCount: config.iterationConfigs.length, budgetUsd: config.budgetUsd,
    generationModel: config.generationModel, judgeModel: config.judgeModel,
    phaseName: 'loop',
  });
  const result = await evolveArticle(resolvedOriginalText, llmProvider, db, runId, config, {
    logger: runLogger,
    initialPool: initialPool.length > 0 ? initialPool : undefined,
    experimentId: claimedRun.experiment_id ?? undefined,
    strategyId: claimedRun.strategy_id,
    deadlineMs,
    signal,
    randomSeed,
    seedVariantId,
  });
  runLogger.info('Evolution loop completed', {
    stopReason: result.stopReason, iterations: result.iterationsRun,
    cost: result.totalCost, poolSize: result.pool.length, phaseName: 'loop',
  });

  const durationSeconds = (Date.now() - startMs) / 1000;
  await finalizeRun(runId, result, {
    experiment_id: claimedRun.experiment_id,
    explanation_id: claimedRun.explanation_id,
    strategy_id: claimedRun.strategy_id,
    prompt_id: claimedRun.prompt_id ?? null,
  }, db, durationSeconds, runLogger, runnerId);
  runLogger.info('Finalization completed', { phaseName: 'finalize' });

  if (claimedRun.prompt_id) {
    try {
      await syncToArena(
        runId, claimedRun.prompt_id, result.pool, result.ratings, result.matchHistory,
        db, !!seedVariantId, runLogger,
      );
    } catch (err) {
      runLogger.warn('Arena sync failed', { phaseName: 'arena', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    }
  }

  logger.info(`Run ${runId} completed`, { stopReason: result.stopReason, iterations: result.iterationsRun, cost: result.totalCost.toFixed(4) });

  return { stopReason: result.stopReason };
}
