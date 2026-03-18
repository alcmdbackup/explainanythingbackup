// Shared configurable runs table for evolution dashboard and pipeline runs pages.
// Supports compact (dashboard) and full (evolution) modes via column definitions.
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EvolutionStatusBadge } from '@evolution/components/evolution';
import { TableSkeleton } from '@evolution/components/evolution/TableSkeleton';
import { EmptyState } from '@evolution/components/evolution/EmptyState';
import { ElapsedTime } from '@evolution/components/evolution/ElapsedTime';
import { buildExplanationUrl, buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCost } from '@evolution/lib/utils/formatters';
import type { EvolutionRunStatus, PipelinePhase } from '@evolution/lib/types';

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

/** Minimum fields required for any run table row. */
export interface BaseRun {
  id: string;
  explanation_id: number | null;
  status: EvolutionRunStatus;
  phase?: PipelinePhase | string;
  current_iteration?: number;
  total_cost_usd?: number;
  budget_cap_usd?: number;
  error_message: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

/** Column definition for the runs table. */
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
  /** Actions column renderer — omit for read-only tables. */
  renderActions?: (run: T) => React.ReactNode;
  testId?: string;
}

// ─── Default columns ─────────────────────────────────────────────

/** Standard columns shared by dashboard and evolution pages. */
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
        <EvolutionStatusBadge status={run.status} hasError={!!run.error_message} />
      ),
    },
    {
      key: 'phase',
      header: 'Phase',
      render: (run) => (
        <span className="text-[var(--text-secondary)] text-xs">{run.phase ?? '—'}</span>
      ),
    },
    {
      key: 'iteration',
      header: 'Progress',
      align: 'right',
      render: (run) => {
        const pct = (run.budget_cap_usd ?? 0) > 0 ? Math.min((run.total_cost_usd ?? 0) / (run.budget_cap_usd ?? 1), 1) : 0;
        const isActive = run.status === 'running' || run.status === 'claimed';
        return (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[var(--text-muted)]">Iter {run.current_iteration ?? 0}</span>
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
      key: 'cost',
      header: 'Cost',
      align: 'right',
      render: (run) => {
        const pct = (run.budget_cap_usd ?? 0) > 0 ? (run.total_cost_usd ?? 0) / (run.budget_cap_usd ?? 1) : 0;
        return (
          <span className="font-mono inline-flex items-center gap-1">
            {formatCost(run.total_cost_usd ?? 0)}
            {pct >= 0.8 && (
              <BudgetWarning pct={pct} budgetCapUsd={run.budget_cap_usd ?? 0} />
            )}
          </span>
        );
      },
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (run) => (
        <ElapsedTime startedAt={run.started_at ?? null} completedAt={run.completed_at ?? null} status={run.status} />
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
