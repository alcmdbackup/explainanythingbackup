// Shared metrics display grid replacing StatCell, MetricCard, and inline metric divs.
// Supports default, card, and bordered variants with configurable value text size.

import type { ReactNode } from 'react';

export interface MetricItem {
  label: string;
  value: ReactNode;
  ci?: [number, number];
  n?: number;
  prefix?: string;
}

export interface MetricGridProps {
  metrics: MetricItem[];
  columns?: 2 | 3 | 4 | 5;
  /** 'default' = bare, 'card' = elevated bg, 'bordered' = border + elevated bg. */
  variant?: 'default' | 'card' | 'bordered';
  /** Value text size: 'sm' (default), 'md', or 'lg'. */
  size?: 'sm' | 'md' | 'lg';
  testId?: string;
}

const COLUMN_CLASSES: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-5',
};

const CELL_CLASSES: Record<string, string> = {
  default: '',
  card: 'p-3 bg-[var(--surface-elevated)] rounded-page',
  bordered: 'p-4 border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)]',
};

const VALUE_CLASSES: Record<string, string> = {
  sm: 'text-sm font-mono text-[var(--text-primary)]',
  md: 'text-sm font-body font-bold text-[var(--text-primary)]',
  lg: 'text-lg font-body font-bold text-[var(--text-primary)]',
};

export function MetricGrid({
  metrics,
  columns = 4,
  variant = 'default',
  size = 'sm',
  testId,
}: MetricGridProps): JSX.Element {
  const gridCols = COLUMN_CLASSES[columns] ?? COLUMN_CLASSES[4];
  const cellClass = CELL_CLASSES[variant] ?? '';
  const valueClass = VALUE_CLASSES[size] ?? VALUE_CLASSES.sm;
  const labelMargin = variant === 'bordered' ? 'mb-1' : '';

  return (
    <div
      className={`grid ${gridCols} gap-3`}
      data-testid={testId ?? 'metric-grid'}
    >
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className={cellClass || undefined}
          data-testid={`metric-${metric.label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <span className={`text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide ${labelMargin}`}>
            {metric.label}
          </span>
          <p className={valueClass}>
            {metric.prefix && typeof metric.value === 'number'
              ? `${metric.prefix}${metric.value}`
              : metric.value}
            {metric.ci && metric.ci[0] != null && metric.ci[1] != null && (
              <span className="text-xs text-[var(--text-muted)] ml-1">
                [{metric.ci[0].toFixed(2)}, {metric.ci[1].toFixed(2)}]
                {metric.n === 2 && (
                  <span className="text-[var(--status-warning)] ml-0.5" title="Low sample size (n=2)">*</span>
                )}
              </span>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}
