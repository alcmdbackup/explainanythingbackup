'use client';
// Run-detail tab: renders iteration_snapshots from the run row as collapsible per-iteration
// groups with start/end pool tables and (for generate iterations) a discarded variants section.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getRunSnapshotsAction,
  type IterationSnapshotRow,
  type SnapshotVariantInfo,
} from '@evolution/services/evolutionActions';
import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatEloCIRange } from '@evolution/lib/utils/formatters';

interface SnapshotsTabProps {
  runId: string;
}

interface VariantRow {
  id: string;
  shortId: string;
  agentName: string;
  elo: number;
  uncertainty: number;
  matchCount: number;
  persisted: boolean;
}

function buildRows(
  snap: IterationSnapshotRow,
  info: Record<string, SnapshotVariantInfo>,
): VariantRow[] {
  return (snap.poolVariantIds ?? []).map((id) => {
    const r = snap.ratings?.[id] ?? { elo: 1200, uncertainty: 400 / 3 };
    const v = info[id];
    return {
      id,
      shortId: id.substring(0, 8),
      agentName: v?.agentName ?? '—',
      elo: r.elo,
      uncertainty: r.uncertainty,
      matchCount: snap.matchCounts?.[id] ?? 0,
      persisted: v?.persisted ?? true,
    };
  }).sort((a, b) => b.elo - a.elo);
}

function VariantTable({ rows }: { rows: VariantRow[] }): JSX.Element {
  if (rows.length === 0) {
    return <p className="text-xs text-[var(--text-muted)] italic">(empty pool)</p>;
  }
  return (
    <div className="overflow-x-auto border border-[var(--border-default)] rounded-page">
      <table className="w-full text-xs font-mono">
        <thead className="bg-[var(--surface-elevated)]">
          <tr>
            <th className="px-2 py-1 text-left">Variant</th>
            <th className="px-2 py-1 text-left">Strategy</th>
            <th className="px-2 py-1 text-right" title="Elo ± rating uncertainty">Elo</th>
            <th className="px-2 py-1 text-right" title="95% CI = Elo ± 1.96 × uncertainty">95% CI</th>
            <th className="px-2 py-1 text-right">Matches</th>
            <th className="px-2 py-1 text-center">Persisted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)]">
              <td className="px-2 py-1">
                <Link
                  href={buildVariantDetailUrl(r.id)}
                  className="text-[var(--accent-gold)] hover:underline"
                  title={r.id}
                >
                  {r.shortId}
                </Link>
              </td>
              <td className="px-2 py-1 text-[var(--text-secondary)]">{r.agentName}</td>
              <td className="px-2 py-1 text-right">{`${Math.round(r.elo)} ± ${Math.round(r.uncertainty)}`}</td>
              <td className="px-2 py-1 text-right text-[var(--text-muted)]">{formatEloCIRange(r.elo, r.uncertainty) ?? '—'}</td>
              <td className="px-2 py-1 text-right text-[var(--text-muted)]">{r.matchCount}</td>
              <td className="px-2 py-1 text-center">
                {r.persisted ? (
                  <span className="text-[var(--status-success)]">✓</span>
                ) : (
                  <span className="text-[var(--status-error)]">✗</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SnapshotsTab({ runId }: SnapshotsTabProps): JSX.Element {
  const [snapshots, setSnapshots] = useState<IterationSnapshotRow[]>([]);
  const [variantInfo, setVariantInfo] = useState<Record<string, SnapshotVariantInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const result = await getRunSnapshotsAction(runId);
      if (result.success && result.data) {
        setSnapshots(result.data.snapshots);
        setVariantInfo(result.data.variantInfo);
        // Expand the first iteration by default for quick overview.
        if (result.data.snapshots.length > 0) {
          setExpanded(new Set([result.data.snapshots[0]!.iteration]));
        }
      } else {
        setError(result.error?.message ?? 'Failed to load snapshots');
      }
      setLoading(false);
    })();
  }, [runId]);

  if (loading) return <div className="h-64 bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;
  if (snapshots.length === 0) {
    return (
      <div className="text-[var(--text-muted)] text-sm p-4" data-testid="snapshots-tab-empty">
        No iteration snapshots recorded for this run.
      </div>
    );
  }

  // Group snapshots by iteration number for collapsible per-iteration display.
  const byIteration = new Map<number, IterationSnapshotRow[]>();
  for (const s of snapshots) {
    const arr = byIteration.get(s.iteration) ?? [];
    arr.push(s);
    byIteration.set(s.iteration, arr);
  }

  const toggle = (iter: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(iter)) next.delete(iter);
      else next.add(iter);
      return next;
    });

  return (
    <div className="space-y-3" data-testid="snapshots-tab">
      {Array.from(byIteration.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([iter, snaps]) => {
          const isOpen = expanded.has(iter);
          const start = snaps.find((s) => s.phase === 'start');
          const end = snaps.find((s) => s.phase === 'end');
          const iterType = (start ?? end)?.iterationType ?? 'generate';
          return (
            <div
              key={iter}
              className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)]"
              data-testid={`snapshot-iteration-${iter}`}
            >
              <button
                type="button"
                onClick={() => toggle(iter)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--surface-secondary)]"
              >
                <span className="font-ui text-sm font-semibold text-[var(--text-primary)]">
                  {isOpen ? '▼' : '▶'} Iteration {iter} — {iterType}
                </span>
                <span className="text-xs font-ui text-[var(--text-muted)]">
                  {snaps.length} snapshot{snaps.length === 1 ? '' : 's'}
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 space-y-4">
                  {start && (
                    <div>
                      <p className="text-xs font-ui font-semibold text-[var(--text-secondary)] mb-1">
                        START — {start.capturedAt}
                      </p>
                      <VariantTable rows={buildRows(start, variantInfo)} />
                    </div>
                  )}
                  {end && (
                    <div>
                      <p className="text-xs font-ui font-semibold text-[var(--text-secondary)] mb-1">
                        END — {end.capturedAt}
                      </p>
                      <VariantTable rows={buildRows(end, variantInfo)} />
                      {end.discardedVariantIds && end.discardedVariantIds.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-ui font-semibold text-[var(--status-error)] mb-1">
                            Discarded during iteration {iter} ({end.discardedVariantIds.length})
                          </p>
                          <div className="overflow-x-auto border border-[var(--border-default)] rounded-page">
                            <table className="w-full text-xs font-mono">
                              <thead className="bg-[var(--surface-elevated)]">
                                <tr>
                                  <th className="px-2 py-1 text-left">Variant</th>
                                  <th className="px-2 py-1 text-right">Local Elo</th>
                                  <th className="px-2 py-1 text-right">Top-15 Cutoff</th>
                                </tr>
                              </thead>
                              <tbody>
                                {end.discardedVariantIds.map((id) => {
                                  const reason = end.discardReasons?.[id];
                                  return (
                                    <tr key={id} className="border-t border-[var(--border-default)]">
                                      <td className="px-2 py-1">
                                        <Link
                                          href={buildVariantDetailUrl(id)}
                                          className="text-[var(--accent-gold)] hover:underline"
                                          title={id}
                                        >
                                          {id.substring(0, 8)}
                                        </Link>
                                      </td>
                                      <td className="px-2 py-1 text-right">
                                        {reason?.elo != null ? Math.round(reason.elo) : '—'}
                                      </td>
                                      <td className="px-2 py-1 text-right">
                                        {reason?.top15Cutoff != null ? Math.round(reason.top15Cutoff) : '—'}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
