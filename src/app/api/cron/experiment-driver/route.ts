// Experiment driver cron — advances experiments through their lifecycle state machine.
// Runs every minute, applies at most 1 state transition per active experiment per invocation.

import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/utils/cronAuth';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { analyzeExperiment } from '@evolution/experiments/evolution/analysis';
import type { ExperimentRun, AnalysisResult } from '@evolution/experiments/evolution/analysis';
import {
  generateL8Design,
  generateFullFactorialDesign,
  mapFactorsToPipelineArgs,
} from '@evolution/experiments/evolution/factorial';
import type { FactorDefinition, MultiLevelFactor } from '@evolution/experiments/evolution/factorial';
import { FACTOR_REGISTRY } from '@evolution/experiments/evolution/factorRegistry';
import { estimateBatchCost } from '@evolution/experiments/evolution/experimentValidation';
import { resolveConfig } from '@evolution/lib/config';
import type { EvolutionRunConfig } from '@evolution/lib/types';
import { resolveOrCreateStrategyFromRunConfig } from '@evolution/services/strategyResolution';
import { extractTopElo } from '@evolution/services/experimentHelpers';
import { callLLM } from '@/lib/services/llms';
import { EVOLUTION_SYSTEM_USERID } from '@evolution/lib/core/llmClient';
import { buildExperimentReportPrompt, REPORT_MODEL } from '@evolution/services/experimentReportPrompt';

export const maxDuration = 30;

type Supabase = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

// ─── Types ────────────────────────────────────────────────────────

interface ExperimentRow {
  id: string;
  name: string;
  status: string;
  optimization_target: string;
  total_budget_usd: number;
  spent_usd: number;
  max_rounds: number;
  current_round: number;
  convergence_threshold: number;
  factor_definitions: Record<string, { low: string | number; high: string | number }>;
  prompts: string[];
  config_defaults: Partial<EvolutionRunConfig> | null;
}

interface TransitionResult {
  experimentId: string;
  from: string;
  to: string | null;
  detail?: string;
}

const ACTIVE_STATES = ['round_running', 'round_analyzing', 'pending_next_round'];
const IN_PROGRESS_RUN_STATUSES = new Set(['pending', 'claimed', 'running']);
const NON_TERMINAL_RUN_STATUSES = new Set(['pending', 'claimed', 'running', 'continuation_pending']);

// ─── Run Data Extraction ─────────────────────────────────────────

/** Map DB runs to ExperimentRun[], averaging per row across prompts. */
function mapRunsForAnalysis(
  dbRuns: Array<{
    id: string;
    status: string;
    total_cost_usd: number | null;
    run_summary: Record<string, unknown> | null;
    config: Record<string, unknown> | null;
  }>,
): ExperimentRun[] {
  // Group by experiment row
  const byRow = new Map<number, { elos: number[]; costs: number[]; statuses: string[]; runIds: string[] }>();

  for (const run of dbRuns) {
    const row = (run.config as Record<string, unknown>)?._experimentRow as number | undefined;
    if (row == null) continue;

    if (!byRow.has(row)) {
      byRow.set(row, { elos: [], costs: [], statuses: [], runIds: [] });
    }
    const group = byRow.get(row)!;
    group.runIds.push(run.id);
    group.statuses.push(run.status);

    if (run.status === 'completed') {
      const elo = extractTopElo(run.run_summary);
      if (elo != null) group.elos.push(elo);
      if (run.total_cost_usd != null) group.costs.push(Number(run.total_cost_usd));
    }
  }

  const avg = (arr: number[]): number | undefined =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : undefined;

  const result: ExperimentRun[] = [];
  for (const [row, group] of byRow) {
    let status: ExperimentRun['status'];
    if (group.statuses.some(s => IN_PROGRESS_RUN_STATUSES.has(s))) status = 'running';
    else if (group.elos.length > 0) status = 'completed';
    else if (group.statuses.every(s => s === 'failed')) status = 'failed';
    else status = 'pending';

    result.push({
      row,
      runId: group.runIds[0],
      status,
      topElo: avg(group.elos),
      costUsd: avg(group.costs),
    });
  }

  return result;
}

// ─── State Handlers ──────────────────────────────────────────────

async function handleRoundRunning(
  supabase: Supabase,
  exp: ExperimentRow,
): Promise<TransitionResult> {
  const result: TransitionResult = { experimentId: exp.id, from: 'round_running', to: null };

  // Get current round's batch_run_id
  const { data: round } = await supabase
    .from('evolution_experiment_rounds')
    .select('batch_run_id')
    .eq('experiment_id', exp.id)
    .eq('round_number', exp.current_round)
    .single();

  if (!round?.batch_run_id) {
    result.detail = 'No batch found for current round';
    return result;
  }

  // Count run statuses
  const { data: runs } = await supabase
    .from('evolution_runs')
    .select('status, total_cost_usd')
    .eq('batch_run_id', round.batch_run_id);

  if (!runs || runs.length === 0) {
    result.detail = 'No runs found for batch';
    return result;
  }

  const pending = runs.filter(r => NON_TERMINAL_RUN_STATUSES.has(r.status));
  if (pending.length > 0) {
    result.detail = `${pending.length} runs still active`;
    return result; // Not all terminal yet
  }

  // All runs terminal — accumulate spent_usd across rounds
  const roundSpent = runs.reduce((sum, r) => sum + (Number(r.total_cost_usd) || 0), 0);
  const totalSpent = (Number(exp.spent_usd) || 0) + roundSpent;
  await supabase
    .from('evolution_experiments')
    .update({ spent_usd: totalSpent, updated_at: new Date().toISOString() })
    .eq('id', exp.id);

  const completed = runs.filter(r => r.status === 'completed');
  if (completed.length === 0) {
    // All failed
    result.to = 'failed';
    await supabase
      .from('evolution_experiments')
      .update({
        status: 'failed',
        error_message: 'All runs in current round failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', exp.id)
      .eq('status', 'round_running');
    result.detail = `All ${runs.length} runs failed`;
  } else {
    // Some completed → analyze
    result.to = 'round_analyzing';
    await supabase
      .from('evolution_experiments')
      .update({ status: 'round_analyzing', updated_at: new Date().toISOString() })
      .eq('id', exp.id)
      .eq('status', 'round_running');
    result.detail = `${completed.length}/${runs.length} runs completed`;
  }

  return result;
}

async function handleRoundAnalyzing(
  supabase: Supabase,
  exp: ExperimentRow,
): Promise<TransitionResult> {
  const result: TransitionResult = { experimentId: exp.id, from: 'round_analyzing', to: null };

  // Get current round
  const { data: round } = await supabase
    .from('evolution_experiment_rounds')
    .select('id, batch_run_id, design, factor_definitions')
    .eq('experiment_id', exp.id)
    .eq('round_number', exp.current_round)
    .single();

  if (!round?.batch_run_id) {
    result.detail = 'No round/batch found';
    return result;
  }

  // Fetch all runs with summaries
  const { data: dbRuns } = await supabase
    .from('evolution_runs')
    .select('id, status, total_cost_usd, run_summary, config')
    .eq('batch_run_id', round.batch_run_id);

  if (!dbRuns) {
    result.detail = 'Failed to fetch runs';
    return result;
  }

  // Reconstruct design from stored factor definitions
  const design = round.design === 'L8'
    ? generateL8Design(round.factor_definitions as Record<string, FactorDefinition>)
    : generateFullFactorialDesign(round.factor_definitions as MultiLevelFactor[]);

  // Map runs for analysis
  const analysisRuns = mapRunsForAnalysis(dbRuns);
  const analysisResult = analyzeExperiment(design, analysisRuns);

  // Store analysis on round
  await supabase
    .from('evolution_experiment_rounds')
    .update({
      analysis_results: analysisResult,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', round.id);

  // Determine next state — use CI upper bound when available for conservative convergence
  const topFactor = analysisResult.factorRanking[0];
  const topEffect = topFactor
    ? (topFactor.ci_upper ?? topFactor.importance)
    : 0;
  const convergenceThreshold = Number(exp.convergence_threshold);

  if (topEffect < convergenceThreshold && analysisResult.completedRuns >= 4) {
    // Converged — top factor effect CI upper bound is below threshold
    result.to = 'converged';
    await writeTerminalState(supabase, exp, 'converged', analysisResult);
    result.detail = `Converged: top effect ${Math.round(topEffect)} < threshold ${convergenceThreshold}`;
  } else if (Number(exp.spent_usd) >= Number(exp.total_budget_usd) * 0.9) {
    // Budget nearly exhausted (< 10% remaining)
    result.to = 'budget_exhausted';
    await writeTerminalState(supabase, exp, 'budget_exhausted', analysisResult);
    result.detail = `Budget exhausted: spent $${exp.spent_usd} of $${exp.total_budget_usd}`;
  } else if (exp.current_round >= exp.max_rounds) {
    // Max rounds reached
    result.to = 'max_rounds';
    await writeTerminalState(supabase, exp, 'max_rounds', analysisResult);
    result.detail = `Max rounds reached: ${exp.current_round}/${exp.max_rounds}`;
  } else {
    // Continue to next round
    result.to = 'pending_next_round';
    await supabase
      .from('evolution_experiments')
      .update({ status: 'pending_next_round', updated_at: new Date().toISOString() })
      .eq('id', exp.id)
      .eq('status', 'round_analyzing');
    result.detail = `Top effect ${Math.round(topEffect)} > threshold ${convergenceThreshold}, preparing next round`;
  }

  return result;
}

async function handlePendingNextRound(
  supabase: Supabase,
  exp: ExperimentRow,
): Promise<TransitionResult> {
  const result: TransitionResult = { experimentId: exp.id, from: 'pending_next_round', to: null };

  // Get last completed round's analysis
  const { data: lastRound } = await supabase
    .from('evolution_experiment_rounds')
    .select('analysis_results, factor_definitions, design')
    .eq('experiment_id', exp.id)
    .eq('round_number', exp.current_round)
    .single();

  if (!lastRound?.analysis_results) {
    result.detail = 'No analysis results from previous round';
    return result;
  }

  const analysis = lastRound.analysis_results as Partial<AnalysisResult>;

  const factorRanking = analysis.factorRanking ?? [];
  if (factorRanking.length === 0) {
    result.detail = 'No factor ranking available';
    return result;
  }

  // Derive next round factors
  const topThreshold = factorRanking[0].importance * 0.15;
  const variedFactors: MultiLevelFactor[] = [];
  const lockedFactors: Record<string, string | number> = {};

  for (const ranked of factorRanking) {
    // Map factor key back to registry key
    const factorKey = lastRound.design === 'L8'
      ? (lastRound.factor_definitions as Record<string, FactorDefinition>)[ranked.factor]?.name ?? ranked.factor
      : ranked.factor;

    const registryDef = FACTOR_REGISTRY.get(factorKey);
    if (!registryDef) continue;

    if (ranked.importance < topThreshold) {
      // Negligible → lock at cheap level (best Elo/$ direction)
      const direction = ranked.eloPerDollarEffect >= 0 ? 'high' : 'low';
      const input = exp.factor_definitions[factorKey];
      lockedFactors[factorKey] = input ? input[direction] : registryDef.getValidValues()[0];
    } else {
      // Important → expand around winner
      const winnerDirection = ranked.eloEffect > 0 ? 'high' : 'low';
      const input = exp.factor_definitions[factorKey];
      const winnerValue = input ? input[winnerDirection] : registryDef.getValidValues()[0];
      const expanded = registryDef.expandAroundWinner(winnerValue);

      variedFactors.push({
        name: factorKey,
        label: registryDef.label,
        levels: expanded,
      });
    }
  }

  // Need at least 1 varied factor
  if (variedFactors.length === 0) {
    result.to = 'converged';
    await writeTerminalState(supabase, exp, 'converged', analysis);
    result.detail = 'All factors negligible — converged';
    return result;
  }

  // Estimate cost of new round
  const ffDesign = generateFullFactorialDesign(variedFactors);

  const totalNextRoundRuns = ffDesign.runs.length * exp.prompts.length;
  if (totalNextRoundRuns === 0) {
    result.detail = 'Next round produced 0 runs';
    return result;
  }
  const remainingBudget = Number(exp.total_budget_usd) - Number(exp.spent_usd);
  if (remainingBudget <= 0) {
    result.to = 'budget_exhausted';
    await writeTerminalState(supabase, exp, 'budget_exhausted', analysis);
    result.detail = `No remaining budget: $${remainingBudget.toFixed(2)}`;
    return result;
  }
  const perRunBudgetNextRound = remainingBudget / totalNextRoundRuns;

  // Resolve a full EvolutionRunConfig for one factorial run row
  const resolveRunConfig = (
    runFactors: Record<string, string | number>,
    row: number,
  ): { row: number; config: EvolutionRunConfig } => {
    const allFactors = { ...lockedFactors, ...runFactors };
    const pipelineArgs = mapFactorsToPipelineArgs(allFactors);
    const overrides: Partial<EvolutionRunConfig> = {
      ...exp.config_defaults ?? {},
      budgetCapUsd: perRunBudgetNextRound,
      generationModel: pipelineArgs.model as EvolutionRunConfig['generationModel'],
      judgeModel: pipelineArgs.judgeModel as EvolutionRunConfig['judgeModel'],
      maxIterations: pipelineArgs.iterations,
      enabledAgents: pipelineArgs.enabledAgents as EvolutionRunConfig['enabledAgents'],
    };
    return { row, config: resolveConfig(overrides) };
  };

  const estimatedConfigs = ffDesign.runs.map((run) =>
    resolveRunConfig(run.factors, run.row),
  );

  let estimatedCost: number;
  try {
    estimatedCost = await estimateBatchCost(estimatedConfigs, exp.prompts);
  } catch {
    // If estimation fails, use a rough heuristic
    estimatedCost = ffDesign.runs.length * exp.prompts.length * 2.0;
  }

  if (estimatedCost > remainingBudget) {
    result.to = 'budget_exhausted';
    await writeTerminalState(supabase, exp, 'budget_exhausted', analysis);
    result.detail = `Next round estimated $${estimatedCost.toFixed(2)} > remaining $${remainingBudget.toFixed(2)}`;
    return result;
  }

  // Create next round
  const nextRound = exp.current_round + 1;

  // INSERT batch
  const { data: batch, error: batchError } = await supabase
    .from('evolution_batch_runs')
    .insert({
      name: `${exp.name} — Round ${nextRound}`,
      config: { factors: variedFactors, locked: lockedFactors, design: 'full-factorial', round: nextRound },
      status: 'pending',
      total_budget_usd: remainingBudget,
      runs_planned: ffDesign.runs.length * exp.prompts.length,
    })
    .select('id')
    .single();
  if (batchError || !batch) {
    result.detail = `Failed to create batch: ${batchError?.message}`;
    return result;
  }

  // INSERT round
  const { error: roundError } = await supabase
    .from('evolution_experiment_rounds')
    .insert({
      experiment_id: exp.id,
      round_number: nextRound,
      type: 'refinement',
      design: 'full-factorial',
      factor_definitions: variedFactors,
      locked_factors: lockedFactors,
      batch_run_id: batch.id,
      status: 'pending',
    });
  if (roundError) {
    result.detail = `Failed to create round: ${roundError.message}`;
    return result;
  }

  // Get or create experiment topic for explanations
  const { data: topicRow } = await supabase
    .from('topics')
    .select('id')
    .eq('topic_title', 'Batch Experiments')
    .single();
  let topicId = topicRow?.id;
  if (!topicId) {
    const { data: created, error: topicErr } = await supabase
      .from('topics')
      .insert({ topic_title: 'Batch Experiments', topic_description: 'Auto-generated for evolution experiments' })
      .select('id')
      .single();
    if (topicErr || !created) {
      result.detail = `Failed to create experiment topic: ${topicErr?.message}`;
      return result;
    }
    topicId = created.id;
  }

  // INSERT runs (with pre-registered strategies)
  const runInserts: Record<string, unknown>[] = [];
  for (const run of ffDesign.runs) {
    const { config: resolvedConfig } = resolveRunConfig(run.factors, run.row);

    // Pre-register strategy so it appears in leaderboard immediately
    const { id: strategyConfigId } = await resolveOrCreateStrategyFromRunConfig({
      runConfig: resolvedConfig,
      defaultBudgetCaps: resolvedConfig.budgetCaps ?? {},
      createdBy: 'experiment',
    }, supabase);

    for (const prompt of exp.prompts) {
      const promptTitle = `[Exp: ${exp.name}] ${prompt.slice(0, 50)}`;
      const { data: explanation, error: explError } = await supabase
        .from('explanations')
        .insert({
          explanation_title: promptTitle,
          content: prompt,
          primary_topic_id: topicId,
          status: 'draft',
        })
        .select('id')
        .single();

      if (explError || !explanation) {
        result.detail = `Failed to create explanation: ${explError?.message}`;
        return result;
      }

      runInserts.push({
        explanation_id: explanation.id,
        budget_cap_usd: resolvedConfig.budgetCapUsd,
        config: { ...resolvedConfig, _experimentRow: run.row },
        batch_run_id: batch.id,
        source: `experiment:${exp.id}`,
        strategy_config_id: strategyConfigId,
        status: 'pending',
      });
    }
  }

  const { error: runsError } = await supabase
    .from('evolution_runs')
    .insert(runInserts);
  if (runsError) {
    result.detail = `Failed to create runs: ${runsError.message}`;
    return result;
  }

  // Update statuses
  result.to = 'round_running';
  await supabase
    .from('evolution_experiments')
    .update({
      status: 'round_running',
      current_round: nextRound,
      updated_at: new Date().toISOString(),
    })
    .eq('id', exp.id)
    .eq('status', 'pending_next_round');

  await supabase
    .from('evolution_experiment_rounds')
    .update({ status: 'running' })
    .eq('experiment_id', exp.id)
    .eq('round_number', nextRound);

  await supabase
    .from('evolution_batch_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', batch.id);

  result.detail = `Created round ${nextRound}: ${ffDesign.runs.length} configs × ${exp.prompts.length} prompts = ${runInserts.length} runs`;
  return result;
}

// ─── Terminal State ──────────────────────────────────────────────

async function writeTerminalState(
  supabase: Supabase,
  exp: ExperimentRow,
  terminalStatus: string,
  analysis: Partial<AnalysisResult>,
): Promise<void> {
  // Find best run across all experiment batches
  const { data: allRounds } = await supabase
    .from('evolution_experiment_rounds')
    .select('batch_run_id')
    .eq('experiment_id', exp.id);

  const batchIds = (allRounds ?? [])
    .map((r: Record<string, unknown>) => r.batch_run_id as string)
    .filter(Boolean);

  let bestElo = 0;
  let bestConfig: Record<string, unknown> | null = null;
  let bestStrategyId: string | null = null;
  let completedRuns: Record<string, unknown>[] = [];

  if (batchIds.length > 0) {
    const { data: runs } = await supabase
      .from('evolution_runs')
      .select('id, run_summary, config, total_cost_usd, strategy_config_id')
      .in('batch_run_id', batchIds)
      .eq('status', 'completed');

    completedRuns = (runs ?? []) as Record<string, unknown>[];

    for (const run of completedRuns) {
      const elo = extractTopElo(run.run_summary as Record<string, unknown> | null);
      if (elo != null && elo > bestElo) {
        bestElo = elo;
        bestConfig = run.config as Record<string, unknown>;
        bestStrategyId = run.strategy_config_id as string | null;
      }
    }
  }

  const resultsSummary = {
    bestElo,
    bestConfig,
    bestStrategyId,
    factorRanking: analysis.factorRanking ?? [],
    recommendations: analysis.recommendations ?? [],
    finalRound: exp.current_round,
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
    const { data: fullRounds } = await supabase
      .from('evolution_experiment_rounds')
      .select('round_number, type, design, status, analysis_results, completed_at')
      .eq('experiment_id', exp.id)
      .order('round_number', { ascending: true });

    const runIds = completedRuns.map(r => r.id as string);
    const { data: agentMetrics } = runIds.length > 0
      ? await supabase
          .from('evolution_run_agent_metrics')
          .select('agent_name, cost_usd, elo_gain, elo_per_dollar, variants_generated')
          .in('run_id', runIds)
      : { data: [] };

    const prompt = buildExperimentReportPrompt({
      experiment: exp as Record<string, unknown>,
      rounds: (fullRounds ?? []) as Record<string, unknown>[],
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

    console.log(`[experiment-driver] Generated report for experiment ${exp.id}`);
  } catch (reportError) {
    console.error(`[experiment-driver] Failed to generate report for ${exp.id}:`,
      reportError instanceof Error ? reportError.stack : reportError);
  }
}

// ─── Route Handler ───────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = await createSupabaseServiceClient();

    // Find active experiments (1 transition per experiment per invocation)
    const { data: experiments, error: fetchError } = await supabase
      .from('evolution_experiments')
      .select('id, name, status, optimization_target, total_budget_usd, spent_usd, max_rounds, current_round, convergence_threshold, factor_definitions, prompts, config_defaults')
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
          case 'round_running':
            transition = await handleRoundRunning(supabase, exp as ExperimentRow);
            break;
          case 'round_analyzing':
            transition = await handleRoundAnalyzing(supabase, exp as ExperimentRow);
            break;
          case 'pending_next_round':
            transition = await handlePendingNextRound(supabase, exp as ExperimentRow);
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
