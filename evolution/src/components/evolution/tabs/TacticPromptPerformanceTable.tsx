// Shared table showing tactic × prompt performance.
// Used on tactic detail "By Prompt" tab (filtered by tacticName) and prompt detail "Tactics" tab (filtered by promptId).

'use client';

import { useState, useEffect } from 'react';
import { getTacticPromptPerformanceAction, type TacticPromptPerformanceRow } from '@evolution/services/tacticPromptActions';
import { TACTIC_PALETTE } from '@evolution/lib/core/tactics';
import { formatCost } from '@evolution/lib/utils/formatters';
import Link from 'next/link';

interface Props {
  /** Filter by tactic name (for tactic detail page). */
  tacticName?: string;
  /** Filter by prompt ID (for prompt detail page). */
  promptId?: string;
}

export function TacticPromptPerformanceTable({ tacticName, promptId }: Props) {
  const [rows, setRows] = useState<TacticPromptPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getTacticPromptPerformanceAction({ tacticName, promptId })
      .then((result) => {
        if (result.success && result.data) {
          setRows(result.data);
        } else {
          setError(result.error?.message ?? 'Failed to load');
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Unknown error'))
      .finally(() => setLoading(false));
  }, [tacticName, promptId]);

  if (loading) return <div className="text-sm text-[var(--text-muted)] p-4">Loading performance data...</div>;
  if (error) return <div className="text-sm text-[var(--status-error)] p-4">{error}</div>;
  if (rows.length === 0) return <div className="text-sm text-[var(--text-muted)] p-4">No performance data yet. Run experiments to populate.</div>;

  // Show tactic column when filtering by prompt, prompt column when filtering by tactic
  const showTacticColumn = !!promptId;
  const showPromptColumn = !!tacticName;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-muted)]">
            {showTacticColumn && <th className="px-3 py-2">Tactic</th>}
            {showPromptColumn && <th className="px-3 py-2">Prompt</th>}
            <th className="px-3 py-2">Runs</th>
            <th className="px-3 py-2">Variants</th>
            <th className="px-3 py-2">Avg Elo</th>
            <th className="px-3 py-2">Elo Delta</th>
            <th className="px-3 py-2">Best Elo</th>
            <th className="px-3 py-2">Winners</th>
            <th className="px-3 py-2">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.tacticName}-${row.promptId}`} className="border-b border-[var(--border-default)] hover:bg-[var(--surface-hover)]">
              {showTacticColumn && (
                <td className="px-3 py-2">
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: TACTIC_PALETTE[row.tacticName] ?? 'var(--text-muted)' }} />
                  <span className="font-mono text-xs">{row.tacticName}</span>
                </td>
              )}
              {showPromptColumn && (
                <td className="px-3 py-2">
                  <Link href={`/admin/evolution/prompts/${row.promptId}`} className="text-[var(--accent-gold)] hover:underline text-xs">
                    {row.promptName || row.promptId.substring(0, 8)}
                  </Link>
                </td>
              )}
              <td className="px-3 py-2 font-mono text-xs">{row.runs}</td>
              <td className="px-3 py-2 font-mono text-xs">{row.variants}</td>
              <td className="px-3 py-2 font-mono text-xs font-semibold">{row.avgElo}</td>
              <td className={`px-3 py-2 font-mono text-xs ${row.avgElo - 1200 >= 0 ? 'text-[var(--status-success)]' : 'text-[var(--status-error)]'}`}>
                {row.avgElo - 1200 >= 0 ? '+' : ''}{Math.round(row.avgElo - 1200)}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{row.bestElo}</td>
              <td className="px-3 py-2 font-mono text-xs">{row.winnerCount}</td>
              <td className="px-3 py-2 font-mono text-xs">{formatCost(row.totalCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
