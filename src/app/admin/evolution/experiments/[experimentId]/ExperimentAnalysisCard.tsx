// Analysis card for experiment detail: shows V2 experiment metrics table.
// Metrics are pre-computed by getExperimentAction and passed via the experiment prop.

'use client';

import { MetricGrid } from '@evolution/components/evolution';
import { TacticPromptPerformanceTable } from '@evolution/components/evolution/tabs/TacticPromptPerformanceTable';
import type { V2Experiment } from './ExperimentDetailContent';

interface ExperimentAnalysisCardProps {
  experiment: V2Experiment;
}

function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v == null) return '--';
  return v.toFixed(decimals);
}

export function ExperimentAnalysisCard({ experiment }: ExperimentAnalysisCardProps) {
  const { metrics } = experiment;

  if (!metrics || metrics.runs.length === 0) {
    return (
      <div className="p-3 text-xs font-body text-[var(--text-muted)]">
        {['completed', 'failed', 'cancelled'].includes(experiment.status)
          ? 'No analysis results available.'
          : 'Analysis will be available once runs complete.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <MetricGrid
        columns={5}
        variant="card"
        metrics={[
          { label: 'Completed Runs', value: String(metrics.runs.length) },
          { label: 'Total Cost', value: `$${metrics.totalCost.toFixed(2)}` },
          { label: 'Best Elo', value: fmtNum(metrics.maxElo) },
          // Phase 4d: aggregate CI for mean Elo across runs in this experiment.
          // Shown only when ≥2 runs have a recorded Elo — ± SE = sample stddev / sqrt(n).
          {
            label: 'Mean Elo ± SE',
            value: metrics.meanElo == null
              ? '--'
              : metrics.seElo != null
                ? `${Math.round(metrics.meanElo)} ± ${Math.round(metrics.seElo)}`
                : String(Math.round(metrics.meanElo)),
          },
          { label: 'Best Elo/$', value: fmtNum(
            metrics.runs.reduce<number | null>((best, r) => {
              if (r.eloPerDollar == null) return best;
              return best == null ? r.eloPerDollar : Math.max(best, r.eloPerDollar);
            }, null),
            0,
          ) },
        ]}
      />

      {/* Per-run table */}
      <div className="border border-[var(--border-default)] rounded-page overflow-hidden bg-[var(--surface-secondary)]">
        <div className="p-3">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-ui" data-testid="metrics-v2-table">
              <thead>
                <tr className="text-[var(--text-muted)] border-b border-[var(--border-default)]">
                  <th className="text-left py-1 pr-2">Run</th>
                  <th className="text-right py-1 pr-2">Elo</th>
                  <th className="text-right py-1 pr-2">Cost</th>
                  <th className="text-right py-1">Elo/$</th>
                </tr>
              </thead>
              <tbody>
                {metrics.runs
                  .slice()
                  .sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0))
                  .map((run) => {
                    // Phase 4b: per-run Elo ± uncertainty when winner variant's mu/sigma are available.
                    const eloLabel = run.elo == null
                      ? '--'
                      : run.uncertainty != null && run.uncertainty > 0
                        ? `${Math.round(run.elo)} ± ${Math.round(1.96 * run.uncertainty)}`
                        : fmtNum(run.elo);
                    return (
                    <tr key={run.runId} className="border-b border-[var(--border-default)] last:border-0">
                      <td className="py-1.5 pr-2 font-mono text-[var(--text-primary)]">{run.runId.slice(0, 8)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">{eloLabel}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">${fmtNum(run.cost, 3)}</td>
                      <td className="py-1.5 text-right font-mono text-[var(--text-secondary)]">{fmtNum(run.eloPerDollar)}</td>
                    </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Tactic Breakdown — shows which tactics perform best for this experiment's prompt */}
      {experiment.prompt_id && (
        <div className="border border-[var(--border-default)] rounded-page overflow-hidden bg-[var(--surface-secondary)]">
          <div className="p-3">
            <h3 className="text-xs font-ui font-semibold text-[var(--text-primary)] mb-2">Tactic Breakdown</h3>
            <TacticPromptPerformanceTable promptId={experiment.prompt_id} />
          </div>
        </div>
      )}
    </div>
  );
}

