'use client';
// Run detail page shell with tab bar for deep-diving into a single evolution run.
// Each tab is a separate component that lazily loads its own data on selection.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { EvolutionStatusBadge, PhaseIndicator } from '@/components/evolution';
import { getEvolutionRunsAction, type EvolutionRun } from '@/lib/services/evolutionActions';
import { TimelineTab } from '@/components/evolution/tabs/TimelineTab';
import { BudgetTab } from '@/components/evolution/tabs/BudgetTab';
import { EloTab } from '@/components/evolution/tabs/EloTab';
import { LineageTab } from '@/components/evolution/tabs/LineageTab';
import { VariantsTab } from '@/components/evolution/tabs/VariantsTab';

type TabId = 'timeline' | 'elo' | 'lineage' | 'budget' | 'variants';

const TABS: { id: TabId; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'elo', label: 'Elo' },
  { id: 'lineage', label: 'Lineage' },
  { id: 'budget', label: 'Budget' },
  { id: 'variants', label: 'Variants' },
];

export default function EvolutionRunDetailPage() {
  const params = useParams();
  const runId = params.runId as string;
  const [run, setRun] = useState<EvolutionRun | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('timeline');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getEvolutionRunsAction();
      if (result.success && result.data) {
        const found = result.data.find(r => r.id === runId);
        setRun(found ?? null);
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-[var(--surface-elevated)] rounded animate-pulse" />
        <div className="h-[400px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="text-center py-12 text-[var(--text-muted)]">
        Run not found: {runId}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-xs text-[var(--text-muted)]">
        <Link href="/admin/quality/evolution" className="hover:text-[var(--accent-gold)]">Evolution</Link>
        <span className="mx-1">/</span>
        <span>Run #{run.explanation_id}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--text-primary)]">
            Run #{run.explanation_id}
          </h1>
          <div className="flex items-center gap-3 mt-2">
            <EvolutionStatusBadge status={run.status} />
            <PhaseIndicator
              phase={run.phase}
              iteration={run.current_iteration}
              maxIterations={15}
            />
            <span className="text-xs text-[var(--text-muted)] font-mono">
              ${run.total_cost_usd.toFixed(2)} / ${run.budget_cap_usd.toFixed(2)}
            </span>
          </div>
          {run.error_message && (
            <div className="mt-2 text-xs text-[var(--status-error)]">{run.error_message}</div>
          )}
        </div>
        <Link
          href={`/admin/quality/evolution/run/${runId}/compare`}
          className="px-4 py-2 border border-[var(--border-default)] rounded-page text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
          data-testid="compare-link"
        >
          Compare
        </Link>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[var(--border-default)]" data-testid="tab-bar">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-[var(--accent-gold)] text-[var(--accent-gold)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
            data-testid={`tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content — only render the active tab */}
      <div data-testid="tab-content">
        {activeTab === 'timeline' && <TimelineTab runId={runId} />}
        {activeTab === 'elo' && <EloTab runId={runId} />}
        {activeTab === 'lineage' && <LineageTab runId={runId} />}
        {activeTab === 'budget' && <BudgetTab runId={runId} />}
        {activeTab === 'variants' && <VariantsTab runId={runId} />}
      </div>
    </div>
  );
}
