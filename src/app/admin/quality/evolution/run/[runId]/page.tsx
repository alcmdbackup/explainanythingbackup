'use client';
// Run detail page shell with tab bar for deep-diving into a single evolution run.
// Each tab is a separate component that lazily loads its own data on selection.

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionStatusBadge, PhaseIndicator } from '@/components/evolution';
import { getEvolutionRunByIdAction, getEvolutionVariantsAction, type EvolutionRun, type EvolutionVariant } from '@/lib/services/evolutionActions';
import { addToHallOfFameAction } from '@/lib/services/hallOfFameActions';
import { getStrategyDetailAction } from '@/lib/services/strategyRegistryActions';
import type { StrategyConfigRow } from '@/lib/evolution/core/strategyConfig';
import { TimelineTab } from '@/components/evolution/tabs/TimelineTab';
import { BudgetTab } from '@/components/evolution/tabs/BudgetTab';
import { EloTab } from '@/components/evolution/tabs/EloTab';
import { LineageTab } from '@/components/evolution/tabs/LineageTab';
import { VariantsTab } from '@/components/evolution/tabs/VariantsTab';
import { TreeTab } from '@/components/evolution/tabs/TreeTab';
import { LogsTab } from '@/components/evolution/tabs/LogsTab';

type TabId = 'timeline' | 'elo' | 'lineage' | 'budget' | 'variants' | 'tree' | 'logs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'elo', label: 'Elo' },
  { id: 'lineage', label: 'Lineage' },
  { id: 'tree', label: 'Tree' },
  { id: 'budget', label: 'Budget' },
  { id: 'variants', label: 'Variants' },
  { id: 'logs', label: 'Logs' },
];

function AddToHallOfFameDialog({ run, onClose }: { run: EvolutionRun; onClose: (topicId?: string) => void }): JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [includeBaseline, setIncludeBaseline] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [variants, setVariants] = useState<EvolutionVariant[]>([]);

  useEffect(() => {
    getEvolutionVariantsAction(run.id).then((res) => {
      if (res.success && res.data) setVariants(res.data);
    });
  }, [run.id]);

  const winner = variants.find((v) => v.is_winner) ?? variants[0];
  const baseline = variants.find((v) => v.agent_name === 'original_baseline' || v.generation === 0);

  const handleSubmit = async () => {
    if (!prompt.trim()) { toast.error('Prompt is required'); return; }
    if (!winner) { toast.error('No winner variant found'); return; }
    setSubmitting(true);

    const metadata: Record<string, unknown> = {
      winning_strategy: winner.agent_name,
      winner_elo: winner.elo_score,
      variants_generated: run.variants_generated,
      explanation_id: run.explanation_id,
    };

    const result = await addToHallOfFameAction({
      prompt: prompt.trim(),
      content: winner.variant_content,
      generation_method: 'evolution_winner',
      model: winner.agent_name,
      total_cost_usd: run.total_cost_usd,
      evolution_run_id: run.id,
      evolution_variant_id: winner.id,
      metadata,
    });

    if (!result.success) {
      toast.error(result.error?.message || 'Failed to add to Hall of Fame');
      setSubmitting(false);
      return;
    }

    // Add baseline if requested
    if (includeBaseline && baseline) {
      await addToHallOfFameAction({
        prompt: prompt.trim(),
        content: baseline.variant_content,
        generation_method: 'evolution_baseline',
        model: baseline.agent_name,
        total_cost_usd: null,
        evolution_run_id: run.id,
        evolution_variant_id: baseline.id,
        metadata: { explanation_id: run.explanation_id },
      });
    }

    toast.success('Added to Hall of Fame', {
      action: {
        label: 'View Topic',
        onClick: () => onClose(result.data!.topic_id),
      },
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 w-[450px] space-y-4"
        role="dialog"
        aria-label="Add to Hall of Fame"
      >
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">
          Add to Hall of Fame
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Add the winner{includeBaseline ? ' and baseline' : ''} to the Hall of Fame for cross-method comparison.
        </p>

        {winner && (
          <div className="text-xs text-[var(--text-secondary)] bg-[var(--surface-secondary)] p-3 rounded-page">
            <div>Winner: <span className="font-mono">{winner.agent_name}</span> (Elo {Math.round(winner.elo_score)})</div>
            <div className="mt-1 text-[var(--text-muted)] truncate">{winner.variant_content.slice(0, 100)}...</div>
          </div>
        )}

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">Topic Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            data-testid="bank-prompt-input"
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] min-h-[60px]"
            placeholder="e.g. Explain quantum computing"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={includeBaseline}
            onChange={(e) => setIncludeBaseline(e.target.checked)}
            className="rounded"
          />
          Also add baseline (seed article)
        </label>

        <div className="flex gap-2 justify-end">
          <button
            onClick={() => onClose()}
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !winner}
            data-testid="bank-submit"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Adding...' : 'Add to Hall of Fame'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EvolutionRunDetailPage(): JSX.Element {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const runId = params.runId as string;
  const [run, setRun] = useState<EvolutionRun | null>(null);
  const [strategy, setStrategy] = useState<StrategyConfigRow | null>(null);

  // URL params for cross-linking: ?tab=logs&agent=pairwise&iteration=2&variant=abc
  const tabParam = searchParams.get('tab') as TabId | null;
  const agentParam = searchParams.get('agent') ?? undefined;
  const iterationParam = searchParams.get('iteration');
  const variantParam = searchParams.get('variant') ?? undefined;

  const [activeTab, setActiveTab] = useState<TabId>(tabParam ?? 'timeline');
  const [loading, setLoading] = useState(true);
  const [showHallOfFameDialog, setShowHallOfFameDialog] = useState(false);

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true);
      const result = await getEvolutionRunByIdAction(runId);
      if (result.success && result.data) {
        setRun(result.data);
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  // Fetch strategy details when run has a strategy_config_id
  useEffect(() => {
    if (!run?.strategy_config_id) return;
    getStrategyDetailAction(run.strategy_config_id).then((res) => {
      if (res.success && res.data) setStrategy(res.data);
    });
  }, [run?.strategy_config_id]);

  // Auto-refresh run data every 5s for active runs (cost, phase, status updates)
  useEffect(() => {
    const isActive = run?.status === 'running' || run?.status === 'claimed';
    if (!isActive) return;
    const interval = setInterval(async () => {
      const result = await getEvolutionRunByIdAction(runId);
      if (result.success && result.data) setRun(result.data);
    }, 5000);
    return () => clearInterval(interval);
  }, [run?.status, runId]);

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
      <div className="text-xs text-[var(--text-muted)]">
        <Link href="/admin/quality/evolution" className="hover:text-[var(--accent-gold)]">Evolution</Link>
        <span className="mx-1">/</span>
        <span>Run {runId.substring(0, 8)}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--text-primary)]">
            {run.explanation_id ? `Explanation #${run.explanation_id}` : 'Evolution Run'}
          </h1>
          <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-muted)] font-mono">
            <span title={runId}>Run ID: {runId.substring(0, 8)}...</span>
            <button
              onClick={() => { navigator.clipboard.writeText(runId); toast.success('Run ID copied'); }}
              className="text-[var(--accent-gold)] hover:underline"
            >
              Copy
            </button>
          </div>
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
            {strategy && (
              <Link
                href="/admin/quality/strategies"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--surface-elevated)] text-[var(--accent-gold)] border border-[var(--border-default)] hover:bg-[var(--surface-secondary)] transition-colors"
                title={`Strategy: ${strategy.label}`}
              >
                {strategy.label}
              </Link>
            )}
          </div>
          {run.error_message && (
            <div className="mt-2 text-xs text-[var(--status-error)]">{run.error_message}</div>
          )}
        </div>
        <div className="flex gap-2">
          {run.status === 'completed' && (
            <button
              onClick={() => setShowHallOfFameDialog(true)}
              className="px-4 py-2 border border-[var(--border-default)] rounded-page text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
              data-testid="add-to-hall-of-fame-btn"
            >
              Add to Hall of Fame
            </button>
          )}
          <Link
            href={`/admin/quality/evolution/run/${runId}/compare`}
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
            data-testid="compare-link"
          >
            Compare
          </Link>
        </div>
      </div>

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

      <div data-testid="tab-content">
        {activeTab === 'timeline' && <TimelineTab runId={runId} initialAgent={agentParam} />}
        {activeTab === 'elo' && <EloTab runId={runId} />}
        {activeTab === 'lineage' && <LineageTab runId={runId} />}
        {activeTab === 'budget' && <BudgetTab runId={runId} />}
        {activeTab === 'variants' && <VariantsTab runId={runId} />}
        {activeTab === 'tree' && <TreeTab runId={runId} />}
        {activeTab === 'logs' && (
          <LogsTab
            runId={runId}
            runStatus={run.status}
            initialAgent={agentParam}
            initialIteration={iterationParam ? Number(iterationParam) : undefined}
            initialVariant={variantParam}
          />
        )}
      </div>

      {showHallOfFameDialog && run && (
        <AddToHallOfFameDialog run={run} onClose={(topicId) => {
          setShowHallOfFameDialog(false);
          if (topicId) router.push(`/admin/quality/hall-of-fame/${topicId}`);
        }} />
      )}
    </div>
  );
}
