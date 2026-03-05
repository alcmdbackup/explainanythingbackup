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

  const factorialAnalysis = analysis as {
    mainEffects?: Record<string, { effect: number; low: number; high: number }>;
    factorRanking?: Array<{ factor: string; importance: number }>;
    recommendations?: string[];
    warnings?: string[];
    completedRuns?: number;
    totalRuns?: number;
  };

  return (
    <div className="border border-[var(--border-default)] rounded-page overflow-hidden bg-[var(--surface-secondary)]">
      <div className="p-3 space-y-3">
        {factorialAnalysis.mainEffects && Object.keys(factorialAnalysis.mainEffects).length > 0 && (
          <div>
            <h5 className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">
              Main Effects
            </h5>
            <table className="w-full text-xs font-ui" data-testid="main-effects-table">
              <thead>
                <tr className="text-[var(--text-muted)] border-b border-[var(--border-default)]">
                  <th className="text-left py-1 pr-4">Factor</th>
                  <th className="text-right py-1 pr-4">Effect</th>
                  <th className="text-right py-1 pr-4">Low</th>
                  <th className="text-right py-1">High</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(factorialAnalysis.mainEffects!)
                  .sort(([, a], [, b]) => Math.abs(b.effect) - Math.abs(a.effect))
                  .map(([factor, data]) => (
                    <tr key={factor} className="border-b border-[var(--border-default)] last:border-0">
                      <td className="py-1 pr-4 font-medium text-[var(--text-primary)]">{factor}</td>
                      <td className="py-1 pr-4 text-right font-mono text-[var(--text-secondary)]">
                        {data.effect > 0 ? '↑' : '↓'} {Math.abs(data.effect).toFixed(2)}
                      </td>
                      <td className="py-1 pr-4 text-right font-mono text-[var(--text-secondary)]">
                        {data.low.toFixed(2)}
                      </td>
                      <td className="py-1 text-right font-mono text-[var(--text-secondary)]">
                        {data.high.toFixed(2)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {factorialAnalysis.factorRanking && factorialAnalysis.factorRanking.length > 0 && (
          <div>
            <h5 className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">
              Factor Rankings
            </h5>
            <div className="space-y-1" data-testid="factor-rankings">
              {factorialAnalysis.factorRanking.map((item, i) => (
                <div
                  key={item.factor}
                  className="flex items-center gap-2 text-xs font-ui"
                >
                  <span className="w-5 text-right font-mono text-[var(--accent-gold)]">
                    #{i + 1}
                  </span>
                  <span className="font-medium text-[var(--text-primary)]">{item.factor}</span>
                  <span className="font-mono text-[var(--text-muted)]">
                    ({item.importance.toFixed(2)})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {factorialAnalysis.recommendations && factorialAnalysis.recommendations.length > 0 && (
          <div>
            <h5 className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">
              Recommendations
            </h5>
            <ul className="list-disc list-inside space-y-0.5 text-xs font-body text-[var(--text-secondary)]" data-testid="recommendations">
              {factorialAnalysis.recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>
        )}

        {factorialAnalysis.warnings && factorialAnalysis.warnings.length > 0 && (
          <div className="p-2 bg-[var(--status-warning)]/10 border border-[var(--status-warning)] rounded-page">
            <ul className="list-disc list-inside space-y-0.5 text-xs font-body text-[var(--status-warning)]" data-testid="warnings">
              {factorialAnalysis.warnings.map((warn, i) => (
                <li key={i}>{warn}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
