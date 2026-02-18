// Evolution runner cron — picks up pending/continuation_pending runs and executes full pipeline.
// Designed to be called by Vercel cron every 5 minutes. Supports continuation-passing for long runs.

import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { requireCronAuth } from '@/lib/utils/cronAuth';
import { v4 as uuidv4 } from 'uuid';

export const maxDuration = 800; // ~13 minutes — Vercel Pro Fluid Compute max; continuation-passing handles longer runs

const RUNNER_ID = `cron-runner-${uuidv4().slice(0, 8)}`;
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
// Pipeline gets maxDuration minus a buffer for claim/setup/cleanup overhead
const PIPELINE_MAX_DURATION_MS = (maxDuration - 60) * 1000;

export async function GET(request: Request): Promise<NextResponse> {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = await createSupabaseServiceClient();

    // 1. Claim oldest pending or continuation_pending run via atomic RPC (SKIP LOCKED)
    const { data: claimedRows, error: claimError } = await supabase
      .rpc('claim_evolution_run', { p_runner_id: RUNNER_ID });

    if (claimError) {
      logger.error('Evolution runner claim RPC error', { error: claimError.message });
      return NextResponse.json({ error: 'Failed to claim run' }, { status: 500 });
    }

    const claimedRun = claimedRows?.[0];
    if (!claimedRun) {
      return NextResponse.json({
        status: 'ok',
        message: 'No pending runs',
        timestamp: new Date().toISOString(),
      });
    }

    const runId = claimedRun.id;
    const isResume = (claimedRun.continuation_count ?? 0) > 0;
    const startMs = Date.now();
    let heartbeatInterval: NodeJS.Timeout | null = null;

    logger.info('Claimed evolution run', { runId, runnerId: RUNNER_ID, isResume, continuationCount: claimedRun.continuation_count });

    try {
      if (isResume) {
        const {
          executeFullPipeline,
          prepareResumedPipelineRun,
          loadCheckpointForResume,
          CheckpointNotFoundError,
          CheckpointCorruptedError,
        } = await import('@/lib/evolution');

        let checkpointData;
        try {
          checkpointData = await loadCheckpointForResume(runId);
        } catch (err) {
          if (err instanceof CheckpointNotFoundError || err instanceof CheckpointCorruptedError) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger.error('Failed to load checkpoint for resume', { runId, error: errorMsg });
            await markRunFailed(supabase, runId, errorMsg);
            return NextResponse.json({
              status: 'error',
              message: 'Checkpoint load failed',
              runId,
              error: errorMsg,
              timestamp: new Date().toISOString(),
            }, { status: 500 });
          }
          throw err;
        }

        // Resolve title/explanationId from the original run row
        const title = claimedRun.explanation_id
          ? (await supabase.from('explanations').select('explanation_title').eq('id', claimedRun.explanation_id).single()).data?.explanation_title ?? 'Untitled'
          : 'Prompt-based run';

        const { ctx, agents, logger: evolutionLogger, supervisorResume, resumeComparisonCacheEntries } = prepareResumedPipelineRun({
          runId,
          title,
          explanationId: claimedRun.explanation_id,
          configOverrides: claimedRun.config ?? {},
          llmClientId: 'evolution-cron-resume',
          checkpointData,
        });

        heartbeatInterval = startHeartbeat(supabase, runId);

        const { stopReason } = await executeFullPipeline(runId, agents, ctx, evolutionLogger, {
          startMs,
          supervisorResume,
          resumeComparisonCacheEntries,
          maxDurationMs: PIPELINE_MAX_DURATION_MS,
          continuationCount: claimedRun.continuation_count,
        });

        return buildResponse(supabase, runId, stopReason, startMs);
      } else {
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
              return NextResponse.json({
                status: 'error',
                message: 'Explanation not found',
                runId,
                timestamp: new Date().toISOString(),
              }, { status: 404 });
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
              return NextResponse.json({
                status: 'error',
                message: 'Prompt not found',
                runId,
                timestamp: new Date().toISOString(),
              }, { status: 404 });
            }
            const { generateSeedArticle } = await import('@/lib/evolution/core/seedArticle');
            const { createEvolutionLLMClient } = await import('@/lib/evolution');
            const { createCostTracker } = await import('@/lib/evolution/core/costTracker');
            const { createEvolutionLogger } = await import('@/lib/evolution/core/logger');
            const { resolveConfig } = await import('@/lib/evolution/config');

            const seedConfig = resolveConfig(claimedRun.config ?? {});
            const seedCostTracker = createCostTracker(seedConfig);
            const seedLogger = createEvolutionLogger(runId);
            const seedLlmClient = createEvolutionLLMClient('evolution-cron-seed', seedCostTracker, seedLogger);

            const seed = await generateSeedArticle(topic.prompt, seedLlmClient, seedLogger);
            originalText = seed.content;
            title = seed.title;
            explanationId = null;

            logger.info('Generated seed article from prompt', { runId, title, promptId: claimedRun.prompt_id });
          } else {
            await markRunFailed(supabase, runId, 'Run has no explanation_id and no prompt_id');
            return NextResponse.json({
              status: 'error',
              message: 'Run has no explanation_id and no prompt_id',
              runId,
              timestamp: new Date().toISOString(),
            }, { status: 400 });
          }
        } catch (contentResolveError) {
          const errorMsg = contentResolveError instanceof Error ? contentResolveError.message : String(contentResolveError);
          logger.error('Content resolution failed', { runId, error: errorMsg });
          await markRunFailed(supabase, runId, errorMsg);
          return NextResponse.json({
            status: 'error',
            message: 'Content resolution failed',
            runId,
            error: errorMsg,
            timestamp: new Date().toISOString(),
          }, { status: 500 });
        }

        const {
          executeFullPipeline,
          preparePipelineRun,
        } = await import('@/lib/evolution');

        const { ctx, agents } = preparePipelineRun({
          runId,
          originalText,
          title,
          explanationId,
          configOverrides: claimedRun.config ?? {},
          llmClientId: 'evolution-cron',
        });

        heartbeatInterval = startHeartbeat(supabase, runId);

        const { stopReason } = await executeFullPipeline(runId, agents, ctx, ctx.logger, {
          startMs,
          maxDurationMs: PIPELINE_MAX_DURATION_MS,
          continuationCount: 0,
        });

        return buildResponse(supabase, runId, stopReason, startMs);
      }
    } catch (pipelineError) {
      const errorMessage = pipelineError instanceof Error ? pipelineError.message : String(pipelineError);
      logger.error('Evolution pipeline failed', { runId, error: errorMessage });

      await supabase.from('content_evolution_runs').update({
        status: 'failed',
        error_message: errorMessage,
        runner_id: null,
      }).eq('id', runId).in('status', ['running', 'claimed']);

      return NextResponse.json({
        status: 'error',
        message: 'Pipeline execution failed',
        runId,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }, { status: 500 });
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
    }
  } catch (error) {
    logger.error('Evolution runner unexpected error', { error: String(error) });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

function startHeartbeat(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
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
  }, HEARTBEAT_INTERVAL_MS);
}

async function buildResponse(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  runId: string,
  stopReason: string,
  startMs: number,
): Promise<NextResponse> {
  // continuation_timeout means run is NOT terminal — don't clear runner_id (already done by RPC)
  if (stopReason !== 'continuation_timeout') {
    await supabase.from('content_evolution_runs').update({
      runner_id: null,
    }).eq('id', runId);
  }

  logger.info('Evolution run finished invocation', { runId, stopReason, durationMs: Date.now() - startMs });

  return NextResponse.json({
    status: 'ok',
    message: stopReason === 'continuation_timeout' ? 'Run yielded for continuation' : 'Run completed',
    runId,
    stopReason,
    durationMs: Date.now() - startMs,
    timestamp: new Date().toISOString(),
  });
}

async function markRunFailed(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  runId: string,
  errorMessage: string,
): Promise<void> {
  await supabase.from('content_evolution_runs').update({
    status: 'failed',
    error_message: errorMessage,
    runner_id: null,
  }).eq('id', runId).in('status', ['pending', 'claimed', 'running', 'continuation_pending']);
}
