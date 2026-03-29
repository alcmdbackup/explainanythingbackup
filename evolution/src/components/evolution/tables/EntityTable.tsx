// Generic sortable table component for entity lists and detail page child sections.
// Renders clickable rows that link to detail pages via getRowHref.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { TableSkeleton } from './TableSkeleton';
import { EmptyState } from '../primitives/EmptyState';

export interface ColumnDef<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  /** When true, cell renders without the row's Link wrapper (e.g. for action buttons). */
  skipLink?: boolean;
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
  if (!active) return <span className="text-[var(--text-muted)] group-hover:text-[var(--accent-gold)] ml-0.5">▲</span>;
  return <span className="text-[var(--accent-gold)] ml-0.5">{dir === 'desc' ? '▼' : '▲'}</span>;
}

const ALIGN_CLASS = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

function alignClass(align: 'left' | 'right' | 'center' = 'left'): string {
  return ALIGN_CLASS[align];
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
    <div className="overflow-x-auto shadow-warm-sm rounded-page" data-testid={testId ?? 'entity-table'}>
      <table className="w-full text-xs font-ui">
        <thead>
          <tr className="text-[var(--text-muted)] border-b border-[var(--border-default)] bg-[var(--surface-elevated)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`py-1 pr-3 last:pr-0 group text-xs font-ui font-medium ${alignClass(col.align)} ${
                  col.sortable ? 'cursor-pointer select-none hover:text-[var(--text-secondary)]' : ''
                }`}
                onClick={col.sortable && onSort ? () => onSort(col.key) : undefined}
              >
                <span>{col.header}</span>
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
                className="border-b border-[var(--border-default)] last:border-0 hover:bg-[var(--surface-elevated)] transition-colors"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`py-2 pr-3 last:pr-0 ${alignClass(col.align)} font-mono text-[var(--text-secondary)]`}
                  >
                    {href && !col.skipLink ? (
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
