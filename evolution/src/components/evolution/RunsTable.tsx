'use client';
// Shared configurable runs table for evolution dashboard and pipeline runs pages.
// V2 schema: no phase/current_iteration columns; cost comes from enriched total_cost_usd field.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EvolutionStatusBadge } from '@evolution/components/evolution';
import { TableSkeleton } from '@evolution/components/evolution/TableSkeleton';
import { EmptyState } from '@evolution/components/evolution/EmptyState';
import { buildExplanationUrl, buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCost } from '@evolution/lib/utils/formatters';

// ─── Helpers ─────────────────────────────────────────────────────

function getProgressBarColor(pct: number): string {
  if (pct >= 0.9) return 'bg-[var(--status-error)]';
  if (pct >= 0.7) return 'bg-[var(--status-warning)]';
  return 'bg-[var(--accent-gold)]';
}

function BudgetWarning({ pct, budgetCapUsd }: { pct: number; budgetCapUsd: number }): JSX.Element {
  const isCritical = pct >= 0.9;
  const colorVar = isCritical ? '--status-error' : '--status-warning';
  return (
    <span
      className={`text-xs px-1 rounded bg-[var(${colorVar})]/15 text-[var(${colorVar})]`}
      title={`${Math.round(pct * 100)}% of ${formatCost(budgetCapUsd)} budget`}
      data-testid="budget-warning"
    >
      {isCritical ? '!!' : '!'}
    </span>
  );
}

// ─── Types ───────────────────────────────────────────────────────

/** V2 run shape for RunsTable rows. */
export interface BaseRun {
  id: string;
  explanation_id: number | null;
  status: string;
  total_cost_usd?: number;
  budget_cap_usd: number;
  error_message: string | null;
  completed_at: string | null;
  created_at: string;
  strategy_name?: string | null;
}

export interface RunsColumnDef<T extends BaseRun> {
  key: string;
  header: string;
  align?: 'left' | 'right';
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

// ─── Default columns ─────────────────────────────────────────────

export function getBaseColumns<T extends BaseRun>(): RunsColumnDef<T>[] {
  return [
    {
      key: 'explanation',
      header: 'Explanation',
      render: (run) => run.explanation_id ? (
        <span className="flex items-center gap-1.5">
          <Link
            href={buildExplanationUrl(run.explanation_id)}
            className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
            onClick={(e) => e.stopPropagation()}
            title={`View explanation #${run.explanation_id}`}
          >
            #{run.explanation_id}
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
        <EvolutionStatusBadge status={run.status as import('@evolution/lib/types').EvolutionRunStatus} hasError={!!run.error_message} />
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
        const cost = run.total_cost_usd ?? 0;
        const pct = run.budget_cap_usd > 0 ? cost / run.budget_cap_usd : 0;
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
      render: (run) => (
        <span className="text-[var(--text-muted)] text-xs">
          {new Date(run.created_at).toLocaleDateString()}
        </span>
      ),
    },
  ];
}

// ─── Component ───────────────────────────────────────────────────

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

  const handleRowClick = (run: T) => {
    if (onRowClick) {
      onRowClick(run);
    } else {
      router.push(buildRunUrl(run.id));
    }
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
