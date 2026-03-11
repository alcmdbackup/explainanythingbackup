// Arena entry detail page: shows entry content, metadata, run/strategy links, and match history.
// Client component fetches entry data via getArenaEntryDetailAction.

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  EvolutionBreadcrumb,
  EmptyState,
  EntityDetailHeader,
  MetricGrid,
  EntityDetailTabs,
  useTabState,
} from '@evolution/components/evolution';
import {
  getArenaEntryDetailAction,
  type ArenaEntry,
} from '@evolution/services/arenaActions';
import { buildRunUrl, buildVariantDetailUrl, buildArenaTopicUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCost } from '@evolution/lib/utils/formatters';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'content', label: 'Content' },
];

const BREADCRUMB_BASE = [
  { label: 'Dashboard', href: '/admin/evolution-dashboard' },
  { label: 'Arena', href: '/admin/evolution/arena' },
] as const;

function MetaFeedbackSection({ feedback }: { feedback: Record<string, unknown> }): JSX.Element {
  return (
    <div>
      <span className="font-semibold text-[var(--text-secondary)]">Meta-Feedback</span>
      <div className="mt-1 space-y-1 text-[var(--text-muted)]">
        {Array.isArray(feedback.successful_strategies) && (
          <div>Strengths: {(feedback.successful_strategies as string[]).join(', ')}</div>
        )}
        {Array.isArray(feedback.recurring_weaknesses) && (
          <div>Weaknesses: {(feedback.recurring_weaknesses as string[]).join(', ')}</div>
        )}
      </div>
    </div>
  );
}

export default function ArenaEntryDetailPage(): JSX.Element {
  const { entryId } = useParams<{ entryId: string }>();
  const [entry, setEntry] = useState<ArenaEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useTabState(TABS);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getArenaEntryDetailAction(entryId);
      if (res.success && res.data) {
        setEntry(res.data);
      }
    } catch {
      toast.error('Failed to load entry details');
    }
    setLoading(false);
  }, [entryId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="space-y-6">
        <EvolutionBreadcrumb items={[...BREADCRUMB_BASE, { label: 'Loading...' }]} />
        <div className="animate-pulse h-8 w-48 bg-[var(--surface-elevated)] rounded-page" />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="space-y-6">
        <EvolutionBreadcrumb items={[...BREADCRUMB_BASE, { label: 'Not Found' }]} />
        <EmptyState message="Arena entry not found" />
      </div>
    );
  }

  const meta = entry.metadata ?? {};
  const isEvolution = entry.generation_method === 'evolution' || entry.generation_method.startsWith('evolution_');

  const headerLinks = [
    ...(entry.topic_id ? [{ prefix: 'Topic', label: 'View Arena', href: buildArenaTopicUrl(entry.topic_id) }] : []),
    ...(entry.evolution_run_id ? [{ prefix: 'Run', label: entry.evolution_run_id.slice(0, 8), href: buildRunUrl(entry.evolution_run_id) }] : []),
    ...(entry.evolution_variant_id ? [{ prefix: 'Variant', label: entry.evolution_variant_id.slice(0, 8), href: buildVariantDetailUrl(entry.evolution_variant_id) }] : []),
  ];

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[...BREADCRUMB_BASE, { label: `Entry ${entryId.slice(0, 8)}` }]} />

      <EntityDetailHeader
        title={`${entry.generation_method} · ${entry.model}`}
        entityId={entry.id}
        links={headerLinks}
      />

      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <MetricGrid
              columns={4}
              metrics={[
                { label: 'Method', value: entry.generation_method },
                { label: 'Model', value: entry.model },
                { label: 'Cost', value: formatCost(entry.total_cost_usd ?? 0) || '—' },
                { label: 'Created', value: new Date(entry.created_at).toLocaleString() },
              ]}
            />

            {isEvolution && (
              <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4 space-y-3 text-xs">
                <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-ui mb-1">Evolution Details</div>
                <div className="flex flex-wrap gap-4 text-[var(--text-muted)]">
                  {meta.iterations !== undefined && <span>Iterations: <span className="font-mono">{String(meta.iterations)}</span></span>}
                  {meta.duration_seconds !== undefined && <span>Duration: <span className="font-mono">{Number(meta.duration_seconds).toFixed(0)}s</span></span>}
                  {meta.winning_strategy !== undefined && <span>Strategy: <span className="font-mono">{String(meta.winning_strategy)}</span></span>}
                  {meta.total_matches !== undefined && <span>Matches: <span className="font-mono">{String(meta.total_matches)}</span></span>}
                  {meta.decisive_rate !== undefined && <span>Decisive: <span className="font-mono">{(Number(meta.decisive_rate) * 100).toFixed(0)}%</span></span>}
                  {meta.stop_reason !== undefined && <span>Stop: <span className="font-mono">{String(meta.stop_reason)}</span></span>}
                </div>

                {meta.agent_cost_breakdown !== undefined && typeof meta.agent_cost_breakdown === 'object' && meta.agent_cost_breakdown !== null && (
                  <div>
                    <span className="font-semibold text-[var(--text-secondary)]">Agent Costs</span>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {Object.entries(meta.agent_cost_breakdown as Record<string, number>).map(([agent, cost]) => (
                        <span key={agent} className="text-[var(--text-muted)]">
                          {agent}: <span className="font-mono text-[var(--text-secondary)]">${cost.toFixed(3)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {Array.isArray(meta.strategy_effectiveness) && (
                  <div>
                    <span className="font-semibold text-[var(--text-secondary)]">Top Strategies</span>
                    <div className="mt-1 space-y-1">
                      {(meta.strategy_effectiveness as Array<{ strategy: string; avgOrdinal: number }>).slice(0, 3).map((s, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="font-mono text-[var(--text-secondary)]">{s.strategy}</span>
                          <span className="text-[var(--text-muted)]">Rating {s.avgOrdinal?.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {meta.meta_feedback !== undefined && typeof meta.meta_feedback === 'object' && meta.meta_feedback !== null && (
                  <MetaFeedbackSection feedback={meta.meta_feedback as Record<string, unknown>} />
                )}
              </div>
            )}

            {!isEvolution && meta.prompt_tokens !== undefined && (
              <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4 text-xs">
                <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-ui mb-1">Generation Details</div>
                <div className="flex flex-wrap gap-4 text-[var(--text-muted)]">
                  <span>Prompt tokens: <span className="font-mono">{String(meta.prompt_tokens)}</span></span>
                  <span>Completion tokens: <span className="font-mono">{String(meta.completion_tokens)}</span></span>
                  {meta.generation_time_ms !== undefined && (
                    <span>Gen time: <span className="font-mono">{Number(meta.generation_time_ms).toFixed(0)}ms</span></span>
                  )}
                  {meta.call_source !== undefined && <span>Source: <span className="font-mono">{String(meta.call_source)}</span></span>}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'content' && (
          <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
            <pre className="whitespace-pre-wrap text-[var(--text-primary)] font-body text-sm">
              {entry.content}
            </pre>
          </div>
        )}
      </EntityDetailTabs>
    </div>
  );
}
