// Shared table showing tactic × strategy performance. Renders on the strategy detail
// "Tactics" tab (Phase 4 of track_tactic_effectiveness_evolution_20260422).
//
// Mirrors the layout of TacticPromptPerformanceTable but groups by (agent_name, strategy_id)
// instead of (agent_name, prompt_id). Dual-source: pre-aggregated eloAttrDelta:* rows from
// evolution_metrics supply the Elo Delta + CI; live variant aggregates supply cost / variant
// count / winner count / win rate. See getStrategyTacticBreakdownAction for the merge logic
// and the eventual-consistency caveat for post-run arena drift.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getStrategyTacticBreakdownAction,
  type TacticStrategyPerformanceRow,
} from '@evolution/services/tacticStrategyActions';
import { TACTIC_PALETTE } from '@evolution/lib/core/tactics';
import { formatCost } from '@evolution/lib/utils/formatters';

interface Props {
  strategyId: string;
}

function formatEloDelta(delta: number | null, ciLower: number | null, ciUpper: number | null): string {
  if (delta == null) return '—';
  const rounded = Math.round(delta);
  const sign = rounded >= 0 ? '+' : '';
  if (ciLower != null && ciUpper != null) {
    return `${sign}${rounded} [${Math.round(ciLower)}, ${Math.round(ciUpper)}]`;
  }
  return `${sign}${rounded}`;
}

export function TacticStrategyPerformanceTable({ strategyId }: Props): JSX.Element {
  const [rows, setRows] = useState<TacticStrategyPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getStrategyTacticBreakdownAction({ strategyId })
      .then((result) => {
        if (result.success && result.data) {
          setRows(result.data);
        } else {
          setError(result.error?.message ?? 'Failed to load');
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Unknown error'))
      .finally(() => setLoading(false));
  }, [strategyId]);

  if (loading) {
    return <div className="text-sm text-[var(--text-muted)] p-4">Loading tactic breakdown…</div>;
  }
  if (error) {
    return <div className="text-sm text-[var(--status-error)] p-4">{error}</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="text-sm text-[var(--text-muted)] p-4">
        No tactic data yet. Run experiments on this strategy to populate.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-ui text-[var(--text-muted)]" data-testid="tactics-tab-caveat">
        Covers variant-producing tactics only — <code>eloAttrDelta</code> is emitted by
        {' '}<code>generate_from_previous_article</code> runs. Swiss / merge iterations are
        excluded (no attribution dimension). Rows where the Elo Delta column reads
        {' '}<strong>—</strong> are tactics that produced variants in this strategy before the
        attribution pipeline was wired (Phase 0 Blocker 2 fix); re-run to populate.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="strategy-tactics-table">
          <thead>
            <tr className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-muted)]">
              <th className="px-3 py-2">Tactic</th>
              <th className="px-3 py-2">Variants</th>
              <th className="px-3 py-2">Elo Delta [95% CI]</th>
              <th className="px-3 py-2">Win Rate</th>
              <th className="px-3 py-2">Winners</th>
              <th className="px-3 py-2">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.tacticName}
                className="border-b border-[var(--border-default)] hover:bg-[var(--surface-hover)]"
                data-testid={`tactic-row-${row.tacticName}`}
              >
                <td className="px-3 py-2">
                  {row.tacticId ? (
                    <Link
                      href={`/admin/evolution/tactics/${row.tacticId}`}
                      className="inline-flex items-center gap-1.5 text-[var(--accent-gold)] hover:underline font-mono text-xs"
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: TACTIC_PALETTE[row.tacticName] ?? 'var(--text-muted)' }}
                      />
                      {row.tacticName}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)] font-mono text-xs">
                      <span
                        aria-hidden="true"
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: TACTIC_PALETTE[row.tacticName] ?? 'var(--text-muted)' }}
                      />
                      {row.tacticName}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{row.variantCount}</td>
                <td
                  className={`px-3 py-2 font-mono text-xs ${
                    row.avgEloDelta == null
                      ? 'text-[var(--text-muted)]'
                      : row.avgEloDelta >= 0
                        ? 'text-[var(--status-success)]'
                        : 'text-[var(--status-error)]'
                  }`}
                >
                  {formatEloDelta(row.avgEloDelta, row.ciLower, row.ciUpper)}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{(row.winRate * 100).toFixed(1)}%</td>
                <td className="px-3 py-2 font-mono text-xs">{row.winnerCount}</td>
                <td className="px-3 py-2 font-mono text-xs">{formatCost(row.totalCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
