// Builds a structured prompt for LLM-generated experiment analysis reports.
// Extracted to a separate file for unit testing of prompt construction.

import type { AllowedLLMModelType } from '@/lib/schemas/schemas';

/** Shared model constant — used by both cron and server action. */
export const REPORT_MODEL: AllowedLLMModelType = 'gpt-4.1-nano';

export interface ExperimentReportInput {
  experiment: Record<string, unknown>;
  runs: Record<string, unknown>[];
  agentMetrics: Record<string, unknown>[];
  resultsSummary: Record<string, unknown> | null;
}

export function buildExperimentReportPrompt(input: ExperimentReportInput): string {
  const exp = input.experiment;
  const lines: string[] = [];

  lines.push('You are an experiment analysis expert. Analyze this factorial experiment and write a concise report.');
  lines.push('');
  lines.push(`EXPERIMENT: ${exp.name ?? 'Unknown'}, target: ${exp.optimization_target ?? 'elo'}, budget: $${Number(exp.total_budget_usd ?? 0).toFixed(2)} / $${Number(exp.spent_usd ?? 0).toFixed(2)} spent`);
  lines.push(`STATUS: ${exp.status ?? 'unknown'}, design: ${exp.design ?? 'L8'}`);

  const summary = input.resultsSummary;
  if (summary?.terminationReason) {
    lines.push(`TERMINATION: ${summary.terminationReason}`);
  }

  // Factor definitions
  const factors = exp.factor_definitions as Record<string, { low: unknown; high: unknown }> | null;
  if (factors && Object.keys(factors).length > 0) {
    lines.push('');
    lines.push('FACTOR DEFINITIONS:');
    for (const [key, def] of Object.entries(factors)) {
      lines.push(`  ${key}: low=${String(def?.low ?? '?')}, high=${String(def?.high ?? '?')}`);
    }
  }

  // Analysis results (from experiment directly)
  const analysisResults = exp.analysis_results as Record<string, unknown> | null;
  if (analysisResults) {
    lines.push('');
    lines.push('ANALYSIS RESULTS:');
    const mainEffects = analysisResults.mainEffects as Record<string, { effect: number }> | undefined;
    if (mainEffects) {
      const sorted = Object.entries(mainEffects).sort(([, a], [, b]) => Math.abs(b.effect) - Math.abs(a.effect));
      lines.push(`  Main Effects: ${sorted.map(([f, d]) => `${f}=${d.effect > 0 ? '+' : ''}${d.effect.toFixed(2)}`).join(', ')}`);
    }
    const rankings = analysisResults.factorRanking as Array<{ factor: string; importance: number }> | undefined;
    if (rankings) {
      lines.push(`  Factor Rankings: ${rankings.map((r, i) => `#${i + 1} ${r.factor}`).join(', ')}`);
    }
    const recs = analysisResults.recommendations as string[] | undefined;
    if (recs && recs.length > 0) {
      lines.push(`  Recommendations: ${recs.join('; ')}`);
    }
  }

  // Top runs
  if (input.runs.length > 0) {
    lines.push('');
    lines.push('RUN RESULTS (sample):');
    const sampleRuns = input.runs.slice(0, 15);
    for (const run of sampleRuns) {
      const cost = run.total_cost_usd ? `$${Number(run.total_cost_usd).toFixed(3)}` : 'n/a';
      lines.push(`  Run ${String(run.id ?? '?').slice(0, 8)}: status=${run.status ?? '?'}, cost=${cost}`);
    }
  }

  // Agent metrics
  if (input.agentMetrics.length > 0) {
    lines.push('');
    lines.push('AGENT PERFORMANCE:');
    // Aggregate by agent name
    const byAgent = new Map<string, { totalCost: number; count: number; totalEloGain: number }>();
    for (const m of input.agentMetrics) {
      const name = String(m.agent_name ?? 'unknown');
      const entry = byAgent.get(name) ?? { totalCost: 0, count: 0, totalEloGain: 0 };
      entry.totalCost += Number(m.cost_usd ?? 0);
      entry.count += 1;
      entry.totalEloGain += Number(m.elo_gain ?? 0);
      byAgent.set(name, entry);
    }
    for (const [name, stats] of byAgent) {
      lines.push(`  ${name}: total_cost=$${stats.totalCost.toFixed(3)}, entries=${stats.count}, total_elo_gain=${stats.totalEloGain.toFixed(1)}`);
    }
  }

  // Best result
  if (summary) {
    lines.push('');
    lines.push('BEST RESULT:');
    lines.push(`  Elo: ${summary.bestElo ?? 'n/a'}`);
    if (summary.bestConfig) {
      lines.push(`  Config: ${JSON.stringify(summary.bestConfig).slice(0, 500)}`);
    }
  }

  lines.push('');
  lines.push('Write a report with these sections:');
  lines.push('## Executive Summary');
  lines.push('2-3 sentences summarizing the experiment outcome.');
  lines.push('## Key Findings');
  lines.push('What factors matter most and why.');
  lines.push('## Optimal Configuration');
  lines.push('The winning setup and why it works.');
  lines.push('## Cost Efficiency Analysis');
  lines.push('Budget usage, agent ROI.');
  lines.push('## Recommendations');
  lines.push('Actionable next steps.');
  lines.push('');
  lines.push('Be specific with numbers. Reference actual Elo scores, effect sizes, and costs.');

  return lines.join('\n');
}
