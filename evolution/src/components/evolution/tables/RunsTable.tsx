'use client';
// Shared configurable runs table for evolution dashboard and pipeline runs pages.
// V2 schema: no phase/current_iteration columns; cost is read from the run's `metrics`
// array (looking up the `cost` metric row from `evolution_metrics`).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StatusBadge } from '../primitives/StatusBadge';
import { TableSkeleton } from './TableSkeleton';
import { EmptyState } from '../primitives/EmptyState';
import { buildExplanationUrl, buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCost, formatDate } from '@evolution/lib/utils/formatters';
import type { MetricRow } from '@evolution/lib/metrics/types';

function getMetricValue(metrics: MetricRow[] | undefined, name: string): number {
  return metrics?.find(m => m.metric_name === name)?.value ?? 0;
}

/** Fix #1 (use_playwright_find_ux_issues_bugs_20260501): return null when the
 *  metric row is absent so callers can distinguish "missing data" from
 *  "genuinely 0". Used by the Spent column to avoid showing "$0.00" for runs
 *  that have no cost row at all (which would suggest a free run rather than
 *  missing data). */
function getMetricValueOrNull(metrics: MetricRow[] | undefined, name: string): number | null {
  const row = metrics?.find(m => m.metric_name === name);
  return row ? row.value : null;
}

function getProgressBarColor(pct: number): string {
  if (pct >= 0.9) return 'bg-[var(--status-error)]';
  if (pct >= 0.7) return 'bg-[var(--status-warning)]';
  return 'bg-[var(--accent-gold)]';
}

function BudgetWarning({ pct, budgetCapUsd }: { pct: number; budgetCapUsd: number }): JSX.Element {
  const isCritical = pct >= 0.9;
  // B001-S7: Tailwind JIT only ships static class strings — runtime-constructed
  // `bg-[var(${colorVar})]/15` produced no CSS, leaving the warning unstyled. Branch
  // to two static classes instead.
  const className = isCritical
    ? 'text-xs px-1 rounded bg-[var(--status-error)]/15 text-[var(--status-error)]'
    : 'text-xs px-1 rounded bg-[var(--status-warning)]/15 text-[var(--status-warning)]';
  return (
    <span
      className={className}
      title={`${Math.round(pct * 100)}% of ${formatCost(budgetCapUsd)} budget`}
      data-testid="budget-warning"
    >
      {isCritical ? '!!' : '!'}
    </span>
  );
}

/** V2 run shape for RunsTable rows. */
export interface BaseRun {
  id: string;
  explanation_id: number | null;
  status: string;
  /** Metric rows from evolution_metrics, including cost / generation_cost / ranking_cost. */
  metrics?: MetricRow[];
  budget_cap_usd: number;
  error_message: string | null;
  completed_at: string | null;
  created_at: string;
  strategy_name?: string | null;
  explanation_title?: string | null;
}

export interface RunsColumnDef<T extends BaseRun> {
  key: string;
  header: string;
  /** U23 (use_playwright_find_bugs_ux_issues_20260422): hover-tooltip on the
   *  column header. Surfaces metric descriptions. */
  headerTitle?: string;
  align?: 'left' | 'right';
  minWidth?: string;
  render: (run: T) => React.ReactNode;
}

interface RunsTableProps<T extends BaseRun> {
  runs: T[];
  columns: RunsColumnDef<T>[];
  loading?: boolean;
  compact?: boolean;
  maxRows?: number;
  onRowClick?: (run: T) => void;
  renderActions?: (run: T) => React.ReactNode;
  testId?: string;
}

export function getBaseColumns<T extends BaseRun>(): RunsColumnDef<T>[] {
  return [
    {
      key: 'explanation',
      header: 'Explanation',
      render: (run) => run.explanation_id ? (
        <span className="flex items-center gap-1.5">
          <Link
            href={buildExplanationUrl(run.explanation_id)}
            className="text-xs text-[var(--accent-gold)] hover:underline truncate max-w-[200px]"
            onClick={(e) => e.stopPropagation()}
            title={run.explanation_title ?? `Explanation #${run.explanation_id}`}
          >
            {run.explanation_title ?? `#${run.explanation_id}`}
          </Link>
        </span>
      ) : (
        <Link
          href={buildRunUrl(run.id)}
          className="font-mono text-xs text-[var(--text-muted)] hover:underline"
          onClick={(e) => e.stopPropagation()}
          title={run.id}
        >
          {run.id.substring(0, 8)}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (run) => (
        <StatusBadge variant="run-status" status={run.status} hasError={!!run.error_message} />
      ),
    },
    {
      key: 'strategy',
      header: 'Strategy',
      render: (run) => (
        <span className="text-[var(--text-secondary)] text-xs">{run.strategy_name ?? '—'}</span>
      ),
    },
    {
      key: 'cost',
      header: 'Spent',
      align: 'right',
      render: (run) => {
        // B2 (use_playwright_find_bugs_ux_issues_20260422): the `cost` rollup
        // metric isn't always populated — older runs have only per-phase
        // `generation_cost` / `ranking_cost` / `seed_cost` rows. Fall back
        // to summing those when `cost` is missing so the Spent column
        // stays consistent with the dashboard (which uses
        // getRunCostsWithFallback for the same reason).
        const direct = getMetricValueOrNull(run.metrics, 'cost');
        // Fix #11 (use_playwright_find_ux_issues_bugs_20260501): include
        // reflection_cost in the fallback sum so reflect+generate runs reconcile
        // when the rollup `cost` row is missing. Mirrors getRunCostWithFallback.
        // Option H (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529):
        // widened to include `paragraph_recombine_cost`, `evaluation_cost`,
        // `iterative_edit_cost`, `proposer_approver_criteria_cost`, `debate_cost`.
        // Pre-fix any paragraph_recombine-only run with a missing `cost` rollup row
        // would under-report by the full paragraph_recombine spend.
        const gen = getMetricValueOrNull(run.metrics, 'generation_cost');
        const rank = getMetricValueOrNull(run.metrics, 'ranking_cost');
        const refl = getMetricValueOrNull(run.metrics, 'reflection_cost');
        const seed = getMetricValueOrNull(run.metrics, 'seed_cost');
        const evalCost = getMetricValueOrNull(run.metrics, 'evaluation_cost');
        const iterEdit = getMetricValueOrNull(run.metrics, 'iterative_edit_cost');
        const proposerApprover = getMetricValueOrNull(run.metrics, 'proposer_approver_criteria_cost');
        const paragraphRecombine = getMetricValueOrNull(run.metrics, 'paragraph_recombine_cost');
        const debate = getMetricValueOrNull(run.metrics, 'debate_cost');
        const hasFallback = gen != null || rank != null || refl != null || seed != null
          || evalCost != null || iterEdit != null || proposerApprover != null
          || paragraphRecombine != null || debate != null;
        // Fix #1: distinguish "no cost data" from "$0.00 spent". When neither
        // the rollup nor any per-purpose row exists, render formatCost(null) → "—".
        const cost = direct != null && direct > 0
          ? direct
          : hasFallback
            ? (gen ?? 0) + (rank ?? 0) + (refl ?? 0) + (seed ?? 0)
              + (evalCost ?? 0) + (iterEdit ?? 0) + (proposerApprover ?? 0)
              + (paragraphRecombine ?? 0) + (debate ?? 0)
            : null;
        const pct = run.budget_cap_usd > 0 && cost != null ? cost / run.budget_cap_usd : 0;
        const isActive = run.status === 'running' || run.status === 'claimed';
        return (
          <div className="flex flex-col items-end gap-0.5">
            <span className="font-mono inline-flex items-center gap-1">
              {formatCost(cost)}
              {pct >= 0.8 && <BudgetWarning pct={pct} budgetCapUsd={run.budget_cap_usd} />}
            </span>
            {isActive && (
              <div className="w-12 h-1 rounded-full bg-[var(--surface-secondary)] overflow-hidden" data-testid="progress-bar" title={`${Math.round(pct * 100)}% budget used`}>
                <div
                  className={`h-full rounded-full ${getProgressBarColor(pct)}`}
                  style={{ width: `${Math.round(pct * 100)}%` }}
                />
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'budget',
      header: 'Budget',
      align: 'right',
      render: (run) => (
        <span className="font-mono text-[var(--text-muted)]">{formatCost(run.budget_cap_usd)}</span>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      minWidth: '6rem',
      render: (run) => (
        <span className="text-[var(--text-muted)] text-xs whitespace-nowrap">
          {formatDate(run.created_at)}
        </span>
      ),
    },
  ];
}

export function RunsTable<T extends BaseRun>({
  runs,
  columns,
  loading = false,
  compact = false,
  maxRows,
  onRowClick,
  renderActions,
  testId = 'runs-table',
}: RunsTableProps<T>): JSX.Element {
  const router = useRouter();
  const displayRuns = maxRows ? runs.slice(0, maxRows) : runs;
  const totalColumns = columns.length + (renderActions ? 1 : 0);

  const handleRowClick = (run: T): void => {
    if (onRowClick) onRowClick(run);
    else router.push(buildRunUrl(run.id));
  };

  return (
    <div className="overflow-x-auto border border-[var(--border-default)] rounded-book" data-testid={testId}>
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface-elevated)]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${compact ? 'px-2 py-1.5' : 'p-3'} text-${col.align ?? 'left'}`}
                style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                title={col.headerTitle}
              >
                {col.header}
              </th>
            ))}
            {renderActions && <th className={`${compact ? 'px-2 py-1.5' : 'p-3'} text-left`}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={totalColumns} className="p-0">
                <TableSkeleton columns={totalColumns} rows={compact ? 3 : 5} />
              </td>
            </tr>
          ) : displayRuns.length === 0 ? (
            <tr>
              <td colSpan={totalColumns}>
                <EmptyState message="No runs found" suggestion="Start a pipeline or adjust filters to see results" />
              </td>
            </tr>
          ) : (
            displayRuns.map((run) => (
              <tr
                key={run.id}
                className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)] cursor-pointer"
                data-testid={`run-row-${run.id}`}
                onClick={() => handleRowClick(run)}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`${compact ? 'px-2 py-1.5' : 'p-3'} ${col.align === 'right' ? 'text-right' : ''}`}
                  >
                    {col.render(run)}
                  </td>
                ))}
                {renderActions && (
                  <td className={compact ? 'px-2 py-1.5' : 'p-3'} onClick={(e) => e.stopPropagation()}>
                    {renderActions(run)}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {compact && maxRows && runs.length > maxRows && (
        <div className="p-2 text-center border-t border-[var(--border-default)]">
          <Link
            href="/admin/evolution/runs"
            className="text-xs text-[var(--accent-gold)] hover:underline"
          >
            View all {runs.length} runs
          </Link>
        </div>
      )}
    </div>
  );
}
