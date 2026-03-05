// Manual experiment analysis: per-run comparison without factorial design.
// Computes Elo and Elo/$ for each run and returns a simple comparison table.

// ─── Manual Experiment Analysis ───────────────────────────────────

export interface ManualRunResult {
  runId: string;
  configLabel: string;
  elo: number | null;
  cost: number;
  eloPer$: number | null;
}

export interface ManualAnalysisResult {
  type: 'manual';
  runs: ManualRunResult[];
  completedRuns: number;
  totalRuns: number;
  warnings: string[];
}

/** Simple per-run comparison for manual experiments (no factorial analysis). */
export function computeManualAnalysis(
  dbRuns: Array<{
    id: string;
    status: string;
    total_cost_usd: number | null;
    run_summary: Record<string, unknown> | null;
    config: Record<string, unknown> | null;
  }>,
  extractEloFn: (summary: Record<string, unknown> | null) => number | null,
): ManualAnalysisResult {
  const warnings: string[] = [];
  const completed = dbRuns.filter(r => r.status === 'completed');

  if (completed.length < dbRuns.length) {
    const missing = dbRuns.length - completed.length;
    warnings.push(`${missing} of ${dbRuns.length} runs incomplete`);
  }

  const runs: ManualRunResult[] = dbRuns.map(r => {
    const config = r.config as Record<string, unknown> | null;
    const model = (config?.generationModel as string) ?? 'unknown';
    const judge = (config?.judgeModel as string) ?? '';
    const elo = extractEloFn(r.run_summary as Record<string, unknown> | null);
    const cost = Number(r.total_cost_usd) || 0;
    return {
      runId: r.id,
      configLabel: judge ? `${model} / ${judge}` : model,
      elo,
      cost,
      eloPer$: elo != null && cost > 0 ? (elo - 1200) / cost : null,
    };
  });

  return {
    type: 'manual',
    runs,
    completedRuns: completed.length,
    totalRuns: dbRuns.length,
    warnings,
  };
}
