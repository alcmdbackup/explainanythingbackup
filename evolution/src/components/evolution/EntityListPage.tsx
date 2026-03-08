// Full list page wrapper combining title, filter bar, EntityTable, and pagination.
// Used by top-level entity list pages (runs, variants, strategies, etc.).

'use client';

import type { ReactNode } from 'react';
import { EntityTable, type ColumnDef } from './EntityTable';

export interface FilterDef {
  key: string;
  label: string;
  type: 'select' | 'text';
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface EntityListPageProps<T> {
  title: string;
  filters?: FilterDef[];
  columns: ColumnDef<T>[];
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
}: EntityListPageProps<T>): JSX.Element {
  const clampedPageSize = Math.min(pageSize, MAX_PAGE_SIZE);
  const totalPages = totalCount != null ? Math.ceil(totalCount / clampedPageSize) : 1;

  const handleTextFilter = (key: string, raw: string): void => {
    const trimmed = raw.trim().substring(0, 100);
    onFilterChange?.(key, trimmed);
  };

  return (
    <div className="space-y-4" data-testid="entity-list-page">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-[var(--text-primary)]">{title}</h1>
          {totalCount != null && (
            <p className="text-xs font-ui text-[var(--text-muted)] mt-0.5">
              {totalCount} {totalCount === 1 ? 'item' : 'items'}
            </p>
          )}
        </div>
        {actions && <div data-testid="list-actions">{actions}</div>}
      </div>

      {filters && filters.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="filter-bar">
          {filters.map((filter) => {
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

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book shadow-warm-lg p-4">
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
      </div>

      {onPageChange && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2" data-testid="pagination">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="px-2 py-1 text-xs font-ui text-[var(--text-muted)] hover:text-[var(--accent-gold)] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ◀ Prev
          </button>
          {Array.from({ length: Math.min(totalPages, MAX_VISIBLE_PAGES) }, (_, i) => {
            const pageNum = pageNumberForIndex(i, page, totalPages);
            return (
              <button
                key={pageNum}
                onClick={() => onPageChange(pageNum)}
                className={`px-2 py-1 text-xs font-ui rounded-page ${
                  page === pageNum
                    ? 'bg-[var(--accent-gold)] text-[var(--background)] font-medium'
                    : 'text-[var(--text-muted)] hover:text-[var(--accent-gold)]'
                }`}
              >
                {pageNum}
              </button>
            );
          })}
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-2 py-1 text-xs font-ui text-[var(--text-muted)] hover:text-[var(--accent-gold)] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next ▶
          </button>
        </div>
      )}
    </div>
  );
}
