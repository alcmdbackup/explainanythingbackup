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
    // V2: No resume path (V1 checkpointing removed). All runs use V2 pipeline.
    if (isResume) {
      return failedResult(runId, 'V1 checkpoint resume is no longer supported in V2');
    }

    // V2 routing: use executeV2Run from V2 module
    const { executeV2Run } = await import('@evolution/lib/v2');
    const { createEvolutionLLMClient } = await import('@evolution/lib');
    const { createCostTracker } = await import('@evolution/lib/core/costTracker');
    const { createEvolutionLogger } = await import('@evolution/lib/core/logger');

    const budgetUsd = Number(claimedRun.budget_cap_usd) || 1.0;
    const costTracker = createCostTracker({ budgetUsd });
    const evolutionLogger = createEvolutionLogger(runId);
    const llmClient = createEvolutionLLMClient(costTracker, evolutionLogger);

    const llmProvider = {
      async complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> {
        return llmClient.complete(prompt, label, opts as Parameters<typeof llmClient.complete>[2]);
      },
    };

    heartbeatInterval = startHeartbeat(supabase, runId);

    await executeV2Run(runId, {
      id: runId,
      explanation_id: claimedRun.explanation_id ?? null,
      prompt_id: claimedRun.prompt_id ?? null,
      experiment_id: claimedRun.experiment_id ?? null,
      strategy_config_id: claimedRun.strategy_config_id,
      budget_cap_usd: budgetUsd,
    }, supabase, llmProvider);

    return { claimed: true, runId, stopReason: 'completed', durationMs: Date.now() - startMs };
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
