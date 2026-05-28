// Arena topic detail page. Thin shell composing the extracted ArenaLeaderboardTable
// (D17 from rank_individual_paragraphs_evolution_20260525) with topic header,
// seed panel, and entity metrics.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  EvolutionBreadcrumb,
  EntityDetailHeader,
  NotFoundCard,
  MetricGrid,
  EntityMetricsTab,
  ArenaLeaderboardTable,
} from '@evolution/components/evolution';
import { getEntityMetricsAction } from '@evolution/services/metricsActions';
import {
  getArenaTopicDetailAction,
  type ArenaTopicDetail,
} from '@evolution/services/arenaActions';
import { ArenaSeedPanel } from '@evolution/components/evolution/sections/ArenaSeedPanel';

export default function ArenaTopicDetailPage(): JSX.Element {
  const { topicId } = useParams<{ topicId: string }>();
  const [topic, setTopic] = useState<ArenaTopicDetail | null>(null);
  const [topicTotal, setTopicTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMetrics, setHasMetrics] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [topicResult, metricsResult] = await Promise.all([
        getArenaTopicDetailAction(topicId),
        getEntityMetricsAction('prompt', topicId),
      ]);
      if (!topicResult.success || !topicResult.data) {
        setError(topicResult.error?.message ?? 'Failed to load topic');
        setLoading(false);
        return;
      }
      setTopic(topicResult.data);
      setHasMetrics(metricsResult.success && (metricsResult.data?.length ?? 0) > 0);
      setLoading(false);
    }
    load();
  }, [topicId]);

  useEffect(() => {
    if (topic?.name) document.title = `${topic.name} | Arena | Evolution`;
  }, [topic?.name]);

  // Kept for the Topic Details panel so the page still shows a count without
  // ArenaLeaderboardTable having to surface it back up. Refreshed lazily —
  // ArenaLeaderboardTable owns the source-of-truth fetch.
  const metrics = useMemo(() => ([
    { label: 'Status', value: topic?.status ?? '—' },
    { label: 'Entries', value: topicTotal },
  ]), [topic, topicTotal]);

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

      {topic.seedVariant && <ArenaSeedPanel seed={topic.seedVariant} />}

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 space-y-4 shadow-warm-lg">
        <h2 className="text-2xl font-display font-bold text-[var(--text-primary)]">Topic Details</h2>
        <p className="text-sm font-ui text-[var(--text-secondary)] whitespace-pre-wrap">{topic.prompt}</p>
        <MetricGrid metrics={metrics} columns={2} variant="card" />
      </div>

      {hasMetrics && (
        <div>
          <h2 className="text-2xl font-display font-bold text-[var(--text-primary)] mb-3">Evolution Metrics</h2>
          <EntityMetricsTab entityType="prompt" entityId={topicId} />
        </div>
      )}

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 shadow-warm-lg">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-2xl font-display font-bold text-[var(--text-primary)]">Leaderboard</h2>
        </div>
        <ArenaLeaderboardTable
          topicId={topicId}
          /* Surface the total back up to the Topic Details metric so the page
             still shows row count without duplicating the fetch. */
        />
        <TotalEntriesReporter topicId={topicId} onTotalChange={setTopicTotal} />
      </div>
    </div>
  );
}

/** Tiny invisible companion that pings the same action used by the
 *  leaderboard so the page-level "Entries" metric can display a count
 *  without duplicating the table's fetch wiring. */
function TotalEntriesReporter({ topicId, onTotalChange }: { topicId: string; onTotalChange: (n: number) => void }): null {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { getArenaEntriesAction } = await import('@evolution/services/arenaActions');
      const r = await getArenaEntriesAction({ topicId, limit: 1, offset: 0 });
      if (!cancelled && r.success && r.data) onTotalChange(r.data.total);
    })();
    return () => { cancelled = true; };
  }, [topicId, onTotalChange]);
  return null;
}
