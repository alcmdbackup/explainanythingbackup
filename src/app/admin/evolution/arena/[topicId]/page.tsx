// Arena topic detail page with leaderboard. Shows topic metadata, entries ranked by elo_score,
// 95% CI column, and top 15% eligibility cutoff indicator.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  EvolutionBreadcrumb,
  EntityDetailHeader,
  NotFoundCard,
  MetricGrid,
  EntityMetricsTab,
} from '@evolution/components/evolution';
import { getEntityMetricsAction } from '@evolution/services/metricsActions';
import {
  getArenaTopicDetailAction,
  getArenaEntriesAction,
  type ArenaTopic,
  type ArenaEntry,
} from '@evolution/services/arenaActions';
import { formatElo, stripMarkdownTitle } from '@evolution/lib/shared/computeRatings';
import { formatEloCIRange, formatEloWithUncertainty } from '@evolution/lib/utils/formatters';
import { computeEloCutoff } from './arenaCutoff';
import { bootstrapDeltaCI } from '@evolution/lib/shared/ratingDelta';
import { VariantParentBadge } from '@evolution/components/evolution/variant/VariantParentBadge';

function ContentLink({ entryId, content }: { entryId: string; content: string }): JSX.Element {
  const cleaned = stripMarkdownTitle(content);
  const label = cleaned.length > 60 ? `${cleaned.substring(0, 60)}…` : cleaned;
  return (
    <Link href={`/admin/evolution/variants/${entryId}`} className="text-[var(--accent-gold)] hover:underline">
      {label}
    </Link>
  );
}

export default function ArenaTopicDetailPage(): JSX.Element {
  const { topicId } = useParams<{ topicId: string }>();
  const PAGE_SIZE = 20;
  const [topic, setTopic] = useState<ArenaTopic | null>(null);
  const [entries, setEntries] = useState<ArenaEntry[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMetrics, setHasMetrics] = useState(false);

  // Sort state for leaderboard columns (F41)
  type SortKey = 'elo_score' | 'uncertainty' | 'arena_match_count' | 'generation_method' | 'cost_usd';
  const [sortKey, setSortKey] = useState<SortKey>('elo_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sortedEntries = useMemo(() => {
    const mult = sortDir === 'desc' ? -1 : 1;
    return [...entries].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;  // nulls always last
      if (bv == null) return -1;
      if (typeof av === 'string') return mult * av.localeCompare(bv as string);
      return mult * ((av as number) - (bv as number));
    });
  }, [entries, sortKey, sortDir]);

  // Elo-based rank (independent of current sort column)
  const eloRankMap = useMemo(() => {
    const byElo = [...entries].sort((a, b) => (b.elo_score ?? 0) - (a.elo_score ?? 0));
    return new Map(byElo.map((e, i) => [e.id, i + 1]));
  }, [entries]);

  // Top 15% eligibility cutoff
  const eloCutoff = useMemo(() => computeEloCutoff(entries), [entries]);

  // Anchor concept removed (Phase 9d, generate_rank_evolution_parallel_20260331).
  // The new opponent-selection formula in rankSingleVariant naturally prefers low-sigma
  // opponents via entropy/sigma^k scoring, so explicit "anchor" designation is unnecessary.

  const eligibleSet = useMemo(() => {
    if (eloCutoff == null) return null;
    return new Set(
      entries
        .filter(e => e.elo_score != null && e.elo_score >= eloCutoff)
        .map(e => e.id),
    );
  }, [entries, eloCutoff]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const totalPages = Math.ceil(totalEntries / PAGE_SIZE);

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  const sortableThProps = (key: SortKey) => ({
    className: 'py-2 pr-3 cursor-pointer select-none hover:text-[var(--text-primary)]',
    onClick: () => handleSort(key),
    onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort(key); } },
    tabIndex: 0,
    'aria-sort': (sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') as 'ascending' | 'descending' | 'none',
    role: 'columnheader' as const,
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      const offset = (page - 1) * PAGE_SIZE;
      const [topicResult, entriesResult, metricsResult] = await Promise.all([
        getArenaTopicDetailAction(topicId),
        getArenaEntriesAction({ topicId, limit: PAGE_SIZE, offset }),
        getEntityMetricsAction('prompt', topicId),
      ]);

      if (!topicResult.success || !topicResult.data) {
        setError(topicResult.error?.message ?? 'Failed to load topic');
        setLoading(false);
        return;
      }
      if (!entriesResult.success || !entriesResult.data) {
        setError(entriesResult.error?.message ?? 'Failed to load entries');
        setLoading(false);
        return;
      }

      setTopic(topicResult.data);
      setEntries(entriesResult.data.items);
      setTotalEntries(entriesResult.data.total);
      setHasMetrics(metricsResult.success && (metricsResult.data?.length ?? 0) > 0);
      setLoading(false);
    }
    load();
  }, [topicId, page]);

  if (loading) {
    return (
      <div className="p-8 text-center text-sm font-ui text-[var(--text-muted)]">Loading...</div>
    );
  }

  if (error || !topic) {
    return (
      <NotFoundCard
        entityType="Arena Topic"
        breadcrumbs={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Arena', href: '/admin/evolution/arena' },
        ]}
      />
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Arena', href: '/admin/evolution/arena' },
          { label: topic.name },
        ]}
      />

      <EntityDetailHeader title={topic.name} entityId={topic.id} />

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 space-y-4 shadow-warm-lg">
        <h2 className="text-2xl font-display font-bold text-[var(--text-primary)]">Topic Details</h2>
        <p className="text-sm font-ui text-[var(--text-secondary)] whitespace-pre-wrap">{topic.prompt}</p>
        <MetricGrid
          metrics={[
            { label: 'Status', value: topic.status },
            { label: 'Entries', value: totalEntries },
          ]}
          columns={2}
          variant="card"
        />
      </div>

      {hasMetrics && (
        <div>
          <h2 className="text-2xl font-display font-bold text-[var(--text-primary)] mb-3">Evolution Metrics</h2>
          <EntityMetricsTab entityType="prompt" entityId={topicId} />
        </div>
      )}

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 shadow-warm-lg">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-2xl font-display font-bold text-[var(--text-primary)]">Leaderboard</h2>
        </div>
        {eloCutoff != null && (
          <p className="text-xs font-ui text-[var(--text-muted)] mb-3" data-testid="cutoff-info">
            Top 15% cutoff: {formatElo(eloCutoff)} Elo. Entries below cutoff are dimmed.
          </p>
        )}
        {entries.length === 0 ? (
          <div className="text-sm font-ui text-[var(--text-muted)] text-center py-4">
            <p>No entries yet.</p>
            <p className="mt-1 text-xs">Entries are added automatically when variants compete in this topic.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-ui" data-testid="leaderboard-table">
              <thead>
                <tr className="text-left text-xs text-[var(--text-muted)] uppercase tracking-wide border-b border-[var(--border-default)]">
                  <th className="py-2 pr-3">Rank</th>
                  <th className="py-2 pr-3">Content</th>
                  <th {...sortableThProps('elo_score')}>Elo{sortIndicator('elo_score')}</th>
                  <th className="py-2 pr-3">95% CI</th>
                  <th {...sortableThProps('uncertainty')}>Elo ± Uncertainty{sortIndicator('uncertainty')}</th>
                  <th {...sortableThProps('arena_match_count')}>Matches{sortIndicator('arena_match_count')}</th>
                  <th className="py-2 pr-3">Iteration</th>
                  <th {...sortableThProps('generation_method')}>Method{sortIndicator('generation_method')}</th>
                  <th className="py-2 pr-3">Parent</th>
                  <th {...sortableThProps('cost_usd')}>Cost{sortIndicator('cost_usd')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry, index) => {
                  const isEligible = eligibleSet == null || eligibleSet.has(entry.id);
                  return (
                    <tr
                      key={entry.id}
                      data-testid={`lb-row-${index}`}
                      className={`border-b border-[var(--border-default)] last:border-0 hover:bg-[var(--surface-hover)]${isEligible ? '' : ' opacity-50'}`}
                    >
                      <td className="py-2 pr-3 font-mono text-[var(--text-muted)]">{eloRankMap.get(entry.id) ?? index + 1}</td>
                      <td className="py-2 pr-3">
                        <ContentLink entryId={entry.id} content={entry.variant_content} />
                      </td>
                      <td className="py-2 pr-3 font-mono">{formatElo(entry.elo_score)}</td>
                      <td className="py-2 pr-3 font-mono text-[var(--text-secondary)]">
                        {entry.elo_score != null && entry.uncertainty != null
                          ? (formatEloCIRange(entry.elo_score, entry.uncertainty) ?? '\u2014')
                          : '\u2014'}
                      </td>
                      <td className="py-2 pr-3 font-mono">
                        {entry.elo_score != null && entry.uncertainty != null
                          ? (formatEloWithUncertainty(entry.elo_score, entry.uncertainty) ?? '—')
                          : '—'}
                      </td>
                      <td className="py-2 pr-3 font-mono">{entry.arena_match_count}</td>
                      <td className="py-2 pr-3 font-mono text-[var(--text-muted)]">
                        {entry.generation != null ? entry.generation : '—'}
                      </td>
                      <td className="py-2 pr-3 text-[var(--text-secondary)]">
                        {entry.is_seed && (
                          <span className="inline-block mr-1 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider rounded bg-[var(--accent-gold)] text-[var(--surface-primary)]">
                            seed
                          </span>
                        )}
                        {entry.generation_method}
                      </td>
                      <td className="py-2 pr-3">
                        {(() => {
                          if (!entry.parent_variant_id) {
                            return (
                              <VariantParentBadge
                                parentId={null}
                                parentElo={null}
                                parentUncertainty={null}
                                delta={null}
                                deltaCi={null}
                              />
                            );
                          }
                          const childRating = { elo: entry.elo_score, uncertainty: entry.uncertainty ?? 0 };
                          const parentElo = entry.parent_elo ?? null;
                          const parentUncertainty = entry.parent_uncertainty ?? null;
                          const { delta, ci } = parentElo != null
                            ? bootstrapDeltaCI(childRating,
                                { elo: parentElo, uncertainty: parentUncertainty ?? 0 })
                            : { delta: null, ci: null };
                          return (
                            <VariantParentBadge
                              parentId={entry.parent_variant_id}
                              parentElo={parentElo}
                              parentUncertainty={parentUncertainty}
                              delta={delta}
                              deltaCi={ci}
                              crossRun={!!entry.parent_run_id && entry.parent_run_id !== entry.run_id}
                            />
                          );
                        })()}
                      </td>
                      <td className="py-2 font-mono">
                        {entry.cost_usd != null
                          ? `$${entry.cost_usd.toFixed(2)}`
                          : <span className="text-[var(--text-muted)]" title="Cost data is tracked at the invocation level, not per variant">N/A</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-4 border-t border-[var(--border-default)]">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 text-xs font-ui border border-[var(--border-default)] rounded disabled:opacity-40"
                >
                  &lsaquo; Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => Math.abs(p - page) <= 3 || p === 1 || p === totalPages)
                  .map((p, idx, arr) => {
                    const prev = arr[idx - 1];
                    const showEllipsis = prev != null && p - prev > 1;
                    return (
                      <span key={p}>
                        {showEllipsis && <span className="text-xs text-[var(--text-muted)]">…</span>}
                        <button
                          onClick={() => setPage(p)}
                          className={`px-3 py-1 text-xs font-ui border rounded ${
                            p === page
                              ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)] border-[var(--accent-gold)]'
                              : 'border-[var(--border-default)]'
                          }`}
                        >
                          {p}
                        </button>
                      </span>
                    );
                  })}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 text-xs font-ui border border-[var(--border-default)] rounded disabled:opacity-40"
                >
                  Next &rsaquo;
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
