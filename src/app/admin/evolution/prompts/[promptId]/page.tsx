// Prompt detail page showing full prompt text, metadata, and domain tags.
// Uses V2 getPromptDetailAction and shared EntityDetailHeader.

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { EntityDetailHeader, EvolutionBreadcrumb, MetricGrid, EntityMetricsTab } from '@evolution/components/evolution';
import type { MetricItem } from '@evolution/components/evolution';
import { getPromptDetailAction, type PromptListItem } from '@evolution/services/arenaActions';

export default function PromptDetailPage(): JSX.Element {
  const { promptId } = useParams<{ promptId: string }>();
  const [prompt, setPrompt] = useState<PromptListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const result = await getPromptDetailAction(promptId);
      if (result.success && result.data) {
        setPrompt(result.data);
      } else {
        setError(result.error?.message ?? 'Prompt not found');
      }
      setLoading(false);
    })();
  }, [promptId]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-[var(--text-secondary)]">Loading prompt...</p>
      </div>
    );
  }

  if (error || !prompt) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-display font-bold text-[var(--status-error)] mb-4">Error</h2>
        <p className="text-sm text-[var(--text-secondary)]">{error ?? 'Prompt not found'}</p>
      </div>
    );
  }

  const metrics: MetricItem[] = [
    { label: 'Status', value: prompt.status },
    { label: 'Created', value: new Date(prompt.created_at).toLocaleDateString() },
  ];

  return (
    <div className="space-y-6 pb-12">
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
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
              prompt.status === 'active'
                ? 'bg-[var(--status-success)]/20 text-[var(--status-success)] border-[var(--status-success)]/30'
                : 'bg-[var(--text-muted)]/20 text-[var(--text-muted)] border-[var(--text-muted)]/30'
            }`}
            data-testid="prompt-status-badge"
          >
            {prompt.status}
          </span>
        }
      />

      <MetricGrid metrics={metrics} columns={2} variant="card" />

      <div>
        <h3 className="text-xl font-display font-semibold text-[var(--text-primary)] mb-3">Evolution Metrics</h3>
        <EntityMetricsTab entityType="prompt" entityId={promptId} />
      </div>

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6">
        <h3 className="text-xl font-display font-semibold text-[var(--text-primary)] mb-3">Prompt Text</h3>
        <pre className="whitespace-pre-wrap text-sm font-body text-[var(--text-secondary)] leading-relaxed">
          {prompt.prompt}
        </pre>
      </div>

    </div>
  );
}
