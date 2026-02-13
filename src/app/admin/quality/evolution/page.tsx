'use client';
// Admin page for managing evolution pipeline runs.
// Queue new runs, view variant rankings, apply winning content, rollback, and view quality impact.

import { Fragment, useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  queueEvolutionRunAction,
  getEvolutionRunsAction,
  getEvolutionVariantsAction,
  applyWinnerAction,
  triggerEvolutionRunAction,
  getEvolutionCostBreakdownAction,
  getEvolutionHistoryAction,
  rollbackEvolutionAction,
  estimateRunCostAction,
  type EvolutionRun,
  type EvolutionVariant,
  type AgentCostBreakdown,
  type CostEstimateResult,
} from '@/lib/services/evolutionActions';
import { getPromptsAction } from '@/lib/services/promptRegistryActions';
import { getStrategiesAction } from '@/lib/services/strategyRegistryActions';
import type { EvolutionRunStatus } from '@/lib/evolution/types';
import Link from 'next/link';
import { EvolutionStatusBadge } from '@/components/evolution';

// ─── Date range options ──────────────────────────────────────────

type DateRange = '7d' | '30d' | '90d' | 'all';

const DATE_RANGE_DAYS: Record<DateRange, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
};

function getStartDate(range: DateRange): string | undefined {
  const days = DATE_RANGE_DAYS[range];
  if (days === null) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ─── Summary cards ───────────────────────────────────────────────

function SummaryCards({ runs }: { runs: EvolutionRun[] }) {
  const stats = useMemo(() => {
    const completed = runs.filter((r) => r.status === 'completed');
    const totalCost = runs.reduce((sum, r) => sum + (r.total_cost_usd ?? 0), 0);
    return {
      total: runs.length,
      completed: completed.length,
      successRate: runs.length > 0 ? ((completed.length / runs.length) * 100).toFixed(0) : '0',
      totalCost,
      avgCost: completed.length > 0 ? totalCost / completed.length : 0,
    };
  }, [runs]);

  const cards = [
    { label: 'Total Runs', value: String(stats.total) },
    { label: 'Completed', value: `${stats.completed} (${stats.successRate}%)` },
    { label: 'Total Cost', value: `$${stats.totalCost.toFixed(2)}` },
    { label: 'Avg Cost/Run', value: `$${stats.avgCost.toFixed(2)}` },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="summary-cards">
      {cards.map((c) => (
        <div
          key={c.label}
          className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4"
        >
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{c.label}</div>
          <div className="text-2xl font-semibold text-[var(--text-primary)] mt-1">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Agent cost bar chart ────────────────────────────────────────

function AgentCostChart({ breakdown }: { breakdown: AgentCostBreakdown[] }) {
  if (breakdown.length === 0) {
    return <div className="text-sm text-[var(--text-muted)]">No cost data</div>;
  }
  const maxCost = Math.max(...breakdown.map((b) => b.costUsd));

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-[var(--text-secondary)]">Cost by Agent</h4>
      {breakdown.map((b) => (
        <div key={b.agent} className="flex items-center gap-2 text-xs">
          <span className="w-24 text-[var(--text-muted)] truncate font-mono">{b.agent}</span>
          <div className="flex-1 h-4 bg-[var(--surface-secondary)] rounded overflow-hidden">
            <div
              className="h-full bg-[var(--accent-gold)] rounded"
              style={{ width: `${maxCost > 0 ? (b.costUsd / maxCost) * 100 : 0}%` }}
            />
          </div>
          <span className="w-16 text-right text-[var(--text-secondary)]">${b.costUsd.toFixed(3)}</span>
          <span className="w-12 text-right text-[var(--text-muted)]">{b.calls}x</span>
        </div>
      ))}
    </div>
  );
}

// ─── Start Run card ──────────────────────────────────────────────

function StartRunCard({ onQueued }: { onQueued: () => void }) {
  const [promptId, setPromptId] = useState('');
  const [strategyId, setStrategyId] = useState('');
  const [budget, setBudget] = useState('5.00');
  const [submitting, setSubmitting] = useState(false);
  const [prompts, setPrompts] = useState<{ id: string; label: string }[]>([]);
  const [strategies, setStrategies] = useState<{ id: string; label: string }[]>([]);
  const [estimate, setEstimate] = useState<CostEstimateResult | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    (async () => {
      const [pRes, sRes] = await Promise.all([
        getPromptsAction({ status: 'active' }),
        getStrategiesAction({ status: 'active' }),
      ]);
      if (pRes.success && pRes.data) {
        setPrompts(pRes.data.map(p => ({ id: p.id, label: p.title })));
      }
      if (sRes.success && sRes.data) {
        setStrategies(sRes.data.map(s => ({ id: s.id, label: s.name })));
      }
    })();
  }, []);

  // Debounced cost estimate on strategy change
  useEffect(() => {
    if (!strategyId) { setEstimate(null); return; }

    const timer = setTimeout(async () => {
      setEstimateLoading(true);
      const result = await estimateRunCostAction({ strategyId });
      if (result.success && result.data) {
        setEstimate(result.data);
      } else {
        setEstimate(null);
      }
      setEstimateLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [strategyId]);

  const handleStart = async () => {
    if (!promptId) { toast.error('Select a prompt'); return; }
    if (!strategyId) { toast.error('Select a strategy'); return; }
    const cap = parseFloat(budget);
    if (!cap || cap <= 0) { toast.error('Budget must be positive'); return; }

    setSubmitting(true);
    const result = await queueEvolutionRunAction({ promptId, strategyId, budgetCapUsd: cap });
    if (result.success && result.data) {
      toast.success('Run queued — triggering pipeline...');
      onQueued();
      // Immediately trigger the queued run
      const triggerResult = await triggerEvolutionRunAction(result.data.id);
      if (triggerResult.success) {
        toast.success('Pipeline completed');
      } else {
        toast.error(triggerResult.error?.message || 'Pipeline trigger failed');
      }
      setPromptId('');
      setStrategyId('');
      setEstimate(null);
      onQueued();
    } else {
      toast.error(result.error?.message || 'Failed to queue run');
    }
    setSubmitting(false);
  };

  const budgetNum = parseFloat(budget) || 0;
  const exceedsBudget = estimate && estimate.totalUsd > budgetNum;

  const selectClass = 'px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)] text-sm font-ui';

  return (
    <div
      className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4 space-y-3"
      data-testid="start-run-card"
    >
      <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
        Start New Pipeline
      </h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="relative z-10 flex flex-col gap-1 flex-1 min-w-[180px]">
          <span className="text-xs font-ui text-[var(--text-muted)]">Prompt</span>
          <select value={promptId} onChange={(e) => setPromptId(e.target.value)} className={selectClass}>
            <option value="">Select prompt...</option>
            {prompts.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="relative z-10 flex flex-col gap-1 flex-1 min-w-[180px]">
          <span className="text-xs font-ui text-[var(--text-muted)]">Strategy</span>
          <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)} className={selectClass}>
            <option value="">Select strategy...</option>
            {strategies.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 w-28">
          <span className="text-xs font-ui text-[var(--text-muted)]">Budget ($)</span>
          <input
            type="number"
            step="0.50"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className={selectClass}
          />
        </label>
        <button
          onClick={handleStart}
          disabled={submitting || !promptId || !strategyId}
          data-testid="start-run-btn"
          className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page font-ui text-sm hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Running...' : 'Start Pipeline'}
        </button>
      </div>

      {/* Cost estimate display */}
      {estimateLoading && (
        <div className="text-xs text-[var(--text-muted)]" data-testid="estimate-loading">
          Estimating cost...
        </div>
      )}
      {estimate && !estimateLoading && (
        <div className="space-y-2" data-testid="cost-estimate">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--text-secondary)]">
              Estimated cost: <span className="font-semibold font-mono">${estimate.totalUsd.toFixed(2)}</span>
            </span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                estimate.confidence === 'high'
                  ? 'bg-[var(--status-success)]/10 text-[var(--status-success)]'
                  : estimate.confidence === 'medium'
                    ? 'bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]'
                    : 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]'
              }`}
              title={estimate.confidence === 'low' ? 'No historical data yet — estimate is heuristic-based' : undefined}
            >
              {estimate.confidence}
            </span>
            <button
              onClick={() => setShowBreakdown(!showBreakdown)}
              className="text-xs text-[var(--accent-gold)] hover:underline"
              data-testid="toggle-breakdown"
            >
              {showBreakdown ? 'Hide details' : 'Show details'}
            </button>
          </div>

          {exceedsBudget && (
            <div
              className="text-xs text-[var(--status-error)] bg-[var(--status-error)]/10 px-2 py-1 rounded"
              data-testid="budget-warning"
            >
              Estimate (${estimate.totalUsd.toFixed(2)}) exceeds budget (${budgetNum.toFixed(2)})
            </div>
          )}

          {estimate.confidence === 'low' && (
            <div className="text-xs text-[var(--text-muted)]">
              No historical data yet — accuracy improves after first run.
            </div>
          )}

          {showBreakdown && (
            <div className="space-y-1 text-xs" data-testid="agent-breakdown">
              {Object.entries(estimate.perAgent)
                .sort(([, a], [, b]) => b - a)
                .map(([agent, cost]) => (
                  <div key={agent} className="flex items-center gap-2">
                    <span className="w-28 text-[var(--text-muted)] font-mono truncate">{agent}</span>
                    <div className="flex-1 h-3 bg-[var(--surface-secondary)] rounded overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent-gold)]/60 rounded"
                        style={{ width: `${estimate.totalUsd > 0 ? (cost / estimate.totalUsd) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-[var(--text-secondary)] font-mono">${cost.toFixed(3)}</span>
                  </div>
                ))}
              <div className="text-[var(--text-muted)] pt-1">
                Per iteration: ${estimate.perIteration.toFixed(3)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Queue dialog ───────────────────────────────────────────────

function QueueDialog({
  onQueue,
  onClose,
}: {
  onQueue: (explanationId: number, budgetCapUsd: number) => void;
  onClose: () => void;
}) {
  const [explanationId, setExplanationId] = useState('');
  const [budget, setBudget] = useState('5.00');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 w-96 space-y-4"
        role="dialog"
        aria-label="Queue evolution run"
      >
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">Queue Evolution Run</h2>

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">Explanation ID</label>
          <input
            type="number"
            value={explanationId}
            onChange={(e) => setExplanationId(e.target.value)}
            data-testid="queue-explanation-id"
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)]"
            placeholder="e.g. 42"
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">Budget Cap (USD)</label>
          <input
            type="number"
            step="0.50"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            data-testid="queue-budget"
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)]"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const id = parseInt(explanationId, 10);
              const cap = parseFloat(budget);
              if (!id || isNaN(id)) { toast.error('Valid explanation ID required'); return; }
              if (!cap || cap <= 0) { toast.error('Budget must be positive'); return; }
              onQueue(id, cap);
            }}
            data-testid="queue-submit"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90"
          >
            Queue Run
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Variant detail panel ───────────────────────────────────────

function VariantPanel({
  run,
  variants,
  loading,
  onApplyWinner,
  onClose,
}: {
  run: EvolutionRun;
  variants: EvolutionVariant[];
  loading: boolean;
  onApplyWinner: (variantId: string) => void;
  onClose: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<AgentCostBreakdown[] | null>(null);

  // Load cost breakdown when panel opens
  useEffect(() => {
    void getEvolutionCostBreakdownAction(run.id).then((res) => {
      if (res.success && res.data) setCostBreakdown(res.data);
    });
  }, [run.id]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 w-[700px] max-h-[80vh] overflow-y-auto space-y-4"
        role="dialog"
        aria-label="Run variants"
      >
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">
              Run Variants
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              Explanation #{run.explanation_id} &middot; {run.variants_generated} variants &middot;{' '}
              <EvolutionStatusBadge status={run.status} />
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl">&times;</button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-[var(--text-muted)]">Loading variants...</div>
        ) : variants.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-muted)]">No variants yet</div>
        ) : (
          <table className="w-full text-sm" data-testid="variants-table">
            <thead className="bg-[var(--surface-secondary)]">
              <tr>
                <th className="p-3 text-left">Rank</th>
                <th className="p-3 text-left">Strategy</th>
                <th className="p-3 text-right">Elo</th>
                <th className="p-3 text-right">Matches</th>
                <th className="p-3 text-right">Gen</th>
                <th className="p-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v, i) => (
                <Fragment key={v.id}>
                  <tr
                    className={`border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)] ${v.is_winner ? 'bg-[var(--status-success)]/5' : ''}`}
                    data-testid={`variant-row-${i}`}
                  >
                    <td className="p-3 text-[var(--text-muted)]">
                      #{i + 1}
                      {v.is_winner && <span className="ml-1 text-[var(--status-success)] text-xs">Winner</span>}
                    </td>
                    <td className="p-3 font-mono text-xs">{v.agent_name}</td>
                    <td className="p-3 text-right font-semibold">{Math.round(v.elo_score)}</td>
                    <td className="p-3 text-right text-[var(--text-muted)]">{v.match_count}</td>
                    <td className="p-3 text-right text-[var(--text-muted)]">{v.generation}</td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}
                          className="text-[var(--accent-gold)] hover:underline text-xs"
                        >
                          {expandedId === v.id ? 'Hide' : 'Preview'}
                        </button>
                        {run.status === 'completed' && !v.is_winner && (
                          <button
                            onClick={() => onApplyWinner(v.id)}
                            data-testid={`apply-winner-${i}`}
                            className="text-[var(--status-success)] hover:underline text-xs"
                          >
                            Apply
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === v.id && (
                    <tr key={`${v.id}-preview`}>
                      <td colSpan={6} className="p-4 bg-[var(--surface-secondary)]">
                        <pre className="whitespace-pre-wrap text-xs text-[var(--text-secondary)] max-h-64 overflow-y-auto">
                          {v.variant_content}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}

        {/* Cost breakdown */}
        {costBreakdown && costBreakdown.length > 0 && (
          <div className="border-t border-[var(--border-default)] pt-4">
            <AgentCostChart breakdown={costBreakdown} />
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────

export default function EvolutionAdminPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<EvolutionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<EvolutionRunStatus | ''>('');
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [showQueueDialog, setShowQueueDialog] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Variant panel state
  const [selectedRun, setSelectedRun] = useState<EvolutionRun | null>(null);
  const [variants, setVariants] = useState<EvolutionVariant[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    const filters: { status?: EvolutionRunStatus; startDate?: string } = {};
    if (statusFilter) filters.status = statusFilter;
    const startDate = getStartDate(dateRange);
    if (startDate) filters.startDate = startDate;

    const result = await getEvolutionRunsAction(
      Object.keys(filters).length > 0 ? filters : undefined,
    );
    if (result.success && result.data) {
      setRuns(result.data);
    } else {
      setError(result.error?.message || 'Failed to load runs');
    }
    setLoading(false);
  }, [statusFilter, dateRange]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const handleQueue = async (explanationId: number, budgetCapUsd: number): Promise<void> => {
    setActionLoading(true);
    const result = await queueEvolutionRunAction({ explanationId, budgetCapUsd });
    if (result.success) {
      toast.success('Evolution run queued');
      setShowQueueDialog(false);
      loadRuns();
    } else {
      toast.error(result.error?.message || 'Failed to queue run');
    }
    setActionLoading(false);
  };

  const handleTrigger = async (runId: string): Promise<void> => {
    setActionLoading(true);
    const result = await triggerEvolutionRunAction(runId);
    if (result.success) {
      toast.success('Evolution run triggered');
      loadRuns();
    } else {
      toast.error(result.error?.message || 'Failed to trigger run');
    }
    setActionLoading(false);
  };

  const handleViewVariants = async (run: EvolutionRun): Promise<void> => {
    setSelectedRun(run);
    setVariantsLoading(true);
    const result = await getEvolutionVariantsAction(run.id);
    if (result.success && result.data) {
      setVariants(result.data);
    } else {
      toast.error('Failed to load variants');
    }
    setVariantsLoading(false);
  };

  const handleApplyWinner = async (variantId: string): Promise<void> => {
    if (!selectedRun) return;
    if (selectedRun.explanation_id === null) {
      toast.error('Cannot apply winner: run has no explanation_id');
      return;
    }
    setActionLoading(true);
    const result = await applyWinnerAction({
      explanationId: selectedRun.explanation_id,
      variantId,
      runId: selectedRun.id,
    });
    if (result.success) {
      toast.success('Winner applied to article');
      handleViewVariants(selectedRun);
      loadRuns();
    } else {
      toast.error(result.error?.message || 'Failed to apply winner');
    }
    setActionLoading(false);
  };

  const handleRollback = async (run: EvolutionRun): Promise<void> => {
    if (run.explanation_id === null) {
      toast.error('Cannot rollback: run has no explanation_id');
      return;
    }
    setActionLoading(true);
    const historyResult = await getEvolutionHistoryAction(run.explanation_id);

    if (!historyResult.success || !historyResult.data || historyResult.data.length === 0) {
      toast.error('No evolution history found to rollback');
      setActionLoading(false);
      return;
    }

    const latestHistory = historyResult.data[0];
    if (!confirm(`Restore previous content for explanation #${run.explanation_id}?`)) {
      setActionLoading(false);
      return;
    }

    const result = await rollbackEvolutionAction({
      explanationId: run.explanation_id,
      historyId: latestHistory.id,
    });

    if (result.success) {
      toast.success('Content rolled back successfully');
      loadRuns();
    } else {
      toast.error(result.error?.message || 'Failed to rollback');
    }
    setActionLoading(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Content Evolution
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Evolve article content via Elo-ranked variant generation
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRange)}
            data-testid="evolution-date-filter"
            className="relative z-10 px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)]"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EvolutionRunStatus | '')}
            data-testid="evolution-status-filter"
            className="relative z-10 px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)]"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="paused">Paused</option>
          </select>
          <button
            onClick={() => setShowQueueDialog(true)}
            data-testid="queue-evolution-btn"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90"
          >
            Queue for Evolution
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <SummaryCards runs={runs} />

      {/* Start Run */}
      <StartRunCard onQueued={loadRuns} />

      {/* Error */}
      {error && (
        <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)]">
          {error}
        </div>
      )}

      {/* Runs table */}
      <div className="overflow-x-auto border border-[var(--border-default)] rounded-book" data-testid="evolution-runs-table">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <th className="p-3 text-left">Run ID</th>
              <th className="p-3 text-left">Explanation</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Phase</th>
              <th className="p-3 text-right">Variants</th>
              <th className="p-3 text-right">Cost</th>
              <th className="p-3 text-right">Est.</th>
              <th className="p-3 text-right">Budget</th>
              <th className="p-3 text-left">Created</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-[var(--text-muted)]">Loading...</td>
              </tr>
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-[var(--text-muted)]">
                  No evolution runs found
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)] cursor-pointer"
                  data-testid={`run-row-${run.id}`}
                  onClick={() => router.push(`/admin/quality/evolution/run/${run.id}`)}
                >
                  <td className="p-3">
                    <Link
                      href={`/admin/quality/evolution/run/${run.id}`}
                      className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
                      title={run.id}
                    >
                      {run.id.substring(0, 8)}
                    </Link>
                  </td>
                  <td className="p-3">
                    {run.explanation_id ? (
                      <span className="font-mono text-xs text-[var(--text-secondary)]">
                        #{run.explanation_id}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <EvolutionStatusBadge status={run.status} />
                  </td>
                  <td className="p-3 text-[var(--text-secondary)] text-xs">{run.phase}</td>
                  <td className="p-3 text-right">{run.variants_generated}</td>
                  <td className="p-3 text-right font-mono">${run.total_cost_usd.toFixed(2)}</td>
                  <td className="p-3 text-right font-mono">
                    {run.estimated_cost_usd != null ? (
                      <span className={
                        run.status === 'completed' && run.total_cost_usd > 0
                          ? Math.abs(run.total_cost_usd - run.estimated_cost_usd) / Math.max(run.estimated_cost_usd, 0.001) <= 0.1
                            ? 'text-[var(--status-success)]'
                            : Math.abs(run.total_cost_usd - run.estimated_cost_usd) / Math.max(run.estimated_cost_usd, 0.001) <= 0.3
                              ? 'text-[var(--accent-gold)]'
                              : 'text-[var(--status-error)]'
                          : 'text-[var(--text-muted)]'
                      }>
                        ${run.estimated_cost_usd.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-[var(--text-muted)]">${run.budget_cap_usd.toFixed(2)}</td>
                  <td className="p-3 text-[var(--text-muted)] text-xs">
                    {new Date(run.created_at).toLocaleDateString()}{' '}
                    <span className="text-[var(--text-muted)]/70">
                      {new Date(run.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleViewVariants(run)}
                        data-testid={`view-variants-${run.id}`}
                        className="text-[var(--accent-gold)] hover:underline text-xs"
                      >
                        Variants
                      </button>
                      {run.status === 'pending' && (
                        <button
                          onClick={() => handleTrigger(run.id)}
                          disabled={actionLoading}
                          data-testid={`trigger-run-${run.id}`}
                          className="text-[var(--accent-gold)] hover:underline text-xs disabled:opacity-50"
                        >
                          Trigger
                        </button>
                      )}
                      {run.status === 'completed' && (
                        <button
                          onClick={() => handleRollback(run)}
                          disabled={actionLoading}
                          data-testid={`rollback-${run.id}`}
                          className="text-[var(--status-error)] hover:underline text-xs disabled:opacity-50"
                        >
                          Rollback
                        </button>
                      )}
                      {run.error_message && (
                        <span className="text-[var(--status-error)] text-xs truncate max-w-[150px]" title={run.error_message}>
                          {run.error_message}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Dialogs */}
      {showQueueDialog && (
        <QueueDialog
          onQueue={handleQueue}
          onClose={() => setShowQueueDialog(false)}
        />
      )}

      {selectedRun && (
        <VariantPanel
          run={selectedRun}
          variants={variants}
          loading={variantsLoading}
          onApplyWinner={handleApplyWinner}
          onClose={() => { setSelectedRun(null); setVariants([]); }}
        />
      )}
    </div>
  );
}
