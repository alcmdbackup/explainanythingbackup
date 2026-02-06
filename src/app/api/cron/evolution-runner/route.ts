// Evolution runner cron — picks up pending runs and executes full pipeline.
// Designed to be called by Vercel cron or GitHub Actions every 5 minutes.

import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { v4 as uuidv4 } from 'uuid';

const RUNNER_ID = `cron-runner-${uuidv4().slice(0, 8)}`;
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

export async function GET(request: Request): Promise<NextResponse> {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = await createSupabaseServiceClient();

    // 1. Find oldest pending run (FIFO)
    const { data: pendingRun, error: fetchError } = await supabase
      .from('content_evolution_runs')
      .select('id, explanation_id, config, budget_cap_usd')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      logger.error('Evolution runner fetch error', { error: fetchError.message });
      return NextResponse.json({ error: 'Failed to query pending runs' }, { status: 500 });
    }

    if (!pendingRun) {
      return NextResponse.json({
        status: 'ok',
        message: 'No pending runs',
        timestamp: new Date().toISOString(),
      });
    }

    const runId = pendingRun.id;

    // 2. Claim run (atomic update with status check)
    const { data: claimed, error: claimError } = await supabase
      .from('content_evolution_runs')
      .update({
        status: 'claimed',
        runner_id: RUNNER_ID,
        last_heartbeat: new Date().toISOString(),
      })
      .eq('id', runId)
      .eq('status', 'pending') // Only claim if still pending (prevents race)
      .select('id')
      .maybeSingle();

    if (claimError || !claimed) {
      logger.info('Run was claimed by another runner', { runId });
      return NextResponse.json({
        status: 'ok',
        message: 'Run claimed by another runner',
        runId,
        timestamp: new Date().toISOString(),
      });
    }

    logger.info('Claimed evolution run', { runId, runnerId: RUNNER_ID });

    // 3. Check feature flags
    const { fetchEvolutionFeatureFlags } = await import('@/lib/evolution/core/featureFlags');
    const featureFlags = await fetchEvolutionFeatureFlags(supabase);
    if (featureFlags.dryRunOnly) {
      logger.info('Evolution dry-run mode active via feature flag', { runId });
      await supabase.from('content_evolution_runs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        error_message: 'dry-run: execution skipped (feature flag)',
        runner_id: null,
      }).eq('id', runId);
      return NextResponse.json({
        status: 'ok',
        message: 'Dry-run mode - run skipped',
        runId,
        timestamp: new Date().toISOString(),
      });
    }

    // 4. Get article content
    const { data: explanation, error: contentError } = await supabase
      .from('explanations')
      .select('id, explanation_title, content')
      .eq('id', pendingRun.explanation_id)
      .single();

    if (contentError || !explanation) {
      await markRunFailed(supabase, runId, `Explanation ${pendingRun.explanation_id} not found`);
      return NextResponse.json({
        status: 'error',
        message: 'Explanation not found',
        runId,
        timestamp: new Date().toISOString(),
      }, { status: 404 });
    }

    // 5. Setup pipeline context
    const {
      PipelineStateImpl,
      createCostTracker,
      createEvolutionLogger,
      createEvolutionLLMClient,
      executeFullPipeline,
      resolveConfig,
      GenerationAgent,
      CalibrationRanker,
      Tournament,
      EvolutionAgent,
      ReflectionAgent,
      IterativeEditingAgent,
      DebateAgent,
      ProximityAgent,
      MetaReviewAgent,
    } = await import('@/lib/evolution');
    type PipelineAgents = import('@/lib/evolution').PipelineAgents;

    const config = resolveConfig(pendingRun.config ?? {});
    const state = new PipelineStateImpl(explanation.content);
    const costTracker = createCostTracker(config);
    const evolutionLogger = createEvolutionLogger(runId);
    const llmClient = createEvolutionLLMClient(
      'evolution-cron',
      costTracker,
      evolutionLogger,
    );

    const ctx = {
      payload: {
        originalText: explanation.content,
        title: explanation.explanation_title,
        explanationId: explanation.id,
        runId,
        config,
      },
      state,
      llmClient,
      logger: evolutionLogger,
      costTracker,
      runId,
    };

    const agents: PipelineAgents = {
      generation: new GenerationAgent(),
      calibration: new CalibrationRanker(),
      tournament: new Tournament(),
      evolution: new EvolutionAgent(),
      reflection: new ReflectionAgent(),
      iterativeEditing: new IterativeEditingAgent(),
      debate: new DebateAgent(),
      proximity: new ProximityAgent(),
      metaReview: new MetaReviewAgent(),
    };

    // 6. Start heartbeat interval (keeps watchdog happy)
    let heartbeatInterval: NodeJS.Timeout | null = null;
    const startMs = Date.now();

    try {
      heartbeatInterval = setInterval(async () => {
        try {
          await supabase.from('content_evolution_runs').update({
            last_heartbeat: new Date().toISOString(),
          }).eq('id', runId);
        } catch (err) {
          logger.warn('Heartbeat update failed', { runId, error: String(err) });
        }
      }, HEARTBEAT_INTERVAL_MS);

      // 7. Execute full pipeline
      const { stopReason } = await executeFullPipeline(runId, agents, ctx, evolutionLogger, {
        startMs,
        featureFlags,
      });

      // Clear runner_id on completion
      await supabase.from('content_evolution_runs').update({
        runner_id: null,
      }).eq('id', runId);

      logger.info('Evolution run completed', { runId, stopReason, durationMs: Date.now() - startMs });

      return NextResponse.json({
        status: 'ok',
        message: 'Run completed',
        runId,
        stopReason,
        durationMs: Date.now() - startMs,
        timestamp: new Date().toISOString(),
      });
    } catch (pipelineError) {
      const errorMessage = pipelineError instanceof Error ? pipelineError.message : String(pipelineError);
      logger.error('Evolution pipeline failed', { runId, error: errorMessage });

      // Mark as failed (if not already marked by pipeline)
      await supabase.from('content_evolution_runs').update({
        status: 'failed',
        error_message: errorMessage,
        runner_id: null,
      }).eq('id', runId).eq('status', 'running'); // Only update if still running

      return NextResponse.json({
        status: 'error',
        message: 'Pipeline execution failed',
        runId,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }, { status: 500 });
    } finally {
      // Always clean up the heartbeat interval to prevent memory leaks
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

async function markRunFailed(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  runId: string,
  errorMessage: string,
): Promise<void> {
  await supabase.from('content_evolution_runs').update({
    status: 'failed',
    error_message: errorMessage,
    runner_id: null,
  }).eq('id', runId);
}
