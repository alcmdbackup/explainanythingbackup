// Core evolution runner logic shared by cron route and admin server action.
// Handles claim, resolve content, heartbeat, execute pipeline, and cleanup.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { callLLM } from '@/lib/services/llms';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';

/** System UUID for evolution pipeline LLM calls (llmCallTracking.userid is uuid NOT NULL). */
const EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001';

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
  let heartbeatInterval: NodeJS.Timeout | null = null;

  logger.info('Claimed evolution run', { runId, runnerId: options.runnerId });

  try {
    const { executeV2Run } = await import('@evolution/lib/pipeline');

    const budgetUsd = Number(claimedRun.budget_cap_usd) || 1.0;

    const llmProvider = {
      async complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> {
        return callLLM(
          prompt,
          `evolution_${label}`,
          EVOLUTION_SYSTEM_USERID,
          (opts?.model ?? 'deepseek-chat') as AllowedLLMModelType,
          false,
          null,
          null,
          null,
          false,
          {},
        );
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
    completed_at: new Date().toISOString(),
    runner_id: null,
  }).eq('id', runId).in('status', ['pending', 'claimed', 'running']);
}
