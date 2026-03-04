// Runs tab: displays all runs for an experiment in a flat table.
// Fetches run data via getExperimentRunsAction.

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { buildRunUrl, buildStrategyUrl } from '@evolution/lib/utils/evolutionUrls';
import {
  getExperimentRunsAction,
  type ExperimentRun,
} from '@evolution/services/experimentActions';

const RUN_STATUS_COLORS: Record<string, string> = {
  pending: 'var(--text-muted)',
  claimed: 'var(--accent-gold)',
  running: 'var(--accent-gold)',
  completed: 'var(--status-success)',
  failed: 'var(--status-error)',
};

interface RunsTabProps {
  experimentId: string;
}

export function RunsTab({ experimentId }: RunsTabProps) {
  const [runs, setRuns] = useState<ExperimentRun[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getExperimentRunsAction({ experimentId });
    if (result.success && result.data) {
      setRuns(result.data);
    }
    setLoading(false);
  }, [experimentId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-muted)] py-4">
        <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
        <span className="font-ui text-sm">Loading runs...</span>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <p className="text-sm font-body text-[var(--text-muted)] py-4">
        No runs yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-ui">
        <thead>
          <tr className="text-[var(--text-muted)] border-b border-[var(--border-default)]">
            <th className="text-left py-1 pr-3">Run ID</th>
            <th className="text-left py-1 pr-3">Status</th>
            <th className="text-right py-1 pr-3">Elo</th>
            <th className="text-right py-1 pr-3">Cost</th>
            <th className="text-left py-1 pr-3">Strategy</th>
            <th className="text-right py-1 pr-3">L8 Row</th>
            <th className="text-right py-1">Created</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const statusColor = RUN_STATUS_COLORS[run.status] ?? 'var(--text-muted)';
            return (
              <tr key={run.id} className="border-b border-[var(--border-default)] last:border-0">
                <td className="py-1.5 pr-3">
                  <Link
                    href={buildRunUrl(run.id)}
                    className="font-mono text-[var(--text-primary)] hover:text-[var(--accent-gold)] transition-colors"
                  >
                    {run.id.slice(0, 8)}&hellip;
                  </Link>
                </td>
                <td className="py-1.5 pr-3">
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded-full border"
                    style={{ color: statusColor, borderColor: statusColor }}
                  >
                    {run.status}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-[var(--text-secondary)]">
                  {run.eloScore != null ? run.eloScore.toFixed(0) : '—'}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-[var(--text-secondary)]">
                  {run.costUsd != null ? `$${run.costUsd.toFixed(3)}` : '—'}
                </td>
                <td className="py-1.5 pr-3">
                  {run.strategyConfigId ? (
                    <Link
                      href={buildStrategyUrl(run.strategyConfigId)}
                      className="font-mono text-xs text-[var(--text-secondary)] hover:text-[var(--accent-gold)] transition-colors"
                    >
                      {run.strategyConfigId.slice(0, 8)}&hellip;
                    </Link>
                  ) : '—'}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-[var(--text-muted)]">
                  {run.experimentRow ?? '—'}
                </td>
                <td className="py-1.5 text-right font-mono text-[var(--text-muted)]">
                  {new Date(run.createdAt).toLocaleDateString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
