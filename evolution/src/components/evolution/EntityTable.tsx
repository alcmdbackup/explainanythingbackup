// Generic sortable table component for entity lists and detail page child sections.
// Renders clickable rows that link to detail pages via getRowHref.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { TableSkeleton } from './TableSkeleton';
import { EmptyState } from './EmptyState';

export interface ColumnDef<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  render: (item: T) => ReactNode;
}

export interface EntityTableProps<T> {
  columns: ColumnDef<T>[];
  items: T[];
  loading?: boolean;
  getRowHref?: (item: T) => string;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  emptyMessage?: string;
  emptySuggestion?: string;
  testId?: string;
}

function SortIndicator({ active, dir }: { active: boolean; dir?: 'asc' | 'desc' }): JSX.Element {
  if (!active) return <span className="text-[var(--text-muted)] opacity-0 group-hover:opacity-50 ml-0.5">▲</span>;
  return <span className="ml-0.5">{dir === 'desc' ? '▼' : '▲'}</span>;
}

function alignClass(align?: 'left' | 'right' | 'center'): string {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

export function EntityTable<T>({
  columns,
  items,
  loading,
  getRowHref,
  sortKey,
  sortDir,
  onSort,
  emptyMessage = 'No items found.',
  emptySuggestion,
  testId,
}: EntityTableProps<T>): JSX.Element {
  if (loading) {
    return <TableSkeleton columns={columns.length} testId={testId ? `${testId}-skeleton` : undefined} />;
  }

  if (items.length === 0) {
    return <EmptyState message={emptyMessage} suggestion={emptySuggestion} testId={testId ? `${testId}-empty` : undefined} />;
  }

  return (
    <div className="overflow-x-auto" data-testid={testId ?? 'entity-table'}>
      <table className="w-full text-xs font-ui">
        <thead>
          <tr className="text-[var(--text-muted)] border-b border-[var(--border-default)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`py-1 pr-3 last:pr-0 group ${alignClass(col.align)} ${
                  col.sortable ? 'cursor-pointer select-none hover:text-[var(--text-secondary)]' : ''
                }`}
                onClick={col.sortable && onSort ? () => onSort(col.key) : undefined}
              >
                {col.header}
                {col.sortable && <SortIndicator active={sortKey === col.key} dir={sortDir} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const href = getRowHref?.(item);
            return (
              <tr
                key={i}
                className="border-b border-[var(--border-default)] last:border-0 hover:bg-[var(--surface-secondary)] transition-colors"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`py-1.5 pr-3 last:pr-0 ${alignClass(col.align)} font-mono text-[var(--text-secondary)]`}
                  >
                    {href ? (
                      <Link href={href} className="block hover:text-[var(--accent-gold)]">
                        {col.render(item)}
                      </Link>
                    ) : (
                      col.render(item)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
