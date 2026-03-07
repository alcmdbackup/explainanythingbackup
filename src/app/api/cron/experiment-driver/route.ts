// Experiment driver cron — advances experiments through their lifecycle state machine.
// Runs every minute, applies at most 1 state transition per active experiment per invocation.

import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/utils/cronAuth';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { computeManualAnalysis } from '@evolution/experiments/evolution/analysis';
import { computeRunMetrics } from '@evolution/experiments/evolution/experimentMetrics';
import { extractTopElo } from '@evolution/services/experimentHelpers';
import { callLLM } from '@/lib/services/llms';
import { EVOLUTION_SYSTEM_USERID } from '@evolution/lib/core/llmClient';
import { buildExperimentReportPrompt, REPORT_MODEL } from '@evolution/services/experimentReportPrompt';

export const maxDuration = 30;

type Supabase = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

interface ExperimentRow {
  id: string;
  name: string;
  status: string;
  total_budget_usd: number;
  spent_usd: number;
  convergence_threshold: number;
  factor_definitions: Record<string, { low: string | number; high: string | number }>;
  prompt_id: string;
  config_defaults: Record<string, unknown> | null;
  design: string;
}

interface TransitionResult {
  experimentId: string;
  from: string;
  to: string | null;
  detail?: string;
}

const ACTIVE_STATES = ['running', 'analyzing'];
const NON_TERMINAL_RUN_STATUSES = new Set(['pending', 'claimed', 'running', 'continuation_pending']);

async function handleRunning(
  supabase: Supabase,
  exp: ExperimentRow,
): Promise<TransitionResult> {
  const result: TransitionResult = { experimentId: exp.id, from: 'running', to: null };

  const { data: runs } = await supabase
    .from('evolution_runs')
    .select('status, total_cost_usd')
    .eq('experiment_id', exp.id);

  if (!runs || runs.length === 0) {
    result.detail = 'No runs found for experiment';
    return result;
  }

  const pending = runs.filter(r => NON_TERMINAL_RUN_STATUSES.has(r.status));
  if (pending.length > 0) {
    result.detail = `${pending.length} runs still active`;
    return result;
  }

  const roundSpent = runs.reduce((sum, r) => sum + (Number(r.total_cost_usd) || 0), 0);
  const totalSpent = (Number(exp.spent_usd) || 0) + roundSpent;
  await supabase
    .from('evolution_experiments')
    .update({ spent_usd: totalSpent, updated_at: new Date().toISOString() })
    .eq('id', exp.id);

  const completed = runs.filter(r => r.status === 'completed');
  if (completed.length === 0) {
    result.to = 'failed';
    await supabase
      .from('evolution_experiments')
      .update({
        status: 'failed',
        error_message: 'All runs failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', exp.id)
      .eq('status', 'running');
    result.detail = `All ${runs.length} runs failed`;
  } else {
    result.to = 'analyzing';
    await supabase
      .from('evolution_experiments')
      .update({ status: 'analyzing', updated_at: new Date().toISOString() })
      .eq('id', exp.id)
      .eq('status', 'running');
    result.detail = `${completed.length}/${runs.length} runs completed`;
  }

  return result;
}

async function handleAnalyzing(
  supabase: Supabase,
  exp: ExperimentRow,
): Promise<TransitionResult> {
  const result: TransitionResult = { experimentId: exp.id, from: 'analyzing', to: null };

  const { data: dbRuns } = await supabase
    .from('evolution_runs')
    .select('id, status, total_cost_usd, run_summary, config')
    .eq('experiment_id', exp.id);

  if (!dbRuns) {
    result.detail = 'Failed to fetch runs';
    return result;
  }

  const analysisResult = computeManualAnalysis(dbRuns, extractTopElo) as unknown as Record<string, unknown>;

  // Compute new metrics_v2 per completed run
  const completedRuns = dbRuns.filter(r => r.status === 'completed');
  let metricsV2: Record<string, unknown> | null = null;
  try {
    const runMetrics: Record<string, unknown> = {};
    for (const run of completedRuns) {
      const metrics = await computeRunMetrics(run.id, supabase as never);
      runMetrics[run.id] = metrics.metrics;
    }
    metricsV2 = { runs: runMetrics, computedAt: new Date().toISOString() };
  } catch (e) {
    logger.error(`Failed to compute metrics_v2 for experiment ${exp.id}`, { error: String(e) });
  }

  // Read-merge-write to preserve existing keys
  const { data: currentExp } = await supabase
    .from('evolution_experiments')
    .select('analysis_results')
    .eq('id', exp.id)
    .single();

  const mergedAnalysis = {
    ...((currentExp?.analysis_results as Record<string, unknown>) ?? {}),
    ...analysisResult,
    ...(metricsV2 ? { metrics_v2: metricsV2 } : {}),
  };

  await supabase
    .from('evolution_experiments')
    .update({
      analysis_results: mergedAnalysis,
      updated_at: new Date().toISOString(),
    })
    .eq('id', exp.id);

  // Single-round model: always terminal after analysis
  if (completedRuns.length > 0) {
    result.to = 'completed';
    await writeTerminalState(supabase, exp, 'completed', analysisResult);
    result.detail = `Completed with ${completedRuns.length} successful runs`;
  } else {
    result.to = 'failed';
    await writeTerminalState(supabase, exp, 'failed', analysisResult);
    result.detail = 'All runs failed during analysis';
  }

  return result;
}

async function writeTerminalState(
  supabase: Supabase,
  exp: ExperimentRow,
  terminalStatus: string,
  analysis: Record<string, unknown>,
): Promise<void> {
  const { data: runs } = await supabase
    .from('evolution_runs')
    .select('id, run_summary, config, total_cost_usd, strategy_config_id')
    .eq('experiment_id', exp.id)
    .eq('status', 'completed');

  const completedRuns = (runs ?? []) as Record<string, unknown>[];

  let bestElo = 0;
  let bestConfig: Record<string, unknown> | null = null;
  let bestStrategyId: string | null = null;

  for (const run of completedRuns) {
    const elo = extractTopElo(run.run_summary as Record<string, unknown> | null);
    if (elo != null && elo > bestElo) {
      bestElo = elo;
      bestConfig = run.config as Record<string, unknown>;
      bestStrategyId = run.strategy_config_id as string | null;
    }
  }

  const factorRanking = (analysis as { factorRanking?: unknown[] }).factorRanking ?? [];
  const recommendations = (analysis as { recommendations?: string[] }).recommendations ?? [];

  const resultsSummary = {
    bestElo,
    bestConfig,
    bestStrategyId,
    factorRanking,
    recommendations,
    terminationReason: terminalStatus,
  };

  await supabase
    .from('evolution_experiments')
    .update({
      status: terminalStatus,
      results_summary: resultsSummary,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', exp.id);

  // Fire-and-forget report generation (after main status update)
  try {
    const runIds = completedRuns.map(r => r.id as string);
    const { data: agentMetrics } = runIds.length > 0
      ? await supabase
          .from('evolution_run_agent_metrics')
          .select('agent_name, cost_usd, elo_gain, elo_per_dollar, variants_generated')
          .in('run_id', runIds)
      : { data: [] };

    const prompt = buildExperimentReportPrompt({
      experiment: exp as unknown as Record<string, unknown>,
      runs: completedRuns,
      agentMetrics: (agentMetrics ?? []) as Record<string, unknown>[],
      resultsSummary,
    });

    const reportText = await callLLM(
      prompt,
      'experiment_report_generation',
      EVOLUTION_SYSTEM_USERID,
      REPORT_MODEL,
      false,
      null,
    );

    const reportMeta = {
      text: reportText,
      generatedAt: new Date().toISOString(),
      model: REPORT_MODEL,
    };
    await supabase
      .from('evolution_experiments')
      .update({
        results_summary: { ...resultsSummary, report: reportMeta },
      })
      .eq('id', exp.id);

    logger.debug(`Generated report for experiment ${exp.id}`);
  } catch (reportError) {
    logger.error(`Failed to generate report for experiment ${exp.id}`, {
      error: reportError instanceof Error ? reportError.stack : String(reportError),
    });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = await createSupabaseServiceClient();

    const { data: experiments, error: fetchError } = await supabase
      .from('evolution_experiments')
      .select('id, name, status, total_budget_usd, spent_usd, convergence_threshold, factor_definitions, prompt_id, config_defaults, design')
      .in('status', ACTIVE_STATES)
      .order('created_at', { ascending: true })
      .limit(5);

    if (fetchError) {
      logger.error('Experiment driver fetch error', { error: fetchError.message });
      return NextResponse.json({ error: 'Failed to query experiments' }, { status: 500 });
    }

    if (!experiments || experiments.length === 0) {
      return NextResponse.json({ status: 'ok', processed: 0, timestamp: new Date().toISOString() });
    }

    const transitions: TransitionResult[] = [];

    for (const exp of experiments) {
      try {
        let transition: TransitionResult;
        switch (exp.status) {
          case 'running':
            transition = await handleRunning(supabase, exp as ExperimentRow);
            break;
          case 'analyzing':
            transition = await handleAnalyzing(supabase, exp as ExperimentRow);
            break;
          default:
            transition = { experimentId: exp.id, from: exp.status, to: null, detail: 'Unknown state' };
        }
        transitions.push(transition);

        if (transition.to) {
          logger.info('Experiment state transition', {
            experimentId: exp.id,
            from: transition.from,
            to: transition.to,
            detail: transition.detail,
          });
        }
      } catch (error) {
        logger.error('Experiment driver error for experiment', {
          experimentId: exp.id,
          error: String(error),
        });
        transitions.push({
          experimentId: exp.id,
          from: exp.status,
          to: null,
          detail: `Error: ${String(error)}`,
        });
      }
    }

    return NextResponse.json({
      status: 'ok',
      processed: experiments.length,
      transitions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Experiment driver unexpected error', { error: String(error) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
