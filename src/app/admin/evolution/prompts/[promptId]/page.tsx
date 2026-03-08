// Prompt detail page: shows prompt metadata, content, and related runs.
// Client component fetches data and renders EntityDetailHeader + EntityDetailTabs.

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionBreadcrumb, EmptyState, EntityDetailHeader, MetricGrid, EntityDetailTabs, useTabState } from '@evolution/components/evolution';
import { getPromptsAction } from '@evolution/services/promptRegistryActions';
import { buildArenaTopicUrl } from '@evolution/lib/utils/evolutionUrls';
import { RelatedRunsTab } from '@evolution/components/evolution/tabs/RelatedRunsTab';
import type { PromptMetadata } from '@evolution/lib/types';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'content', label: 'Content' },
  { id: 'runs', label: 'Runs' },
];

export default function PromptDetailPage(): JSX.Element {
  const { promptId } = useParams<{ promptId: string }>();
  const [prompt, setPrompt] = useState<PromptMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useTabState(TABS);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const promptsRes = await getPromptsAction({});
      if (promptsRes.success && promptsRes.data) {
        const found = promptsRes.data.find((p) => p.id === promptId);
        setPrompt(found ?? null);
      }
    } catch {
      toast.error('Failed to load prompt details');
    }
    setLoading(false);
  }, [promptId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="space-y-6">
        <EvolutionBreadcrumb items={[
          { label: 'Dashboard', href: '/admin/evolution-dashboard' },
          { label: 'Prompts', href: '/admin/evolution/prompts' },
          { label: 'Loading...' },
        ]} />
        <div className="animate-pulse h-8 w-48 bg-[var(--surface-elevated)] rounded-page" />
      </div>
    );
  }

  if (!prompt) {
    return (
      <div className="space-y-6">
        <EvolutionBreadcrumb items={[
          { label: 'Dashboard', href: '/admin/evolution-dashboard' },
          { label: 'Prompts', href: '/admin/evolution/prompts' },
          { label: 'Not Found' },
        ]} />
        <EmptyState message="Prompt not found" />
      </div>
    );
  }

  const statusColor = prompt.status === 'active' ? 'var(--status-success)' : 'var(--text-muted)';

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Prompts', href: '/admin/evolution/prompts' },
        { label: prompt.title },
      ]} />

      <EntityDetailHeader
        title={prompt.title}
        entityId={prompt.id}
        statusBadge={
          <span
            className="inline-block px-2 py-0.5 rounded-page text-xs font-ui font-medium"
            style={{
              backgroundColor: `color-mix(in srgb, ${statusColor} 20%, transparent)`,
              color: statusColor,
            }}
          >
            {prompt.status}
          </span>
        }
        actions={
          <Link
            href={buildArenaTopicUrl(prompt.id)}
            className="px-4 py-2 font-ui text-sm border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] transition-scholar"
          >
            View Arena
          </Link>
        }
      />

      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <MetricGrid
              columns={4}
              metrics={[
                { label: 'Status', value: prompt.status },
                {
                  label: 'Difficulty',
                  value: prompt.difficulty_tier
                    ? prompt.difficulty_tier.charAt(0).toUpperCase() + prompt.difficulty_tier.slice(1)
                    : '—',
                },
                { label: 'Created', value: new Date(prompt.created_at).toLocaleDateString() },
                {
                  label: 'Tags',
                  value: prompt.domain_tags.length > 0
                    ? prompt.domain_tags.join(', ')
                    : '—',
                },
              ]}
            />
            {prompt.prompt && (
              <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
                <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-ui mb-1">Prompt Text</div>
                <p className="text-[var(--text-primary)] font-body text-sm whitespace-pre-wrap line-clamp-6">
                  {prompt.prompt}
                </p>
              </div>
            )}
          </div>
        )}
        {activeTab === 'content' && (
          <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
            <p className="text-[var(--text-primary)] font-body text-sm whitespace-pre-wrap">
              {prompt.prompt}
            </p>
          </div>
        )}
        {activeTab === 'runs' && <RelatedRunsTab promptId={promptId} />}
      </EntityDetailTabs>
    </div>
  );
}
