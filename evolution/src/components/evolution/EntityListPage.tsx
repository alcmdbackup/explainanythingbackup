// Full list page wrapper combining title, filter bar, EntityTable, and pagination.
// Wraps content in a card-style container with paper-texture for visual consistency.

'use client';

import type { ReactNode } from 'react';
import { EntityTable, type ColumnDef } from './EntityTable';

export interface FilterDef {
  key: string;
  label: string;
  type: 'select' | 'text' | 'checkbox';
  options?: { value: string; label: string }[];
  placeholder?: string;
  defaultChecked?: boolean;
}

export interface EntityListPageProps<T> {
  title: string;
  /** When false, skip rendering the header with title/count. Default true. */
  showHeader?: boolean;
  filters?: FilterDef[];
  columns?: ColumnDef<T>[];
  items: T[];
  loading: boolean;
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

export function EntityListPage<T>({
  title,
  showHeader = true,
  filters,
  columns,
  items,
  loading,
  totalCount,
  filterValues = {},
  onFilterChange,
  sortKey,
  sortDir,
  onSort,
  page = 1,
  pageSize = 20,
  onPageChange,
  getRowHref,
  actions,
  emptyMessage,
  emptySuggestion,
  renderTable,
}: EntityListPageProps<T>): JSX.Element {
  const clampedPageSize = Math.min(pageSize, MAX_PAGE_SIZE);
  const totalPages = totalCount != null ? Math.ceil(totalCount / clampedPageSize) : 1;

  if (!columns && !renderTable) {
    if (process.env.NODE_ENV === 'development') {
      throw new Error('EntityListPage requires either columns or renderTable prop');
    }
  }

  const handleTextFilter = (key: string, raw: string): void => {
    const trimmed = raw.trim().substring(0, 100);
    onFilterChange?.(key, trimmed);
  };

  return (
    <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] paper-texture card-enhanced" data-testid="entity-list-page">
      {showHeader && (
        <div className="flex flex-row items-center justify-between gap-4 p-6 border-b border-[var(--border-default)]">
          <div>
            <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">{title}</h1>
            {totalCount != null && (
              <p className="text-xs font-ui text-[var(--text-muted)] mt-0.5">
                {totalCount} {totalCount === 1 ? 'item' : 'items'}
              </p>
            )}
          </div>
          {actions && <div data-testid="list-actions">{actions}</div>}
        </div>
      )}

      <div className={`p-6 ${showHeader ? 'pt-4' : ''}`}>
        {filters && filters.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4" data-testid="filter-bar">
            {filters.map((filter) => {
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
        )}

        {renderTable ? (
          renderTable({ items, loading, emptyMessage, emptySuggestion })
        ) : columns ? (
          <EntityTable
            columns={columns}
            items={items}
            loading={loading}
            getRowHref={getRowHref}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            emptyMessage={emptyMessage}
            emptySuggestion={emptySuggestion}
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
              ◀ Prev
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
              Next ▶
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
