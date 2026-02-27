// Analyzes completed evolution runs to extract learnings and inform follow-up experiments.
// Queries the database for run metrics, strategy configs, agent costs, and hall of fame data.

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { ordinalToEloScale } from '../src/lib/core/rating';

// Load .env.local from project root. Uses process.cwd() instead of import.meta.url
// for Jest compatibility — scripts are always invoked from the project root.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ─── Supabase Client ──────────────────────────────────────────────

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key);
}

// ─── Types ────────────────────────────────────────────────────────

export interface RunRow {
  id: string;
  status: string;
  phase: string | null;
  total_cost_usd: number | null;
  budget_cap_usd: number | null;
  estimated_cost_usd: number | null;
  current_iteration: number | null;
  pipeline_type: string | null;
  config: Record<string, unknown> | null;
  run_summary: Record<string, unknown> | null;
  strategy_config_id: string | null;
  prompt_id: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface StrategyRow {
  id: string;
  name: string;
  label: string;
  config: Record<string, unknown>;
  config_hash: string;
  run_count: number;
  total_cost_usd: number;
  avg_final_elo: number | null;
  avg_elo_per_dollar: number | null;
  stddev_final_elo: number | null;
}

export interface AgentMetricRow {
  run_id: string;
  agent_name: string;
  cost_usd: number;
  variants_generated: number;
  avg_elo: number | null;
  elo_gain: number | null;
  elo_per_dollar: number | null;
}

export interface HofEntryRow {
  id: string;
  topic_id: string;
  generation_method: string;
  total_cost_usd: number | null;
  model: string | null;
  evolution_run_id: string | null;
}

export interface HofEloRow {
  entry_id: string;
  topic_id: string;
  elo_rating: number | null;
  elo_per_dollar: number | null;
  mu: number | null;
  sigma: number | null;
  match_count: number;
}

export interface ExperimentRow {
  id: string;
  name: string;
  status: string;
  optimization_target: string;
  total_budget_usd: number;
  spent_usd: number;
  current_round: number;
  max_rounds: number;
  factor_definitions: Record<string, unknown>;
  prompts: string[];
  results_summary: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

export interface ExperimentRoundRow {
  id: string;
  experiment_id: string;
  round_number: number;
  type: string;
  design: string;
  factor_definitions: Record<string, unknown>;
  locked_factors: Record<string, unknown> | null;
  analysis_results: Record<string, unknown> | null;
  status: string;
}

// ─── Exported Analysis Helpers ────────────────────────────────────

export function extractTopElo(runSummary: Record<string, unknown> | null): number | null {
  if (!runSummary) return null;
  const topVariants = runSummary.topVariants as Array<{ ordinal?: number; elo?: number }> | undefined;
  if (!topVariants || topVariants.length === 0) return null;
  const top = topVariants[0];
  if (top.ordinal != null) return ordinalToEloScale(top.ordinal);
  if (top.elo != null) return top.elo;
  return null;
}

export function extractStopReason(runSummary: Record<string, unknown> | null): string | null {
  if (!runSummary) return null;
  return (runSummary.stopReason as string) ?? null;
}

export function extractBaselineRank(runSummary: Record<string, unknown> | null): number | null {
  if (!runSummary) return null;
  return (runSummary.baselineRank as number) ?? null;
}

function extractDuration(run: RunRow): number | null {
  if (!run.created_at || !run.completed_at) return null;
  return (new Date(run.completed_at).getTime() - new Date(run.created_at).getTime()) / 1000;
}

export function countBy(items: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item] = (counts[item] ?? 0) + 1;
  }
  return counts;
}

export function avg(nums: number[]): number {
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function stddev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = avg(nums);
  return Math.sqrt(nums.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (nums.length - 1));
}

// ─── Analysis Functions ───────────────────────────────────────────

export function analyzeRuns(runs: RunRow[]) {
  const completed = runs.filter((r) => r.status === 'completed');
  const failed = runs.filter((r) => r.status === 'failed');
  const other = runs.filter((r) => !['completed', 'failed'].includes(r.status));

  const costs = completed.map((r) => Number(r.total_cost_usd ?? 0));
  const elos = completed.map((r) => extractTopElo(r.run_summary)).filter((e): e is number => e != null);
  const durations = completed.map((r) => extractDuration(r)).filter((d): d is number => d != null);
  const stopReasons = completed.map((r) => extractStopReason(r.run_summary)).filter(Boolean) as string[];

  return {
    total: runs.length,
    completed: completed.length,
    failed: failed.length,
    other: other.length,
    failureRate: runs.length > 0 ? `${((failed.length / runs.length) * 100).toFixed(1)}%` : 'N/A',
    costs: {
      total: costs.reduce((a, b) => a + b, 0),
      avg: avg(costs),
      min: costs.length > 0 ? Math.min(...costs) : 0,
      max: costs.length > 0 ? Math.max(...costs) : 0,
    },
    elo: {
      avg: avg(elos),
      min: elos.length > 0 ? Math.min(...elos) : 0,
      max: elos.length > 0 ? Math.max(...elos) : 0,
      stddev: stddev(elos),
    },
    duration: {
      avgMinutes: durations.length > 0 ? (avg(durations) / 60).toFixed(1) : 'N/A',
      minMinutes: durations.length > 0 ? (Math.min(...durations) / 60).toFixed(1) : 'N/A',
      maxMinutes: durations.length > 0 ? (Math.max(...durations) / 60).toFixed(1) : 'N/A',
    },
    stopReasons: countBy(stopReasons),
    errorMessages: failed.map((r) => r.error_message).filter(Boolean).slice(0, 10),
  };
}

export function analyzeStrategies(strategies: StrategyRow[]) {
  return strategies
    .filter((s) => s.run_count > 0)
    .sort((a, b) => (b.avg_elo_per_dollar ?? 0) - (a.avg_elo_per_dollar ?? 0))
    .map((s) => ({
      name: s.name,
      label: s.label,
      hash: s.config_hash,
      runCount: s.run_count,
      totalCost: Number(s.total_cost_usd).toFixed(2),
      avgElo: s.avg_final_elo?.toFixed(0) ?? 'N/A',
      eloDollar: s.avg_elo_per_dollar?.toFixed(0) ?? 'N/A',
      stddev: s.stddev_final_elo?.toFixed(0) ?? 'N/A',
      config: {
        genModel: (s.config as Record<string, unknown>).generationModel,
        judgeModel: (s.config as Record<string, unknown>).judgeModel,
        iterations: (s.config as Record<string, unknown>).iterations,
        enabledAgents: (s.config as Record<string, unknown>).enabledAgents,
        singleArticle: (s.config as Record<string, unknown>).singleArticle,
      },
    }));
}

export function analyzeAgents(metrics: AgentMetricRow[]) {
  const byAgent = new Map<string, { costs: number[]; eloGains: number[]; variants: number[] }>();

  for (const m of metrics) {
    if (!byAgent.has(m.agent_name)) {
      byAgent.set(m.agent_name, { costs: [], eloGains: [], variants: [] });
    }
    const group = byAgent.get(m.agent_name)!;
    group.costs.push(Number(m.cost_usd));
    if (m.elo_gain != null) group.eloGains.push(Number(m.elo_gain));
    group.variants.push(m.variants_generated);
  }

  return Array.from(byAgent.entries())
    .map(([agent, data]) => ({
      agent,
      samples: data.costs.length,
      avgCost: avg(data.costs).toFixed(4),
      totalCost: data.costs.reduce((a, b) => a + b, 0).toFixed(2),
      avgEloGain: data.eloGains.length > 0 ? avg(data.eloGains).toFixed(0) : 'N/A',
      avgVariants: avg(data.variants).toFixed(1),
      eloPerDollar: data.eloGains.length > 0 && avg(data.costs) > 0
        ? (avg(data.eloGains) / avg(data.costs)).toFixed(0)
        : 'N/A',
    }))
    .sort((a, b) =>
      Number(b.eloPerDollar === 'N/A' ? 0 : b.eloPerDollar) -
      Number(a.eloPerDollar === 'N/A' ? 0 : a.eloPerDollar),
    );
}

export function analyzeHofEntries(entries: HofEntryRow[], elos: HofEloRow[]) {
  const eloByEntry = new Map(elos.map((e) => [e.entry_id, e]));

  const byMethod = new Map<string, { elos: number[]; costs: number[]; count: number }>();
  for (const entry of entries) {
    const elo = eloByEntry.get(entry.id);
    const method = entry.generation_method;
    if (!byMethod.has(method)) {
      byMethod.set(method, { elos: [], costs: [], count: 0 });
    }
    const group = byMethod.get(method)!;
    group.count++;
    if (elo?.elo_rating != null) group.elos.push(Number(elo.elo_rating));
    if (entry.total_cost_usd != null) group.costs.push(Number(entry.total_cost_usd));
  }

  return Array.from(byMethod.entries()).map(([method, data]) => ({
    method,
    count: data.count,
    avgElo: data.elos.length > 0 ? avg(data.elos).toFixed(0) : 'N/A',
    avgCost: data.costs.length > 0 ? avg(data.costs).toFixed(4) : 'N/A',
    comparedCount: data.elos.length,
  }));
}

// ─── Output Formatting ────────────────────────────────────────────

function printSection(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(60)}`);
}

function printTable(headers: string[], rows: string[][]) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const sep = widths.map((w) => '─'.repeat(w + 2)).join('┼');

  console.log('  ' + headers.map((h, i) => h.padEnd(widths[i])).join(' │ '));
  console.log('  ' + sep);
  for (const row of rows) {
    console.log('  ' + row.map((c, i) => (c ?? '').padEnd(widths[i])).join(' │ '));
  }
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  const supabase = getSupabaseClient();

  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│  Evolution Experiment Analysis                          │');
  console.log('│  Extracts learnings from completed runs                 │');
  console.log('└─────────────────────────────────────────────────────────┘');

  // ── 1. Fetch all runs ──────────────────────────────────────────
  printSection('1. Run Overview');

  const { data: runs, error: runsErr } = await supabase
    .from('evolution_runs')
    .select('id, status, phase, total_cost_usd, budget_cap_usd, estimated_cost_usd, current_iteration, pipeline_type, config, run_summary, strategy_config_id, prompt_id, created_at, completed_at, error_message')
    .order('created_at', { ascending: false })
    .limit(10000);

  if (runsErr) {
    console.error('Failed to fetch runs:', runsErr.message);
    process.exit(1);
  }

  const typedRuns = runs as RunRow[];
  const runAnalysis = analyzeRuns(typedRuns);

  console.log(`  Total runs: ${runAnalysis.total}`);
  console.log(`  Completed: ${runAnalysis.completed} | Failed: ${runAnalysis.failed} | Other: ${runAnalysis.other}`);
  console.log(`  Failure rate: ${runAnalysis.failureRate}`);
  console.log(`\n  Cost: $${runAnalysis.costs.total.toFixed(2)} total, $${runAnalysis.costs.avg.toFixed(2)} avg, [$${runAnalysis.costs.min.toFixed(2)} - $${runAnalysis.costs.max.toFixed(2)}]`);
  console.log(`  Elo:  ${runAnalysis.elo.avg.toFixed(0)} avg, [${runAnalysis.elo.min.toFixed(0)} - ${runAnalysis.elo.max.toFixed(0)}], stddev: ${runAnalysis.elo.stddev.toFixed(0)}`);
  console.log(`  Duration: ${runAnalysis.duration.avgMinutes} min avg, [${runAnalysis.duration.minMinutes} - ${runAnalysis.duration.maxMinutes}] min`);

  if (Object.keys(runAnalysis.stopReasons).length > 0) {
    console.log('\n  Stop reasons:');
    for (const [reason, count] of Object.entries(runAnalysis.stopReasons)) {
      console.log(`    ${reason}: ${count}`);
    }
  }

  if (runAnalysis.errorMessages.length > 0) {
    console.log('\n  Recent error messages:');
    for (const msg of runAnalysis.errorMessages) {
      console.log(`    - ${(msg as string).slice(0, 120)}`);
    }
  }

  // Pipeline type distribution
  const pipelineTypes = countBy(typedRuns.map((r) => r.pipeline_type ?? 'unknown'));
  console.log('\n  Pipeline types:');
  for (const [type, count] of Object.entries(pipelineTypes)) {
    console.log(`    ${type}: ${count}`);
  }

  // ── 2. Strategy analysis ───────────────────────────────────────
  printSection('2. Strategy Analysis');

  const { data: strategies, error: stratErr } = await supabase
    .from('evolution_strategy_configs')
    .select('id, name, label, config, config_hash, run_count, total_cost_usd, avg_final_elo, avg_elo_per_dollar, stddev_final_elo')
    .order('run_count', { ascending: false })
    .limit(10000);

  if (stratErr) {
    console.error('Failed to fetch strategies:', stratErr.message);
  } else {
    const stratAnalysis = analyzeStrategies(strategies as StrategyRow[]);
    if (stratAnalysis.length === 0) {
      console.log('  No strategies with runs found.');
    } else {
      printTable(
        ['Strategy', 'Runs', 'Avg Elo', 'Elo/$', 'StdDev', 'Cost', 'Gen Model', 'Judge', 'Iters'],
        stratAnalysis.map((s) => [
          s.name.slice(0, 25),
          String(s.runCount),
          String(s.avgElo),
          String(s.eloDollar),
          String(s.stddev),
          `$${s.totalCost}`,
          String(s.config.genModel ?? '?'),
          String(s.config.judgeModel ?? '?'),
          String(s.config.iterations ?? '?'),
        ]),
      );

      if (stratAnalysis.length >= 2) {
        const best = stratAnalysis[0];
        const worst = stratAnalysis[stratAnalysis.length - 1];
        console.log(`\n  Best Elo/$: ${best.name} (${best.eloDollar} Elo/$, gen=${best.config.genModel}, judge=${best.config.judgeModel}, ${best.config.iterations} iters)`);
        console.log(`  Worst Elo/$: ${worst.name} (${worst.eloDollar} Elo/$, gen=${worst.config.genModel}, judge=${worst.config.judgeModel}, ${worst.config.iterations} iters)`);
      }
    }
  }

  // ── 3. Agent ROI analysis ──────────────────────────────────────
  printSection('3. Agent ROI Analysis');

  const { data: agentMetrics, error: agentErr } = await supabase
    .from('evolution_run_agent_metrics')
    .select('run_id, agent_name, cost_usd, variants_generated, avg_elo, elo_gain, elo_per_dollar')
    .limit(50000);

  if (agentErr) {
    console.error('Failed to fetch agent metrics:', agentErr.message);
  } else {
    const agentAnalysis = analyzeAgents(agentMetrics as AgentMetricRow[]);
    if (agentAnalysis.length === 0) {
      console.log('  No agent metrics found.');
    } else {
      printTable(
        ['Agent', 'Samples', 'Avg Cost', 'Total Cost', 'Avg Elo Gain', 'Elo/$', 'Avg Variants'],
        agentAnalysis.map((a) => [
          a.agent,
          String(a.samples),
          `$${a.avgCost}`,
          `$${a.totalCost}`,
          String(a.avgEloGain),
          String(a.eloPerDollar),
          String(a.avgVariants),
        ]),
      );
    }
  }

  // ── 4. Cost accuracy analysis ──────────────────────────────────
  printSection('4. Cost Estimation Accuracy');

  const completedRuns = typedRuns.filter(
    (r) => r.status === 'completed' && r.estimated_cost_usd != null && r.total_cost_usd != null,
  );
  if (completedRuns.length === 0) {
    console.log('  No runs with cost estimates found.');
  } else {
    const deltas = completedRuns.map((r) => {
      const estimated = Number(r.estimated_cost_usd);
      const actual = Number(r.total_cost_usd);
      return { estimated, actual, delta: actual - estimated, deltaPct: ((actual - estimated) / estimated) * 100 };
    });
    const avgDelta = avg(deltas.map((d) => d.deltaPct));
    const avgAbsDelta = avg(deltas.map((d) => Math.abs(d.deltaPct)));
    console.log(`  Runs with estimates: ${completedRuns.length}`);
    console.log(`  Avg delta: ${avgDelta > 0 ? '+' : ''}${avgDelta.toFixed(1)}%`);
    console.log(`  Avg |delta|: ${avgAbsDelta.toFixed(1)}%`);
    console.log(`  Overestimates: ${deltas.filter((d) => d.deltaPct < -10).length}`);
    console.log(`  Underestimates: ${deltas.filter((d) => d.deltaPct > 10).length}`);
  }

  // ── 5. Automated experiments ───────────────────────────────────
  printSection('5. Automated Experiments');

  const { data: experiments, error: expErr } = await supabase
    .from('evolution_experiments')
    .select('id, name, status, optimization_target, total_budget_usd, spent_usd, current_round, max_rounds, factor_definitions, prompts, results_summary, created_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (expErr) {
    console.error('Failed to fetch experiments:', expErr.message);
  } else if (!experiments || experiments.length === 0) {
    console.log('  No automated experiments found.');
  } else {
    for (const exp of experiments as ExperimentRow[]) {
      console.log(`\n  Experiment: ${exp.name}`);
      console.log(`    Status: ${exp.status} | Target: ${exp.optimization_target}`);
      console.log(`    Budget: $${exp.total_budget_usd} (spent: $${exp.spent_usd})`);
      console.log(`    Rounds: ${exp.current_round}/${exp.max_rounds}`);
      console.log(`    Prompts: ${exp.prompts.length}`);
      console.log(`    Factors: ${Object.keys(exp.factor_definitions).join(', ')}`);

      if (exp.results_summary) {
        const summary = exp.results_summary as Record<string, unknown>;
        console.log(`    Results: bestElo=${summary.bestElo}, reason=${summary.terminationReason}`);
        if (summary.factorRanking) {
          console.log('    Factor ranking:');
          for (const f of summary.factorRanking as Array<{ factorLabel: string; eloEffect: number }>) {
            console.log(`      ${f.factorLabel}: ${f.eloEffect > 0 ? '+' : ''}${Math.round(f.eloEffect)} Elo`);
          }
        }
      }

      // Fetch rounds
      const { data: rounds } = await supabase
        .from('evolution_experiment_rounds')
        .select('round_number, type, design, factor_definitions, locked_factors, analysis_results, status')
        .eq('experiment_id', exp.id)
        .order('round_number');

      if (rounds && rounds.length > 0) {
        for (const round of rounds as ExperimentRoundRow[]) {
          console.log(`\n    Round ${round.round_number} (${round.type}, ${round.design}): ${round.status}`);
          if (round.locked_factors && Object.keys(round.locked_factors).length > 0) {
            console.log(`      Locked: ${JSON.stringify(round.locked_factors)}`);
          }
          if (round.analysis_results) {
            const analysis = round.analysis_results as Record<string, unknown>;
            console.log(`      Completed: ${analysis.completedRuns}/${analysis.totalRuns} runs`);
            if (analysis.recommendations) {
              console.log('      Recommendations:');
              for (const rec of analysis.recommendations as string[]) {
                console.log(`        → ${rec}`);
              }
            }
          }
        }
      }
    }
  }

  // ── 6. Hall of Fame cross-method comparison ────────────────────
  printSection('6. Hall of Fame Cross-Method Comparison');

  const { data: hofEntries, error: hofErr } = await supabase
    .from('evolution_hall_of_fame_entries')
    .select('id, topic_id, generation_method, total_cost_usd, model, evolution_run_id')
    .is('deleted_at', null)
    .limit(10000);

  const { data: hofElos, error: hofEloErr } = await supabase
    .from('evolution_hall_of_fame_elo')
    .select('entry_id, topic_id, elo_rating, elo_per_dollar, mu, sigma, match_count')
    .limit(10000);

  if (hofErr || hofEloErr) {
    console.error('Failed to fetch hall of fame data:', hofErr?.message ?? hofEloErr?.message);
  } else if (!hofEntries || hofEntries.length === 0) {
    console.log('  No hall of fame entries found.');
  } else {
    const hofAnalysis = analyzeHofEntries(hofEntries as HofEntryRow[], (hofElos ?? []) as HofEloRow[]);
    console.log(`  Total entries: ${hofEntries.length}`);
    console.log(`  Compared entries: ${(hofElos ?? []).length}`);
    console.log('');
    printTable(
      ['Method', 'Count', 'Compared', 'Avg Elo', 'Avg Cost'],
      hofAnalysis.map((h) => [h.method, String(h.count), String(h.comparedCount), String(h.avgElo), `$${h.avgCost}`]),
    );
  }

  // ── 7. Convergence patterns ────────────────────────────────────
  printSection('7. Convergence Patterns');

  const completedWithSummary = typedRuns.filter(
    (r) => r.status === 'completed' && r.run_summary != null,
  );

  if (completedWithSummary.length === 0) {
    console.log('  No completed runs with summaries found.');
  } else {
    const byStopReason = new Map<string, { iterations: number[]; costs: number[]; elos: number[] }>();
    for (const run of completedWithSummary) {
      const reason = extractStopReason(run.run_summary) ?? 'unknown';
      if (!byStopReason.has(reason)) {
        byStopReason.set(reason, { iterations: [], costs: [], elos: [] });
      }
      const group = byStopReason.get(reason)!;
      group.iterations.push(run.current_iteration ?? 0);
      group.costs.push(Number(run.total_cost_usd ?? 0));
      const elo = extractTopElo(run.run_summary);
      if (elo != null) group.elos.push(elo);
    }

    printTable(
      ['Stop Reason', 'Count', 'Avg Iters', 'Avg Cost', 'Avg Elo'],
      Array.from(byStopReason.entries()).map(([reason, data]) => [
        reason,
        String(data.iterations.length),
        avg(data.iterations).toFixed(1),
        `$${avg(data.costs).toFixed(2)}`,
        data.elos.length > 0 ? avg(data.elos).toFixed(0) : 'N/A',
      ]),
    );

    // Baseline rank distribution
    const baselineRanks = completedWithSummary
      .map((r) => extractBaselineRank(r.run_summary))
      .filter((r): r is number => r != null);
    if (baselineRanks.length > 0) {
      const avgRank = avg(baselineRanks);
      const improvedCount = baselineRanks.filter((r) => r > 1).length;
      console.log(`\n  Baseline displacement: ${improvedCount}/${baselineRanks.length} runs improved on baseline (avg rank: ${avgRank.toFixed(1)})`);
    }
  }

  // ── 8. Recommendations ─────────────────────────────────────────
  printSection('8. Follow-Up Experiment Recommendations');

  console.log('  Based on the data above, consider:');
  console.log('  1. Run L8 screening experiment if no formal experiments exist');
  console.log('  2. Compare generation models: deepseek-chat vs gpt-5-mini vs gpt-4.1-mini');
  console.log('  3. Test judge model impact: cheap (gpt-5-nano) vs expensive (gpt-4.1-nano)');
  console.log('  4. Find optimal iteration count: 3, 5, 8, 12 iterations');
  console.log('  5. Test agent configurations: minimal vs full agent suite');
  console.log('  6. Compare editing approaches: iterativeEditing vs treeSearch');
  console.log('');
  console.log('  Use: npx tsx scripts/run-strategy-experiment.ts plan --round 1');
  console.log('  Or:  Start experiment from /admin/quality/optimization → Experiments tab');
}

// Only run when executed directly (not when imported by tests).
if (process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
