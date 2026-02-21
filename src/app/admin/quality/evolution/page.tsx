'use client';
// Admin page for managing evolution pipeline runs.
// Queue new runs, view variant rankings, apply winning content, rollback, and view quality impact.

import { Fragment, useState, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
  queueEvolutionRunAction,
  getEvolutionRunsAction,
  getEvolutionVariantsAction,
  applyWinnerAction,
  getEvolutionCostBreakdownAction,
  getEvolutionHistoryAction,
  rollbackEvolutionAction,
  estimateRunCostAction,
  type EvolutionRun,
  type EvolutionVariant,
  type AgentCostBreakdown,
  type CostEstimateResult,
} from '@evolution/services/evolutionActions';
import { triggerEvolutionRun } from '@evolution/services/evolutionRunClient';
import { getPromptsAction } from '@evolution/services/promptRegistryActions';
import { getStrategiesAction } from '@evolution/services/strategyRegistryActions';
import { isTestEntry } from '@evolution/lib/core/configValidation';
import { dispatchEvolutionBatchAction } from '@evolution/services/evolutionBatchActions';
import type { EvolutionRunStatus } from '@evolution/lib/types';
import Link from 'next/link';
import { EvolutionStatusBadge } from '@evolution/components/evolution';
import { RunsTable, getBaseColumns, type RunsColumnDef } from '@evolution/components/evolution/RunsTable';
import { buildExplanationUrl } from '@evolution/lib/utils/evolutionUrls';

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
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function getConfidenceStyle(confidence: string): { bg: string; text: string; title?: string } {
  if (confidence === 'high') {
    return { bg: 'bg-[var(--status-success)]/10', text: 'text-[var(--status-success)]' };
  }
  if (confidence === 'medium') {
    return { bg: 'bg-[var(--accent-gold)]/10', text: 'text-[var(--accent-gold)]' };
  }
  return {
    bg: 'bg-[var(--text-muted)]/10',
    text: 'text-[var(--text-muted)]',
    ...(confidence === 'low' && { title: 'No historical data yet — estimate is heuristic-based' }),
  };
}

function ConfidenceBadge({ confidence }: { confidence: string }): JSX.Element {
  const style = getConfidenceStyle(confidence);
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}
      title={style.title}
    >
      {confidence}
    </span>
  );
}

function getEstimateColorClass(run: EvolutionRun): string {
  if (run.status !== 'completed' || run.total_cost_usd === 0) {
    return 'text-[var(--text-muted)]';
  }

  const deviation = Math.abs(run.total_cost_usd - (run.estimated_cost_usd ?? 0))
    / Math.max(run.estimated_cost_usd ?? 0, 0.001);

  if (deviation <= 0.1) return 'text-[var(--status-success)]';
  if (deviation <= 0.3) return 'text-[var(--accent-gold)]';
  return 'text-[var(--status-error)]';
}

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
        setPrompts(pRes.data.filter(p => !isTestEntry(p.title)).map(p => ({ id: p.id, label: p.title })));
      }
      if (sRes.success && sRes.data) {
        setStrategies(sRes.data.filter(s => !isTestEntry(s.name)).map(s => ({ id: s.id, label: s.name })));
      }
    })();
  }, []);

  useEffect(() => {
    if (!strategyId) {
      setEstimate(null);
      return;
    }

    const timer = setTimeout(async () => {
      setEstimateLoading(true);
      const result = await estimateRunCostAction({ strategyId });
      setEstimate(result.success && result.data ? result.data : null);
      setEstimateLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [strategyId]);

  const handleStart = async (): Promise<void> => {
    if (!promptId) {
      toast.error('Select a prompt');
      return;
    }
    if (!strategyId) {
      toast.error('Select a strategy');
      return;
    }
    const cap = parseFloat(budget);
    if (!cap || cap <= 0) {
      toast.error('Budget must be positive');
      return;
    }

    setSubmitting(true);
    const result = await queueEvolutionRunAction({ promptId, strategyId, budgetCapUsd: cap });
    if (result.success && result.data) {
      toast.success('Run queued — triggering pipeline...');
      onQueued();

      try {
        const triggerResult = await triggerEvolutionRun(result.data.id);
        if (triggerResult.claimed) {
          toast.success('Pipeline started');
        } else {
          toast.info('Run queued but not claimed — cron will pick it up');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Pipeline trigger failed');
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
            <ConfidenceBadge confidence={estimate.confidence} />
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

function BatchDispatchButtons({ pendingCount, onRunCompleted }: { pendingCount: number; onRunCompleted: () => void }) {
  const [dispatching, setDispatching] = useState(false);
  const [runningNext, setRunningNext] = useState(false);

  const handleDispatch = async (maxRuns?: number) => {
    setDispatching(true);
    const result = await dispatchEvolutionBatchAction({
      parallel: 5,
      maxRuns: maxRuns ?? 10,
      dryRun: false,
    });
    if (result.success) {
      toast.success('Batch dispatched — runs will appear as they are claimed');
    } else {
      toast.error(result.error?.message || 'Failed to dispatch batch');
    }
    setDispatching(false);
  };

  const handleRunNext = async () => {
    setRunningNext(true);
    try {
      const result = await triggerEvolutionRun();
      if (!result.claimed) {
        toast.info('No pending runs in queue');
      } else {
        toast.success(`Run ${result.runId?.slice(0, 8)} completed (${result.stopReason})`);
        onRunCompleted();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run');
    }
    setRunningNext(false);
  };

  return (
    <div className="flex items-center gap-2" data-testid="batch-dispatch-section">
      {pendingCount > 0 && (
        <button
          onClick={handleRunNext}
          disabled={runningNext || dispatching}
          data-testid="run-next-pending-btn"
          className="px-3 py-1.5 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page font-ui text-xs hover:opacity-90 disabled:opacity-50"
        >
          {runningNext ? 'Running...' : `Run Next Pending (${pendingCount})`}
        </button>
      )}
      <button
        onClick={() => handleDispatch()}
        disabled={dispatching || runningNext}
        data-testid="dispatch-batch-btn"
        className="px-3 py-1.5 border border-[var(--border-default)] rounded-page font-ui text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] disabled:opacity-50"
      >
        {dispatching ? 'Dispatching...' : 'Batch Dispatch'}
      </button>
      {pendingCount > 0 && (
        <button
          onClick={() => handleDispatch(pendingCount)}
          disabled={dispatching || runningNext}
          data-testid="trigger-all-pending-btn"
          className="px-3 py-1.5 border border-[var(--accent-gold)] text-[var(--accent-gold)] rounded-page font-ui text-xs hover:bg-[var(--accent-gold)]/10 disabled:opacity-50"
        >
          Trigger All Pending ({pendingCount})
        </button>
      )}
    </div>
  );
}

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
              {run.explanation_id ? (
                <Link
                  href={buildExplanationUrl(run.explanation_id)}
                  className="text-[var(--accent-gold)] hover:underline"
                >
                  Explanation #{run.explanation_id}
                </Link>
              ) : (
                <span>Run {run.id.substring(0, 8)}</span>
              )} &middot; {run.total_variants} variants &middot;{' '}
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
                <th className="p-3 text-right">Rating</th>
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

        {costBreakdown && (
          <div className="border-t border-[var(--border-default)] pt-4">
            <AgentCostChart breakdown={costBreakdown} />
          </div>
        )}

      </div>
    </div>
  );
}

export default function EvolutionAdminPage() {
  const [runs, setRuns] = useState<EvolutionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<EvolutionRunStatus | ''>('');
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [actionLoading, setActionLoading] = useState(false);

  // Variant panel state
  const [selectedRun, setSelectedRun] = useState<EvolutionRun | null>(null);
  const [variants, setVariants] = useState<EvolutionVariant[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);

  const evolutionColumns = useMemo<RunsColumnDef<EvolutionRun>[]>(() => {
    const base = getBaseColumns<EvolutionRun>();
    const runIdCol: RunsColumnDef<EvolutionRun> = {
      key: 'runId',
      header: 'Run ID',
      render: (run) => (
        <Link
          href={`/admin/quality/evolution/run/${run.id}`}
          className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
          title={run.id}
          onClick={(e) => e.stopPropagation()}
        >
          {run.id.substring(0, 8)}
        </Link>
      ),
    };
    const explCol: RunsColumnDef<EvolutionRun> = {
      key: 'explanation',
      header: 'Explanation',
      render: (run) => run.explanation_id ? (
        <Link
          href={buildExplanationUrl(run.explanation_id)}
          className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
          onClick={(e) => e.stopPropagation()}
          title={`View explanation #${run.explanation_id}`}
        >
          #{run.explanation_id}
        </Link>
      ) : (
        <span className="text-[var(--text-muted)]">&mdash;</span>
      ),
    };
    const variantsCol: RunsColumnDef<EvolutionRun> = {
      key: 'variants',
      header: 'Variants',
      align: 'right',
      render: (run) => <span>{run.total_variants}</span>,
    };
    const estCol: RunsColumnDef<EvolutionRun> = {
      key: 'estimate',
      header: 'Est.',
      align: 'right',
      render: (run) => run.estimated_cost_usd != null ? (
        <span className={`font-mono ${getEstimateColorClass(run)}`}>
          ${run.estimated_cost_usd.toFixed(2)}
        </span>
      ) : (
        <span className="text-[var(--text-muted)]">&mdash;</span>
      ),
    };
    const budgetCol: RunsColumnDef<EvolutionRun> = {
      key: 'budget',
      header: 'Budget',
      align: 'right',
      render: (run) => <span className="text-[var(--text-muted)]">${run.budget_cap_usd.toFixed(2)}</span>,
    };
    const createdWithTimeCol: RunsColumnDef<EvolutionRun> = {
      key: 'created',
      header: 'Created',
      render: (run) => (
        <span className="text-[var(--text-muted)] text-xs">
          {new Date(run.created_at).toLocaleDateString()}{' '}
          <span className="opacity-70">
            {new Date(run.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </span>
      ),
    };
    return [
      runIdCol,
      explCol,
      base.find(c => c.key === 'status')!,
      base.find(c => c.key === 'phase')!,
      variantsCol,
      base.find(c => c.key === 'cost')!,
      estCol,
      budgetCol,
      base.find(c => c.key === 'duration')!,
      createdWithTimeCol,
    ];
  }, []);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await getEvolutionRunsAction({
      status: statusFilter || undefined,
      startDate: getStartDate(dateRange),
    });

    if (result.success && result.data) {
      setRuns(result.data);
    } else {
      setError(result.error?.message || 'Failed to load runs');
    }
    setLoading(false);
  }, [statusFilter, dateRange]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const handleTrigger = async (runId: string): Promise<void> => {
    setActionLoading(true);
    try {
      const result = await triggerEvolutionRun(runId);
      if (result.claimed) {
        toast.success('Evolution run triggered');
      } else {
        toast.info('Run was already claimed — cron will handle it');
      }
      loadRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to trigger run');
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
    try {
      const historyResult = await getEvolutionHistoryAction(run.explanation_id);

      if (!historyResult.success || !historyResult.data || historyResult.data.length === 0) {
        toast.error('No evolution history found to rollback');
        return;
      }

      const latestHistory = historyResult.data[0];
      if (!confirm(`Restore previous content for explanation #${run.explanation_id}?`)) {
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
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Pipeline Runs
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Queue, manage, and monitor evolution pipeline runs
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
            <option value="continuation_pending">Resuming</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="paused">Paused</option>
          </select>
        </div>
      </div>

      <SummaryCards runs={runs} />
      <StartRunCard onQueued={loadRuns} />
      <BatchDispatchButtons pendingCount={runs.filter((r) => r.status === 'pending').length} onRunCompleted={loadRuns} />

      {error && (
        <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)]">
          {error}
        </div>
      )}

      <RunsTable<EvolutionRun>
        runs={runs}
        columns={evolutionColumns}
        loading={loading}
        renderActions={(run) => (
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
        )}
        testId="evolution-runs-table"
      />

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
