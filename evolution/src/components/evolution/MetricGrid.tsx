// Shared metrics display grid replacing StatCell, MetricCard, and inline metric divs.
// Supports default (simple label/value) and card (elevated background per cell) variants.

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
  variant?: 'default' | 'card';
  testId?: string;
}

const COLUMN_CLASSES: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-5',
};

export function MetricGrid({
  metrics,
  columns = 4,
  variant = 'default',
  testId,
}: MetricGridProps): JSX.Element {
  const gridCols = COLUMN_CLASSES[columns] ?? COLUMN_CLASSES[4];
  const isCard = variant === 'card';

  return (
    <div
      className={`grid ${gridCols} gap-3`}
      data-testid={testId ?? 'metric-grid'}
    >
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className={isCard ? 'p-3 bg-[var(--surface-elevated)] rounded-page' : undefined}
          data-testid={`metric-${metric.label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">
            {metric.label}
          </span>
          <p className="text-sm font-mono text-[var(--text-primary)]">
            {metric.prefix && typeof metric.value === 'number'
              ? `${metric.prefix}${metric.value}`
              : metric.value}
            {metric.ci && (
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
