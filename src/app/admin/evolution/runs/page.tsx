// Evolution runs list page using EntityListPage with renderTable for RunsTable.
// Standardizes on the shared list page pattern while preserving RunsTable's budget bars.
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  EvolutionBreadcrumb,
  EntityListPage,
  RunsTable,
  getBaseColumns,
} from '@evolution/components/evolution';
import type { FilterDef } from '@evolution/components/evolution';
import { ConfirmDialog } from '@evolution/components/evolution';
import {
  getEvolutionRunsAction,
  killEvolutionRunAction,
  type EvolutionRun,
} from '@evolution/services/evolutionActions';
import { executeEntityAction } from '@evolution/services/entityActions';
import { listStrategiesAction } from '@evolution/services/strategyRegistryActions';
import { createRunsMetricColumns } from '@evolution/lib/metrics/metricColumns';

const STATUS_FILTER: FilterDef = {
  key: 'status',
  label: 'Status',
  type: 'select',
  options: [
    { label: 'All statuses', value: '' },
    { label: 'Pending', value: 'pending' },
    { label: 'Claimed', value: 'claimed' },
    { label: 'Running', value: 'running' },
    { label: 'Completed', value: 'completed' },
    { label: 'Failed', value: 'failed' },
  ],
};

const pageSize = 20;

type RunAction = { kind: 'none' } | { kind: 'kill'; run: EvolutionRun } | { kind: 'delete'; run: EvolutionRun };

/** U3 (use_playwright_find_bugs_ux_issues_20260422): popover-style column picker
 *  for the 14-column runs list. Uses a native <details> element so we don't
 *  pull in a Radix popover for one feature; checkbox state is fully controlled
 *  by the parent page via `hidden`/`onChange`. */
function ColumnPicker({ allColumns, hidden, onChange }: {
  allColumns: { key: string; label: string }[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
}): JSX.Element {
  const visibleCount = allColumns.length - hidden.size;
  return (
    <details className="relative inline-block" data-testid="runs-column-picker">
      <summary className="cursor-pointer text-xs font-ui px-3 py-1 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] inline-block">
        Columns ({visibleCount}/{allColumns.length})
      </summary>
      <div className="absolute z-10 mt-1 right-0 w-64 max-h-80 overflow-y-auto p-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-elevated)] shadow-warm-lg">
        {allColumns.map(c => (
          <label key={c.key} className="flex items-center gap-2 px-1 py-1 text-xs font-ui cursor-pointer hover:bg-[var(--surface-secondary)] rounded">
            <input
              type="checkbox"
              checked={!hidden.has(c.key)}
              onChange={(e) => {
                const next = new Set(hidden);
                if (e.target.checked) next.delete(c.key); else next.add(c.key);
                onChange(next);
              }}
              data-testid={`column-toggle-${c.key}`}
            />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

export default function EvolutionRunsPage(): JSX.Element {
  useEffect(() => { document.title = 'Runs | Evolution'; }, []);
  const [runs, setRuns] = useState<EvolutionRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<RunAction>({ kind: 'none' });
  const [strategyOptions, setStrategyOptions] = useState<{ value: string; label: string }[]>([]);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({ filterTestContent: 'true' });
  const [page, setPage] = useState(1);
  // U3 (use_playwright_find_bugs_ux_issues_20260422): persisted column-visibility
  // for the 14-column runs list. Hidden keys are stored as a JSON array in
  // localStorage so the choice survives reloads.
  const COL_VIS_KEY = 'evolution-runs-hidden-columns';
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(COL_VIS_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* localStorage unavailable / corrupt — ignore */ }
    return new Set();
  });
  useEffect(() => {
    try { window.localStorage.setItem(COL_VIS_KEY, JSON.stringify(Array.from(hiddenCols))); } catch { /* ignore */ }
  }, [hiddenCols]);

  // Build dynamic filter list including loaded strategy options
  const filters: FilterDef[] = [
    STATUS_FILTER,
    { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
    {
      key: 'strategy_id',
      label: 'Strategy',
      // U4 (use_playwright_find_bugs_ux_issues_20260422): combobox instead of
      // flat <select> — staging has hundreds of strategies and the unsearchable
      // dropdown was unscannable.
      type: 'combobox',
      placeholder: 'Search strategies...',
      options: [{ label: 'All strategies', value: '' }, ...strategyOptions],
    },
  ];

  useEffect(() => {
    // filterTestContent: true mirrors the runs-list "Hide test content" default —
    // dropdown options should not show [TEST]/[TEST_EVO]/e2e-* strategies that
    // the rows themselves are filtering out (B3 root cause #1).
    listStrategiesAction({ limit: 200, offset: 0, filterTestContent: true }).then(res => {
      if (res.success && res.data) {
        setStrategyOptions(res.data.items.map(s => ({ value: s.id, label: s.name })));
      }
    }).catch(() => { /* non-critical: strategy filter silently unavailable */ });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getEvolutionRunsAction({
      status: filterValues.status || undefined,
      filterTestContent: filterValues.filterTestContent === 'true',
      strategy_id: filterValues.strategy_id || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    if (result.success && result.data) {
      // getEvolutionRunsAction already enriches runs with `metrics` from evolution_metrics
      // (cost / generation_cost / ranking_cost / etc. via getMetricsForEntities).
      setTotal(result.data.total);
      setRuns(result.data.items);
    } else if (!result.success) {
      toast.error(result.error?.message ?? 'Failed to load runs');
    }
    setLoading(false);
  }, [filterValues, page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFilterChange = (key: string, value: string): void => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleKill = async (): Promise<void> => {
    if (pendingAction.kind !== 'kill') return;
    const result = await killEvolutionRunAction(pendingAction.run.id);
    if (result.success) { toast.success('Run killed'); load(); } else { toast.error(result.error?.message ?? 'Kill failed'); }
  };

  const handleDelete = async (): Promise<void> => {
    if (pendingAction.kind !== 'delete') return;
    const result = await executeEntityAction({ entityType: 'run', entityId: pendingAction.run.id, actionKey: 'delete' });
    if (result.success) { toast.success('Run deleted'); load(); } else { toast.error(result.error?.message ?? 'Delete failed'); }
  };

  const renderActions = (run: EvolutionRun): React.ReactNode => (
    <div className="flex gap-2">
      {['pending', 'claimed', 'running'].includes(run.status) && (
        <button onClick={() => setPendingAction({ kind: 'kill', run })} className="font-ui text-xs text-[var(--status-error)]">Kill</button>
      )}
      {['completed', 'failed', 'cancelled'].includes(run.status) && (
        <button onClick={() => setPendingAction({ kind: 'delete', run })} className="font-ui text-xs text-[var(--status-error)]">Delete</button>
      )}
    </div>
  );

  const confirmOpen = pendingAction.kind === 'kill' || pendingAction.kind === 'delete';
  const runIdShort = pendingAction.kind !== 'none' ? pendingAction.run.id.substring(0, 8) : '';
  const confirmProps = pendingAction.kind === 'kill'
    ? { title: 'Kill Run', message: `Kill run ${runIdShort}?`, confirmLabel: 'Kill', onConfirm: handleKill, danger: true }
    : { title: 'Delete Run', message: `Delete run ${runIdShort} and all its variants/invocations?`, confirmLabel: 'Delete', onConfirm: handleDelete, danger: true };

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Evolution', href: '/admin/evolution-dashboard' },
        { label: 'Runs' },
      ]} />

      {/* U3: column-picker popover. Renders just above the EntityListPage so
          users can collapse the runs list back to the columns they care about. */}
      <ColumnPicker
        allColumns={[...getBaseColumns(), ...createRunsMetricColumns()].map(c => ({ key: c.key, label: c.header }))}
        hidden={hiddenCols}
        onChange={setHiddenCols}
      />

      <EntityListPage<EvolutionRun>
        title="Evolution Runs"
        filters={filters}
        items={runs}
        loading={loading}
        totalCount={total}
        filterValues={filterValues}
        onFilterChange={handleFilterChange}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        emptyMessage="No runs found."
        renderTable={({ items: tableItems, loading: tableLoading }) => (
          <RunsTable
            runs={tableItems}
            columns={[...getBaseColumns(), ...createRunsMetricColumns()].filter(c => !hiddenCols.has(c.key))}
            loading={tableLoading}
            renderActions={renderActions}
            testId="runs-list-table"
          />
        )}
      />

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setPendingAction({ kind: 'none' })}
        {...confirmProps}
      />
    </div>
  );
}
