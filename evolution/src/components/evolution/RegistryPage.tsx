// Config-driven list page with CRUD dialog orchestration.
// Wraps EntityListPage with FormDialog + ConfirmDialog for create/edit/archive flows.

'use client';

import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { EvolutionBreadcrumb, EntityListPage } from '@evolution/components/evolution';
import type { ColumnDef, FilterDef } from '@evolution/components/evolution';
import { FormDialog, type FieldDef } from './FormDialog';
import { ConfirmDialog } from './ConfirmDialog';

export interface RowAction<T> {
  label: string;
  onClick: (row: T) => void;
  visible?: (row: T) => boolean;
  danger?: boolean;
}

export interface RegistryPageConfig<T> {
  title: string;
  breadcrumbs: Array<{ label: string; href?: string }>;
  columns: ColumnDef<T>[];
  filters: FilterDef[];
  /** Fetch data. Returns items array. */
  loadData: (filters: Record<string, string>, page: number, pageSize: number) => Promise<{ items: T[]; total: number }>;
  /** Row click URL. */
  getRowHref?: (row: T) => string;
  /** Row actions (edit, archive, delete, etc). */
  rowActions?: RowAction<T>[];
  /** Header action button (e.g., "Add Prompt"). */
  headerAction?: { label: string; onClick: () => void };
  /** Empty state message. */
  emptyMessage?: string;
  /** Page size (default 50). */
  pageSize?: number;
}

export function RegistryPage<T extends { id: string }>({
  config,
  formDialog,
  confirmDialog,
}: {
  config: RegistryPageConfig<T>;
  formDialog?: {
    open: boolean;
    onClose: () => void;
    title: string;
    fields: FieldDef[];
    initial?: Record<string, unknown>;
    onSubmit: (values: Record<string, unknown>) => Promise<void>;
    validate?: (values: Record<string, unknown>) => string | null;
    children?: ReactNode;
  };
  confirmDialog?: {
    open: boolean;
    onClose: () => void;
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => Promise<void>;
    danger?: boolean;
  };
}): JSX.Element {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const f of config.filters) {
      if (f.type === 'checkbox' && f.defaultChecked) {
        defaults[f.key] = 'true';
      }
    }
    return defaults;
  });
  const [page, setPage] = useState(1);
  const pageSize = config.pageSize ?? 50;

  // Use ref for config.loadData to avoid infinite re-render loop
  // (config is a new object every render, which would cause useCallback to recreate on every render)
  const loadDataFnRef = useRef(config.loadData);
  loadDataFnRef.current = config.loadData;

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await loadDataFnRef.current(filterValues, page, pageSize);
      setItems(result.items);
      setTotal(result.total);
    } catch {
      toast.error('Failed to load data');
    }
    setLoading(false);
  }, [filterValues, page, pageSize]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleFilterChange = (key: string, value: string): void => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  // Build columns with actions column if rowActions defined
  const columnsWithActions: ColumnDef<T>[] = config.rowActions
    ? [
        ...config.columns,
        {
          key: '_actions',
          header: 'Actions',
          render: (row: T) => (
            <div className="flex gap-2">
              {config.rowActions!
                .filter((a) => !a.visible || a.visible(row))
                .map((action) => (
                  <button
                    key={action.label}
                    onClick={(e) => { e.stopPropagation(); action.onClick(row); }}
                    className={`font-ui text-xs ${action.danger ? 'text-[var(--status-error)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                  >
                    {action.label}
                  </button>
                ))}
            </div>
          ),
        },
      ]
    : config.columns;

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[...config.breadcrumbs, { label: config.title }]} />

      <div className="flex justify-between items-start">
        <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">{config.title}</h1>
        {config.headerAction && (
          <button
            onClick={config.headerAction.onClick}
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page font-ui text-sm hover:opacity-90"
          >
            {config.headerAction.label}
          </button>
        )}
      </div>

      <EntityListPage
        title=""
        showHeader={false}
        filters={config.filters}
        columns={columnsWithActions}
        items={items}
        loading={loading}
        totalCount={total}
        filterValues={filterValues}
        onFilterChange={handleFilterChange}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        getRowHref={config.getRowHref}
        emptyMessage={config.emptyMessage ?? 'No items found.'}
      />

      {formDialog && (
        <FormDialog
          open={formDialog.open}
          onClose={formDialog.onClose}
          title={formDialog.title}
          fields={formDialog.fields}
          initial={formDialog.initial}
          onSubmit={async (values) => { await formDialog.onSubmit(values); loadData(); }}
          validate={formDialog.validate}
        >
          {formDialog.children}
        </FormDialog>
      )}

      {confirmDialog && (
        <ConfirmDialog
          open={confirmDialog.open}
          onClose={confirmDialog.onClose}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={async () => { await confirmDialog.onConfirm(); loadData(); }}
          danger={confirmDialog.danger}
        />
      )}
    </div>
  );
}
