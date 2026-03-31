// Full list page wrapper combining title, filter bar, EntityTable, and pagination.
// Supports both controlled mode (items/loading passed in) and self-managed mode (loadData provided).

'use client';

import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { EntityTable, type ColumnDef } from './tables/EntityTable';
import { EvolutionBreadcrumb, type BreadcrumbItem } from './primitives/EvolutionBreadcrumb';
import { FormDialog, type FieldDef } from './dialogs/FormDialog';
import { ConfirmDialog } from './dialogs/ConfirmDialog';

export interface FilterDef {
  key: string;
  label: string;
  type: 'select' | 'text' | 'checkbox';
  options?: { value: string; label: string }[];
  placeholder?: string;
  defaultChecked?: boolean;
}

export interface RowAction<T> {
  label: string;
  onClick: (row: T) => void;
  visible?: (row: T) => boolean;
  danger?: boolean;
}

export interface EntityListPageProps<T> {
  title: string;
  /** When false, skip rendering the header with title/count. Default true. */
  showHeader?: boolean;
  filters?: FilterDef[];
  columns?: ColumnDef<T>[];
  /** Controlled mode: pass items directly. Ignored when loadData is provided. */
  items?: T[];
  /** Controlled mode: pass loading state. Ignored when loadData is provided. */
  loading?: boolean;
  totalCount?: number;
  filterValues?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  getRowHref?: (item: T) => string;
  actions?: ReactNode;
  emptyMessage?: string;
  emptySuggestion?: string;
  /** Custom table renderer. When provided, renders this instead of EntityTable. */
  renderTable?: (props: {
    items: T[];
    loading: boolean;
    emptyMessage?: string;
    emptySuggestion?: string;
  }) => ReactNode;

  // --- Self-managed mode (from RegistryPage) ---

  /** When provided, EntityListPage manages its own items/loading/page/filter state. */
  loadData?: (filters: Record<string, string>, page: number, pageSize: number) => Promise<{ items: T[]; total: number }>;
  /** Row action buttons. Appends an Actions column with skipLink=true. */
  rowActions?: RowAction<T>[];
  /** Create button rendered in the header. */
  headerAction?: { label: string; onClick: () => void };
  /** Breadcrumb trail rendered above the list. */
  breadcrumbs?: BreadcrumbItem[];
  /** Called after a successful form/confirm action to let parent react. */
  onActionComplete?: () => void;
  /** Form dialog props for create/edit flows. */
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
  /** Confirm dialog props for delete/dangerous actions. */
  confirmDialog?: {
    open: boolean;
    onClose: () => void;
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => Promise<void>;
    danger?: boolean;
  };
}

const MAX_PAGE_SIZE = 100;
const MAX_VISIBLE_PAGES = 7;

/** Compute the page number for a given button index in a sliding-window paginator. */
function pageNumberForIndex(index: number, currentPage: number, totalPages: number): number {
  if (totalPages <= MAX_VISIBLE_PAGES) return index + 1;
  if (currentPage <= 4) return index + 1;
  if (currentPage >= totalPages - 3) return totalPages - MAX_VISIBLE_PAGES + 1 + index;
  return currentPage - 3 + index;
}

export function EntityListPage<T>(props: EntityListPageProps<T>): JSX.Element {
  const isSelfManaged = !!props.loadData;

  // --- Self-managed state (only used when loadData is provided) ---
  const [managedItems, setManagedItems] = useState<T[]>([]);
  const [managedTotal, setManagedTotal] = useState(0);
  const [managedLoading, setManagedLoading] = useState(true);
  const [managedFilterValues, setManagedFilterValues] = useState<Record<string, string>>(() => {
    if (!isSelfManaged) return {};
    const defaults: Record<string, string> = {};
    for (const f of props.filters ?? []) {
      if (f.type === 'checkbox' && f.defaultChecked) {
        defaults[f.key] = 'true';
      }
    }
    return defaults;
  });
  const [managedPage, setManagedPage] = useState(1);

  // Resolve controlled vs self-managed values
  const items = isSelfManaged ? managedItems : (props.items ?? []);
  const loading = isSelfManaged ? managedLoading : (props.loading ?? false);
  const totalCount = isSelfManaged ? managedTotal : props.totalCount;
  const filterValues = isSelfManaged ? managedFilterValues : (props.filterValues ?? {});
  const page = isSelfManaged ? managedPage : (props.page ?? 1);
  const pageSize = props.pageSize ?? (isSelfManaged ? 50 : 20);

  const onFilterChange = isSelfManaged
    ? (key: string, value: string) => { setManagedFilterValues(prev => ({ ...prev, [key]: value })); setManagedPage(1); }
    : props.onFilterChange;
  const onPageChange = isSelfManaged ? setManagedPage : props.onPageChange;

  // Ref for loadData to avoid re-render loop
  const loadDataRef = useRef(props.loadData);
  loadDataRef.current = props.loadData;

  const doLoad = useCallback(async (): Promise<void> => {
    if (!loadDataRef.current) return;
    setManagedLoading(true);
    try {
      const result = await loadDataRef.current(managedFilterValues, managedPage, pageSize);
      setManagedItems(result.items);
      setManagedTotal(result.total);
    } catch {
      toast.error('Failed to load data');
    }
    setManagedLoading(false);
  }, [managedFilterValues, managedPage, pageSize]);

  useEffect(() => {
    if (isSelfManaged) doLoad();
  }, [isSelfManaged, doLoad]);

  // Build columns with actions column if rowActions defined
  const baseColumns = props.columns ?? [];
  const columnsWithActions: ColumnDef<T>[] = props.rowActions?.length
    ? [
        ...baseColumns,
        {
          key: '_actions',
          header: 'Actions',
          skipLink: true,
          render: (row: T) => (
            <div className="flex gap-2">
              {props.rowActions!
                .filter(a => !a.visible || a.visible(row))
                .map(action => (
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
    : baseColumns;

  const clampedPageSize = Math.min(pageSize, MAX_PAGE_SIZE);
  const totalPages = totalCount != null ? Math.ceil(totalCount / clampedPageSize) : 1;

  if (!columnsWithActions.length && !props.renderTable && process.env.NODE_ENV === 'development') {
    throw new Error('EntityListPage requires either columns or renderTable prop');
  }

  const handleTextFilter = (key: string, raw: string): void => {
    const trimmed = raw.trim().substring(0, 100);
    onFilterChange?.(key, trimmed);
  };

  const listContent = (
    <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] paper-texture card-enhanced" data-testid="entity-list-page">
      {props.showHeader !== false && (
        <div className="flex flex-row items-center justify-between gap-4 p-6 border-b border-[var(--border-default)]">
          <div>
            <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">{props.title}</h1>
            {loading ? (
              <div className="h-3 w-12 bg-[var(--surface-elevated)] rounded animate-pulse mt-1" />
            ) : totalCount != null ? (
              <p className="text-xs font-ui text-[var(--text-muted)] mt-0.5">
                {totalCount} {totalCount === 1 ? 'item' : 'items'}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            {props.headerAction && (
              <button
                onClick={props.headerAction.onClick}
                className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page font-ui text-sm hover:opacity-90"
                data-testid="header-action"
              >
                {props.headerAction.label}
              </button>
            )}
            {props.actions && <div data-testid="list-actions">{props.actions}</div>}
          </div>
        </div>
      )}

      <div className={`p-6 ${props.showHeader !== false ? 'pt-4' : ''}`}>
        {props.filters?.length ? (
          <div className="flex flex-wrap gap-2 mb-4" data-testid="filter-bar">
            {props.filters.map((filter) => {
              if (filter.type === 'checkbox') {
                return (
                  <label key={filter.key} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]" data-testid={`filter-${filter.key}`}>
                    <input
                      type="checkbox"
                      checked={filterValues[filter.key] === 'true'}
                      onChange={(e) => onFilterChange?.(filter.key, e.target.checked ? 'true' : 'false')}
                      className="rounded"
                    />
                    {filter.label}
                  </label>
                );
              }
              if (filter.type === 'select' && filter.options) {
                return (
                  <select
                    key={filter.key}
                    value={filterValues[filter.key] ?? ''}
                    onChange={(e) => onFilterChange?.(filter.key, e.target.value)}
                    className="px-2 py-1 text-xs font-ui bg-[var(--surface-input)] text-[var(--text-secondary)] border border-[var(--border-default)] rounded-page"
                    data-testid={`filter-${filter.key}`}
                    aria-label={filter.label}
                  >
                    {filter.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                );
              }
              return (
                <input
                  key={filter.key}
                  type="text"
                  value={filterValues[filter.key] ?? ''}
                  onChange={(e) => handleTextFilter(filter.key, e.target.value)}
                  placeholder={filter.placeholder ?? filter.label}
                  className="px-2 py-1 text-xs font-ui bg-[var(--surface-input)] text-[var(--text-secondary)] border border-[var(--border-default)] rounded-page w-40"
                  data-testid={`filter-${filter.key}`}
                  aria-label={filter.label}
                />
              );
            })}
          </div>
        ) : null}

        {props.renderTable ? (
          props.renderTable({ items, loading, emptyMessage: props.emptyMessage, emptySuggestion: props.emptySuggestion })
        ) : columnsWithActions.length ? (
          <EntityTable
            columns={columnsWithActions}
            items={items}
            loading={loading}
            getRowHref={props.getRowHref}
            sortKey={props.sortKey}
            sortDir={props.sortDir}
            onSort={props.onSort}
            emptyMessage={props.emptyMessage}
            emptySuggestion={props.emptySuggestion}
            testId="entity-list-table"
          />
        ) : null}

        {onPageChange && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4" data-testid="pagination">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 text-xs font-ui text-[var(--text-muted)] border border-[var(--border-default)] rounded-page hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-3 h-3 inline-block mr-1" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 2L4 6l4 4" /></svg>Prev
            </button>
            {Array.from({ length: Math.min(totalPages, MAX_VISIBLE_PAGES) }, (_, i) => {
              const pageNum = pageNumberForIndex(i, page, totalPages);
              return (
                <button
                  key={pageNum}
                  onClick={() => onPageChange(pageNum)}
                  className={`px-3 py-1.5 text-xs font-ui rounded-page transition-colors ${
                    page === pageNum
                      ? 'bg-[var(--accent-gold)] text-[var(--background)] font-medium'
                      : 'text-[var(--text-muted)] border border-[var(--border-default)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)]'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-xs font-ui text-[var(--text-muted)] border border-[var(--border-default)] rounded-page hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next<svg className="w-3 h-3 inline-block ml-1" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 2l4 4-4 4" /></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // When breadcrumbs/dialogs are provided, wrap with outer container
  if (props.breadcrumbs || props.formDialog || props.confirmDialog) {
    return (
      <div className="space-y-6">
        {props.breadcrumbs && <EvolutionBreadcrumb items={props.breadcrumbs} />}
        {listContent}

        {props.formDialog && (
          <FormDialog
            open={props.formDialog.open}
            onClose={props.formDialog.onClose}
            title={props.formDialog.title}
            fields={props.formDialog.fields}
            initial={props.formDialog.initial}
            onSubmit={async (values) => { await props.formDialog!.onSubmit(values); doLoad(); props.onActionComplete?.(); }}
            validate={props.formDialog.validate}
          >
            {props.formDialog.children}
          </FormDialog>
        )}

        {props.confirmDialog && (
          <ConfirmDialog
            open={props.confirmDialog.open}
            onClose={props.confirmDialog.onClose}
            title={props.confirmDialog.title}
            message={props.confirmDialog.message}
            confirmLabel={props.confirmDialog.confirmLabel}
            onConfirm={async () => { await props.confirmDialog!.onConfirm(); doLoad(); props.onActionComplete?.(); }}
            danger={props.confirmDialog.danger}
          />
        )}
      </div>
    );
  }

  return listContent;
}
