// Core evolution runner logic shared by cron route and admin server action.
// Handles claim→resolve content→heartbeat→execute pipeline→cleanup.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';

// ─── Types ───────────────────────────────────────────────────────

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

export interface RunnerOptions {
  /** Identifier for this runner instance (e.g. 'cron-runner-abc123', 'admin-trigger') */
  runnerId: string;
  /** Max wall-clock time for pipeline execution. Undefined = run to completion. */
  maxDurationMs?: number;
}

export interface RunnerResult {
  /** Whether a pending run was found and claimed */
  claimed: boolean;
  /** The run ID that was claimed and executed */
  runId?: string;
  /** Why the pipeline stopped (e.g. 'completed', 'continuation_timeout', 'budget_exhausted') */
  stopReason?: string;
  /** Total wall-clock time in ms */
  durationMs?: number;
  /** Error message if the run failed */
  error?: string;
}

// ─── Core function ───────────────────────────────────────────────

export async function claimAndExecuteEvolutionRun(
  options: RunnerOptions,
): Promise<RunnerResult> {
  const supabase = await createSupabaseServiceClient();
  const startMs = Date.now();

  // 1. Claim oldest pending or continuation_pending run via atomic RPC (SKIP LOCKED)
  const { data: claimedRows, error: claimError } = await supabase
    .rpc('claim_evolution_run', { p_runner_id: options.runnerId });

  if (claimError) {
    logger.error('Evolution runner claim RPC error', { error: claimError.message, runnerId: options.runnerId });
    return { claimed: false, error: `Failed to claim run: ${claimError.message}` };
  }

  const claimedRun = claimedRows?.[0];
  if (!claimedRun) {
    return { claimed: false };
  }

  const runId = claimedRun.id;
  const isResume = (claimedRun.continuation_count ?? 0) > 0;
  let heartbeatInterval: NodeJS.Timeout | null = null;

  logger.info('Claimed evolution run', { runId, runnerId: options.runnerId, isResume, continuationCount: claimedRun.continuation_count });

  try {
    if (isResume) {
      const {
        executeFullPipeline,
        prepareResumedPipelineRun,
        loadCheckpointForResume,
        CheckpointNotFoundError,
        CheckpointCorruptedError,
      } = await import('@evolution/lib');

      let checkpointData;
      try {
        checkpointData = await loadCheckpointForResume(runId);
      } catch (err) {
        if (err instanceof CheckpointNotFoundError || err instanceof CheckpointCorruptedError) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error('Failed to load checkpoint for resume', { runId, error: errorMsg });
          await markRunFailed(supabase, runId, errorMsg);
          return { claimed: true, runId, error: errorMsg, durationMs: Date.now() - startMs };
        }
        throw err;
      }

      const title = claimedRun.explanation_id
        ? (await supabase.from('explanations').select('explanation_title').eq('id', claimedRun.explanation_id).single()).data?.explanation_title ?? 'Untitled'
        : 'Prompt-based run';

      const { ctx, agents, logger: evolutionLogger, supervisorResume, resumeComparisonCacheEntries } = prepareResumedPipelineRun({
        runId,
        title,
        explanationId: claimedRun.explanation_id,
        configOverrides: claimedRun.config ?? {},
        llmClientId: `${options.runnerId}-resume`,
        checkpointData,
      });

      heartbeatInterval = startHeartbeat(supabase, runId);

      const { stopReason } = await executeFullPipeline(runId, agents, ctx, evolutionLogger, {
        startMs,
        supervisorResume,
        resumeComparisonCacheEntries,
        maxDurationMs: options.maxDurationMs,
        continuationCount: claimedRun.continuation_count,
      });

      await cleanupRunner(supabase, runId, stopReason);
      return { claimed: true, runId, stopReason, durationMs: Date.now() - startMs };
    }

    // Fresh run — resolve content
    let originalText: string;
    let title: string;
    let explanationId: number | null = claimedRun.explanation_id;

    try {
      if (claimedRun.explanation_id !== null) {
        const { data: explanation, error: contentError } = await supabase
          .from('explanations')
          .select('id, explanation_title, content')
          .eq('id', claimedRun.explanation_id)
          .single();

        if (contentError || !explanation) {
          await markRunFailed(supabase, runId, `Explanation ${claimedRun.explanation_id} not found`);
          return { claimed: true, runId, error: `Explanation ${claimedRun.explanation_id} not found`, durationMs: Date.now() - startMs };
        }

        originalText = explanation.content;
        title = explanation.explanation_title;
        explanationId = explanation.id;
      } else if (claimedRun.prompt_id) {
        const { data: topic, error: topicError } = await supabase
          .from('hall_of_fame_topics')
          .select('prompt')
          .eq('id', claimedRun.prompt_id)
          .single();

        if (topicError || !topic) {
          await markRunFailed(supabase, runId, `Prompt ${claimedRun.prompt_id} not found`);
          return { claimed: true, runId, error: `Prompt ${claimedRun.prompt_id} not found`, durationMs: Date.now() - startMs };
        }

        const { generateSeedArticle } = await import('@evolution/lib/core/seedArticle');
        const { createEvolutionLLMClient } = await import('@evolution/lib');
        const { createCostTracker } = await import('@evolution/lib/core/costTracker');
        const { createEvolutionLogger } = await import('@evolution/lib/core/logger');
        const { resolveConfig } = await import('@evolution/lib/config');

        const seedConfig = resolveConfig(claimedRun.config ?? {});
        const seedCostTracker = createCostTracker(seedConfig);
        const seedLogger = createEvolutionLogger(runId);
        const seedLlmClient = createEvolutionLLMClient(seedCostTracker, seedLogger);

        const seed = await generateSeedArticle(topic.prompt, seedLlmClient, seedLogger);
        originalText = seed.content;
        title = seed.title;
        explanationId = null;

        logger.info('Generated seed article from prompt', { runId, title, promptId: claimedRun.prompt_id });
      } else {
        await markRunFailed(supabase, runId, 'Run has no explanation_id and no prompt_id');
        return { claimed: true, runId, error: 'Run has no explanation_id and no prompt_id', durationMs: Date.now() - startMs };
      }
    } catch (contentResolveError) {
      const errorMsg = contentResolveError instanceof Error ? contentResolveError.message : String(contentResolveError);
      logger.error('Content resolution failed', { runId, error: errorMsg });
      await markRunFailed(supabase, runId, errorMsg);
      return { claimed: true, runId, error: errorMsg, durationMs: Date.now() - startMs };
    }

    const { executeFullPipeline, preparePipelineRun } = await import('@evolution/lib');

    const { ctx, agents } = preparePipelineRun({
      runId,
      originalText,
      title,
      explanationId,
      configOverrides: claimedRun.config ?? {},
      llmClientId: options.runnerId,
    });

    heartbeatInterval = startHeartbeat(supabase, runId);

    const { stopReason } = await executeFullPipeline(runId, agents, ctx, ctx.logger, {
      startMs,
      maxDurationMs: options.maxDurationMs,
      continuationCount: 0,
    });

    await cleanupRunner(supabase, runId, stopReason);
    return { claimed: true, runId, stopReason, durationMs: Date.now() - startMs };
  } catch (pipelineError) {
    const errorMessage = pipelineError instanceof Error ? pipelineError.message : String(pipelineError);
    logger.error('Evolution pipeline failed', { runId, error: errorMessage });

    await supabase.from('content_evolution_runs').update({
      status: 'failed',
      error_message: errorMessage,
      runner_id: null,
    }).eq('id', runId).in('status', ['running', 'claimed']);

    return { claimed: true, runId, error: errorMessage, durationMs: Date.now() - startMs };
  } finally {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function startHeartbeat(
  supabase: ServiceClient,
  runId: string,
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      await supabase.from('content_evolution_runs').update({
        last_heartbeat: new Date().toISOString(),
      }).eq('id', runId);
    } catch (err) {
      logger.warn('Heartbeat update failed', { runId, error: String(err) });
    }
  }, 30_000);
}

async function markRunFailed(
  supabase: ServiceClient,
  runId: string,
  errorMessage: string,
): Promise<void> {
  await supabase.from('content_evolution_runs').update({
    status: 'failed',
    error_message: errorMessage,
    runner_id: null,
  }).eq('id', runId).in('status', ['pending', 'claimed', 'running', 'continuation_pending']);
}

async function cleanupRunner(
  supabase: ServiceClient,
  runId: string,
  stopReason: string,
): Promise<void> {
  // continuation_timeout means run is NOT terminal — runner_id already cleared by RPC
  if (stopReason !== 'continuation_timeout') {
    await supabase.from('content_evolution_runs').update({
      runner_id: null,
    }).eq('id', runId);
  }

  logger.info('Evolution run finished invocation', { runId, stopReason });
}
