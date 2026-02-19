/**
 * Strategy detail view showing run history and performance over time.
 * Opens as a modal/panel when clicking on a strategy in the leaderboard.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getStrategyRunsAction,
  type StrategyLeaderboardEntry,
  type StrategyRunEntry,
} from '@evolution/services/eloBudgetActions';
import { buildRunUrl, buildExplanationUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatElo, formatCostDetailed } from '@evolution/lib/utils/formatters';
import { StrategyConfigDisplay } from './StrategyConfigDisplay';

interface StrategyDetailProps {
  strategy: StrategyLeaderboardEntry;
  onClose: () => void;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatDate(date: Date | null): string {
  if (!date) return '-';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  const colors = {
    completed: 'bg-[var(--status-success)]/20 text-[var(--status-success)]',
    failed: 'bg-[var(--status-error)]/20 text-[var(--status-error)]',
    running: 'bg-[var(--status-info)]/20 text-[var(--status-info)]',
    pending: 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]',
  };

  return (
    <span className={`px-2 py-0.5 rounded-page text-xs font-ui ${colors[status as keyof typeof colors] ?? colors.pending}`}>
      {status}
    </span>
  );
}

export function StrategyDetail({ strategy, onClose }: StrategyDetailProps) {
  const [runs, setRuns] = useState<StrategyRunEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await getStrategyRunsAction(strategy.id);
      if (result.success && result.data) {
        setRuns(result.data);
      } else {
        setError(result.error ?? 'Failed to load runs');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [strategy.id]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // Calculate summary stats
  const avgElo = runs.length > 0
    ? runs.filter(r => r.finalElo).reduce((s, r) => s + (r.finalElo ?? 0), 0) / runs.filter(r => r.finalElo).length
    : null;
  const avgCost = runs.length > 0
    ? runs.reduce((s, r) => s + r.totalCostUsd, 0) / runs.length
    : null;
  const avgDuration = runs.filter(r => r.duration).length > 0
    ? runs.filter(r => r.duration).reduce((s, r) => s + (r.duration ?? 0), 0) / runs.filter(r => r.duration).length
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="bg-[var(--surface-secondary)] paper-texture w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <CardHeader className="flex-shrink-0 border-b border-[var(--border-default)]">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-xl font-display text-[var(--text-primary)]">
                {strategy.name}
              </CardTitle>
              <p className="text-sm font-ui text-[var(--text-muted)] mt-1">
                {strategy.label}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--surface-elevated)] rounded-page transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-4 mt-4">
            <div className="bg-[var(--surface-elevated)] rounded-page p-3">
              <div className="text-xs font-ui text-[var(--text-muted)]">Runs</div>
              <div className="text-lg font-display font-bold text-[var(--text-primary)]">{strategy.runCount}</div>
            </div>
            <div className="bg-[var(--surface-elevated)] rounded-page p-3">
              <div className="text-xs font-ui text-[var(--text-muted)]">Avg Elo</div>
              <div className="text-lg font-display font-bold text-[var(--text-primary)]">
                {avgElo != null ? formatElo(avgElo) : '-'}
              </div>
            </div>
            <div className="bg-[var(--surface-elevated)] rounded-page p-3">
              <div className="text-xs font-ui text-[var(--text-muted)]">Avg Cost</div>
              <div className="text-lg font-display font-bold text-[var(--text-primary)]">
                {avgCost != null ? formatCostDetailed(avgCost) : '-'}
              </div>
            </div>
            <div className="bg-[var(--surface-elevated)] rounded-page p-3">
              <div className="text-xs font-ui text-[var(--text-muted)]">Avg Duration</div>
              <div className="text-lg font-display font-bold text-[var(--text-primary)]">
                {formatDuration(avgDuration ? Math.round(avgDuration) : null)}
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-auto p-0">
          {/* Config display */}
          <div className="p-4 border-b border-[var(--border-default)]">
            <StrategyConfigDisplay config={strategy.config} />
          </div>

          {/* Run history */}
          <div className="p-4">
            <h3 className="font-display text-sm font-medium text-[var(--text-primary)] mb-3">
              Run History
            </h3>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center gap-2 text-[var(--text-muted)]">
                  <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
                  <span className="font-ui">Loading runs...</span>
                </div>
              </div>
            ) : error ? (
              <div className="text-center py-8 text-[var(--status-error)] font-body">
                {error}
              </div>
            ) : runs.length === 0 ? (
              <div className="text-center py-8 text-[var(--text-muted)] font-body">
                No runs found for this strategy.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--surface-elevated)]">
                    <tr>
                      <th className="p-2 text-left font-ui text-xs text-[var(--text-muted)]">Date</th>
                      <th className="p-2 text-left font-ui text-xs text-[var(--text-muted)]">Topic</th>
                      <th className="p-2 text-center font-ui text-xs text-[var(--text-muted)]">Status</th>
                      <th className="p-2 text-right font-ui text-xs text-[var(--text-muted)]">Elo</th>
                      <th className="p-2 text-right font-ui text-xs text-[var(--text-muted)]">Cost</th>
                      <th className="p-2 text-right font-ui text-xs text-[var(--text-muted)]">Iters</th>
                      <th className="p-2 text-right font-ui text-xs text-[var(--text-muted)]">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr
                        key={run.runId}
                        className="border-t border-[var(--border-default)] hover:bg-[var(--surface-elevated)] transition-colors"
                      >
                        <td className="p-2 font-mono text-xs text-[var(--text-secondary)]">
                          <Link
                            href={buildRunUrl(run.runId)}
                            className="text-[var(--accent-gold)] hover:underline"
                            title={`Run ${run.runId}`}
                          >
                            {formatDate(run.startedAt)}
                          </Link>
                        </td>
                        <td className="p-2 font-ui text-[var(--text-primary)] max-w-[200px] truncate">
                          {run.explanationId ? (
                            <Link
                              href={buildExplanationUrl(run.explanationId)}
                              className="hover:text-[var(--accent-gold)] hover:underline"
                            >
                              {run.explanationTitle}
                            </Link>
                          ) : (
                            run.explanationTitle
                          )}
                        </td>
                        <td className="p-2 text-center">
                          <StatusBadge status={run.status} />
                        </td>
                        <td className="p-2 text-right font-mono text-[var(--text-secondary)]">
                          {run.finalElo != null ? formatElo(run.finalElo) : '-'}
                        </td>
                        <td className="p-2 text-right font-mono text-[var(--text-secondary)]">
                          {formatCostDetailed(run.totalCostUsd)}
                        </td>
                        <td className="p-2 text-right font-mono text-[var(--text-muted)]">
                          {run.iterations}
                        </td>
                        <td className="p-2 text-right font-mono text-[var(--text-muted)]">
                          {formatDuration(run.duration)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
