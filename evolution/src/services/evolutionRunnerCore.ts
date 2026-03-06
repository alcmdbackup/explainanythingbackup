// Core evolution runner logic shared by cron route and admin server action.
// Handles claim, resolve content, heartbeat, execute pipeline, and cleanup.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

export interface RunnerOptions {
  runnerId: string;
  maxDurationMs?: number;
  targetRunId?: string;
}

export interface RunnerResult {
  claimed: boolean;
  runId?: string;
  stopReason?: string;
  durationMs?: number;
  error?: string;
}

const DEFAULT_MAX_CONCURRENT_RUNS = 5;

export async function claimAndExecuteEvolutionRun(
  options: RunnerOptions,
): Promise<RunnerResult> {
  const supabase = await createSupabaseServiceClient();
  const startMs = Date.now();
  const maxDurationMs = options.maxDurationMs ?? 740_000;

  const failedResult = async (runId: string, errorMessage: string): Promise<RunnerResult> => {
    await markRunFailed(supabase, runId, errorMessage);
    return { claimed: true, runId, error: errorMessage, durationMs: Date.now() - startMs };
  };

  const maxConcurrent = parseInt(process.env.EVOLUTION_MAX_CONCURRENT_RUNS ?? '', 10) || DEFAULT_MAX_CONCURRENT_RUNS;
  const { count: activeCount, error: countError } = await supabase
    .from('evolution_runs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['claimed', 'running']);

  if (countError) {
    logger.error('Failed to check concurrent run count', { error: countError.message });
    return { claimed: false, error: `Failed to check concurrent runs: ${countError.message}` };
  }

  if ((activeCount ?? 0) >= maxConcurrent) {
    logger.info('Concurrent run limit reached', { activeCount, maxConcurrent });
    return { claimed: false };
  }

  const { data: claimedRows, error: claimError } = await supabase
    .rpc('claim_evolution_run', {
      p_runner_id: options.runnerId,
      ...(options.targetRunId ? { p_run_id: options.targetRunId } : {}),
    });

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
        preparePipelineRun,
        loadCheckpointForResume,
        CheckpointNotFoundError,
        CheckpointCorruptedError,
      } = await import('@evolution/lib');

      let checkpointData;
      try {
        checkpointData = await loadCheckpointForResume(runId);
      } catch (err) {
        if (err instanceof CheckpointNotFoundError || err instanceof CheckpointCorruptedError) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Failed to load checkpoint for resume', { runId, error: msg });
          return failedResult(runId, msg);
        }
        throw err;
      }

      let title = 'Prompt-based run';
      if (claimedRun.explanation_id) {
        const { data: expl } = await supabase
          .from('explanations')
          .select('explanation_title')
          .eq('id', claimedRun.explanation_id)
          .single();
        title = expl?.explanation_title ?? 'Untitled';
      }

      const { ctx, agents, logger: evolutionLogger, supervisorResume } = preparePipelineRun({
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
        maxDurationMs,
        continuationCount: claimedRun.continuation_count,
        resumeAgentNames: checkpointData.resumeAgentNames,
      });

      await cleanupRunner(supabase, runId, stopReason);
      return { claimed: true, runId, stopReason, durationMs: Date.now() - startMs };
    }

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
          return failedResult(runId, `Explanation ${claimedRun.explanation_id} not found`);
        }

        originalText = explanation.content;
        title = explanation.explanation_title;
        explanationId = explanation.id;
      } else if (claimedRun.prompt_id) {
        const { data: topic, error: topicError } = await supabase
          .from('evolution_arena_topics')
          .select('prompt')
          .eq('id', claimedRun.prompt_id)
          .single();

        if (topicError || !topic) {
          return failedResult(runId, `Prompt ${claimedRun.prompt_id} not found`);
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
        return failedResult(runId, 'Run has no explanation_id and no prompt_id');
      }
    } catch (contentResolveError) {
      const msg = contentResolveError instanceof Error ? contentResolveError.message : String(contentResolveError);
      logger.error('Content resolution failed', { runId, error: msg });
      return failedResult(runId, msg);
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
      maxDurationMs,
      continuationCount: 0,
    });

    await cleanupRunner(supabase, runId, stopReason);
    return { claimed: true, runId, stopReason, durationMs: Date.now() - startMs };
  } catch (pipelineError) {
    const msg = pipelineError instanceof Error ? pipelineError.message : String(pipelineError);
    logger.error('Evolution pipeline failed', { runId, error: msg });
    return failedResult(runId, msg);
  } finally {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
  }
}

function startHeartbeat(
  supabase: ServiceClient,
  runId: string,
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      await supabase.from('evolution_runs').update({
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
  await supabase.from('evolution_runs').update({
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
  if (stopReason !== 'continuation_timeout') {
    await supabase.from('evolution_runs').update({
      runner_id: null,
    }).eq('id', runId);
  }

  logger.info('Evolution run finished invocation', { runId, stopReason });
}
