// Arena topic detail page with leaderboard. Shows topic metadata and entries ranked by elo_score.
// V2 schema: elo data lives directly on evolution_variants.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  EvolutionBreadcrumb,
  EntityDetailHeader,
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

export default function ArenaTopicDetailPage(): JSX.Element {
  const { topicId } = useParams<{ topicId: string }>();
  const [topic, setTopic] = useState<ArenaTopic | null>(null);
  const [entries, setEntries] = useState<ArenaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMetrics, setHasMetrics] = useState(false);

  // Sort state for leaderboard columns (F41)
  type SortKey = 'elo_score' | 'mu' | 'sigma' | 'arena_match_count' | 'generation_method' | 'cost_usd';
  const [sortKey, setSortKey] = useState<SortKey>('elo_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sortedEntries = useMemo(() => {
    const sorted = [...entries].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv);
      return (av as number) - (bv as number);
    });
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [entries, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [topicResult, entriesResult, metricsResult] = await Promise.all([
        getArenaTopicDetailAction(topicId),
        getArenaEntriesAction({ topicId }),
        getEntityMetricsAction('prompt', topicId),
      ]);

      if (!topicResult.success || !topicResult.data) {
        setError(topicResult.error?.message ?? 'Failed to load topic');
        setLoading(false);
        return;
      }
      if (!entriesResult.success) {
        setError(entriesResult.error?.message ?? 'Failed to load entries');
        setLoading(false);
        return;
      }

      setTopic(topicResult.data);
      setEntries(entriesResult.data ?? []);
      setHasMetrics(metricsResult.success && (metricsResult.data?.length ?? 0) > 0);
      setLoading(false);
    }
    load();
  }, [topicId]);

  if (loading) {
    return (
      <div className="p-8 text-center text-sm font-ui text-[var(--text-muted)]">Loading...</div>
    );
  }

  if (error || !topic) {
    return (
      <div className="p-8 text-center text-sm font-ui text-[var(--status-error)]">
        {error ?? 'Topic not found'}
      </div>
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
            { label: 'Entries', value: entries.length },
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
        <h2 className="text-2xl font-display font-bold text-[var(--text-primary)] mb-4">Leaderboard</h2>
        {entries.length === 0 ? (
          <p className="text-sm font-ui text-[var(--text-muted)]">No entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-ui" data-testid="leaderboard-table">
              <thead>
                <tr className="text-left text-xs text-[var(--text-muted)] uppercase tracking-wide border-b border-[var(--border-default)]">
                  <th className="py-2 pr-3">Rank</th>
                  <th className="py-2 pr-3">Content</th>
                  <th className="py-2 pr-3 cursor-pointer select-none hover:text-[var(--text-primary)]" onClick={() => handleSort('elo_score')}>Elo{sortIndicator('elo_score')}</th>
                  <th className="py-2 pr-3 cursor-pointer select-none hover:text-[var(--text-primary)]" onClick={() => handleSort('mu')}>Mu{sortIndicator('mu')}</th>
                  <th className="py-2 pr-3 cursor-pointer select-none hover:text-[var(--text-primary)]" onClick={() => handleSort('sigma')}>Sigma{sortIndicator('sigma')}</th>
                  <th className="py-2 pr-3 cursor-pointer select-none hover:text-[var(--text-primary)]" onClick={() => handleSort('arena_match_count')}>Matches{sortIndicator('arena_match_count')}</th>
                  <th className="py-2 pr-3 cursor-pointer select-none hover:text-[var(--text-primary)]" onClick={() => handleSort('generation_method')}>Method{sortIndicator('generation_method')}</th>
                  <th className="py-2 cursor-pointer select-none hover:text-[var(--text-primary)]" onClick={() => handleSort('cost_usd')}>Cost{sortIndicator('cost_usd')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry, index) => (
                  <tr
                    key={entry.id}
                    className="border-b border-[var(--border-default)] last:border-0 hover:bg-[var(--surface-hover)]"
                  >
                    <td className="py-2 pr-3 font-mono text-[var(--text-muted)]">{index + 1}</td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/admin/evolution/variants/${entry.id}`}
                        className="text-[var(--accent-gold)] hover:underline"
                      >
                        {(() => {
                          const cleaned = stripMarkdownTitle(entry.variant_content);
                          return cleaned.length > 60 ? `${cleaned.substring(0, 60)}…` : cleaned;
                        })()}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 font-mono">{formatElo(entry.elo_score)}</td>
                    <td className="py-2 pr-3 font-mono">{entry.mu.toFixed(1)}</td>
                    <td className="py-2 pr-3 font-mono">{entry.sigma.toFixed(1)}</td>
                    <td className="py-2 pr-3 font-mono">{entry.arena_match_count}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{entry.generation_method}</td>
                    <td className="py-2 font-mono">
                      {entry.cost_usd != null ? `$${entry.cost_usd.toFixed(2)}` : (
                        <span className="text-[var(--text-muted)]" title="Cost data is tracked at the invocation level, not per variant">N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
