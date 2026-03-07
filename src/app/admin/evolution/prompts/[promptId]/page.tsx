// Prompt detail page: shows prompt metadata, run history, and arena link.
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionBreadcrumb, TableSkeleton, EmptyState } from '@evolution/components/evolution';
import { getPromptsAction } from '@evolution/services/promptRegistryActions';
import { getPromptRunsAction, type StrategyRunEntry } from '@evolution/services/eloBudgetActions';
import { buildRunUrl, buildExplanationUrl, buildArenaTopicUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCostDetailed } from '@evolution/lib/utils/formatters';
import type { PromptMetadata } from '@evolution/lib/types';

function getRunStatusStyle(status: string): string {
  if (status === 'completed') return 'bg-[var(--status-success)]/20 text-[var(--status-success)]';
  if (status === 'failed') return 'bg-[var(--status-error)]/20 text-[var(--status-error)]';
  return 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]';
}

export default function PromptDetailPage(): JSX.Element {
  const { promptId } = useParams<{ promptId: string }>();
  const [prompt, setPrompt] = useState<PromptMetadata | null>(null);
  const [runs, setRuns] = useState<StrategyRunEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [runsLoading, setRunsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    setRunsLoading(true);
    try {
      const [promptsRes, runsRes] = await Promise.all([
        getPromptsAction({}),
        getPromptRunsAction(promptId, 50),
      ]);
      if (promptsRes.success && promptsRes.data) {
        const found = promptsRes.data.find((p) => p.id === promptId);
        setPrompt(found ?? null);
      }
      if (runsRes.success && runsRes.data) {
        setRuns(runsRes.data);
      }
    } catch {
      toast.error('Failed to load prompt details');
    }
    setLoading(false);
    setRunsLoading(false);
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

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Prompts', href: '/admin/evolution/prompts' },
        { label: prompt.title },
      ]} />

      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            {prompt.title}
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1 font-mono">
            {prompt.id}
          </p>
        </div>
        <Link
          href={buildArenaTopicUrl(prompt.id)}
          className="px-4 py-2 font-ui text-sm border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] transition-scholar"
        >
          View Arena
        </Link>
      </div>

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-ui">Status</div>
            <span
              className="inline-block px-2 py-0.5 rounded-page text-xs font-ui font-medium mt-1"
              style={{
                backgroundColor: `color-mix(in srgb, ${prompt.status === 'active' ? 'var(--status-success)' : 'var(--text-muted)'} 20%, transparent)`,
                color: prompt.status === 'active' ? 'var(--status-success)' : 'var(--text-muted)',
              }}
            >
              {prompt.status}
            </span>
          </div>
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-ui">Difficulty</div>
            <div className="text-[var(--text-primary)] mt-1 font-ui">
              {prompt.difficulty_tier
                ? prompt.difficulty_tier.charAt(0).toUpperCase() + prompt.difficulty_tier.slice(1)
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-ui">Created</div>
            <div className="text-[var(--text-primary)] mt-1 font-ui">
              {new Date(prompt.created_at).toLocaleDateString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-ui">Tags</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {prompt.domain_tags.length > 0
                ? prompt.domain_tags.map((tag) => (
                    <span key={tag} className="inline-block px-2 py-0.5 rounded-page text-xs font-ui bg-[var(--surface-secondary)] text-[var(--text-secondary)] border border-[var(--border-default)]">
                      {tag}
                    </span>
                  ))
                : <span className="text-[var(--text-muted)] font-ui">—</span>}
            </div>
          </div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-ui mb-1">Prompt Text</div>
          <p className="text-[var(--text-primary)] font-body text-sm whitespace-pre-wrap">
            {prompt.prompt}
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)] mb-3">
          Run History
        </h2>
        <div className="overflow-x-auto border border-[var(--border-default)] rounded-book shadow-warm-lg" data-testid="prompt-runs-table">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-elevated)]">
              <tr>
                <th className="p-3 text-left font-ui text-[var(--text-muted)]">Run</th>
                <th className="p-3 text-left font-ui text-[var(--text-muted)]">Explanation</th>
                <th className="p-3 text-center font-ui text-[var(--text-muted)]">Status</th>
                <th className="p-3 text-right font-ui text-[var(--text-muted)]">Cost</th>
                <th className="p-3 text-right font-ui text-[var(--text-muted)]">Iters</th>
              </tr>
            </thead>
            <tbody>
              {runsLoading ? (
                <tr><td colSpan={5} className="p-0"><TableSkeleton columns={5} rows={4} /></td></tr>
              ) : runs.length === 0 ? (
                <tr><td colSpan={5}><EmptyState message="No runs found for this prompt" /></td></tr>
              ) : (
                runs.map((run) => (
                  <tr key={run.runId} className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)]">
                    <td className="p-3">
                      <Link href={buildRunUrl(run.runId)} className="font-mono text-xs text-[var(--accent-gold)] hover:underline">
                        {run.runId.substring(0, 8)}
                      </Link>
                    </td>
                    <td className="p-3 text-[var(--text-primary)] truncate max-w-[200px]">
                      {run.explanationId ? (
                        <Link href={buildExplanationUrl(run.explanationId)} className="hover:text-[var(--accent-gold)] hover:underline">
                          {run.explanationTitle}
                        </Link>
                      ) : run.explanationTitle}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`px-1.5 py-0.5 rounded-page text-xs ${getRunStatusStyle(run.status)}`}>
                        {run.status}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono text-[var(--text-secondary)]">
                      {formatCostDetailed(run.totalCostUsd)}
                    </td>
                    <td className="p-3 text-right text-[var(--text-muted)]">{run.iterations}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
