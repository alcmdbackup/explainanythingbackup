// Structured display for experiment analysis results.
// Renders main effects table, factor rankings, and recommendations.

'use client';

import type { ExperimentStatus } from '@evolution/services/experimentActions';

interface ExperimentAnalysisCardProps {
  experiment: ExperimentStatus;
}

export function ExperimentAnalysisCard({ experiment }: ExperimentAnalysisCardProps) {
  const analysis = experiment.analysisResults as {
    mainEffects?: Record<string, { effect: number; low: number; high: number }>;
    factorRanking?: Array<{ factor: string; importance: number }>;
    recommendations?: string[];
    warnings?: string[];
    completedRuns?: number;
    totalRuns?: number;
  } | null;

  if (!analysis) {
    return (
      <div className="p-3 text-xs font-body text-[var(--text-muted)]">
        {['completed', 'failed', 'cancelled'].includes(experiment.status)
          ? 'No analysis results available.'
          : 'Analysis pending.'}
      </div>
    );
  }

  return (
    <div className="border border-[var(--border-default)] rounded-page overflow-hidden bg-[var(--surface-secondary)]">
      <div className="p-3 space-y-3">
        {analysis.mainEffects && Object.keys(analysis.mainEffects).length > 0 && (
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
                {Object.entries(analysis.mainEffects)
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

        {analysis.factorRanking && analysis.factorRanking.length > 0 && (
          <div>
            <h5 className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">
              Factor Rankings
            </h5>
            <div className="space-y-1" data-testid="factor-rankings">
              {analysis.factorRanking.map((item, i) => (
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

        {analysis.recommendations && analysis.recommendations.length > 0 && (
          <div>
            <h5 className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">
              Recommendations
            </h5>
            <ul className="list-disc list-inside space-y-0.5 text-xs font-body text-[var(--text-secondary)]" data-testid="recommendations">
              {analysis.recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>
        )}

        {analysis.warnings && analysis.warnings.length > 0 && (
          <div className="p-2 bg-[var(--status-warning)]/10 border border-[var(--status-warning)] rounded-page">
            <ul className="list-disc list-inside space-y-0.5 text-xs font-body text-[var(--status-warning)]" data-testid="warnings">
              {analysis.warnings.map((warn, i) => (
                <li key={i}>{warn}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
