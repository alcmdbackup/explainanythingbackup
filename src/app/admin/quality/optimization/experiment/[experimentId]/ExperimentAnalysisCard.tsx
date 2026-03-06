// Structured display for experiment analysis results.
// Renders main effects table, factor rankings, and recommendations.

'use client';

import type { ExperimentStatus } from '@evolution/services/experimentActions';

interface ExperimentAnalysisCardProps {
  experiment: ExperimentStatus;
}

interface ManualRunResult {
  runId: string;
  configLabel: string;
  elo: number | null;
  cost: number;
  'eloPer$': number | null;
}

interface ManualAnalysis {
  type: 'manual';
  runs: ManualRunResult[];
  completedRuns: number;
  totalRuns: number;
  warnings: string[];
}

function isManualAnalysis(a: unknown): a is ManualAnalysis {
  return !!a && typeof a === 'object' && (a as Record<string, unknown>).type === 'manual';
}

function ManualAnalysisView({ analysis }: { analysis: ManualAnalysis }) {
  return (
    <div className="border border-[var(--border-default)] rounded-page overflow-hidden bg-[var(--surface-secondary)]">
      <div className="p-3 space-y-3">
        <h5 className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Run Comparison ({analysis.completedRuns}/{analysis.totalRuns} completed)
        </h5>
        <table className="w-full text-xs font-ui" data-testid="manual-runs-table">
          <thead>
            <tr className="text-[var(--text-muted)] border-b border-[var(--border-default)]">
              <th className="text-left py-1 pr-4">Config</th>
              <th className="text-right py-1 pr-4">Elo</th>
              <th className="text-right py-1 pr-4">Cost</th>
              <th className="text-right py-1">Elo/$</th>
            </tr>
          </thead>
          <tbody>
            {analysis.runs
              .slice()
              .sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0))
              .map((run) => (
                <tr key={run.runId} className="border-b border-[var(--border-default)] last:border-0">
                  <td className="py-1.5 pr-4 font-medium text-[var(--text-primary)]">{run.configLabel}</td>
                  <td className="py-1.5 pr-4 text-right font-mono text-[var(--text-secondary)]">
                    {run.elo != null ? run.elo.toFixed(0) : '—'}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono text-[var(--text-secondary)]">
                    ${run.cost.toFixed(3)}
                  </td>
                  <td className="py-1.5 text-right font-mono text-[var(--text-secondary)]">
                    {run['eloPer$'] != null ? run['eloPer$'].toFixed(0) : '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {analysis.warnings.length > 0 && (
          <div className="p-2 bg-[var(--status-warning)]/10 border border-[var(--status-warning)] rounded-page">
            <ul className="list-disc list-inside space-y-0.5 text-xs font-body text-[var(--status-warning)]">
              {analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function ExperimentAnalysisCard({ experiment }: ExperimentAnalysisCardProps) {
  const analysis = experiment.analysisResults;

  if (!analysis) {
    return (
      <div className="p-3 text-xs font-body text-[var(--text-muted)]">
        {['completed', 'failed', 'cancelled'].includes(experiment.status)
          ? 'No analysis results available.'
          : 'Analysis pending.'}
      </div>
    );
  }

  if (isManualAnalysis(analysis)) {
    return <ManualAnalysisView analysis={analysis} />;
  }

  // Legacy or unrecognized analysis format
  return (
    <div className="p-3 text-xs font-body text-[var(--text-muted)]">
      Analysis data available but format not recognized.
    </div>
  );
}
