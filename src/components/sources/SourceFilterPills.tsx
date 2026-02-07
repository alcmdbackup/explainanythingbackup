/**
 * SourceFilterPills — Sort and time period filters for the source leaderboard.
 * Parameterized version of FilterPills, navigates to /sources with query params.
 */
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { type TimePeriodFilter, type SourceSortMode } from '@/lib/services/sourceDiscovery';

interface SourceFilterPillsProps {
  sort: SourceSortMode;
  period: TimePeriodFilter;
}

const SORT_OPTIONS: { value: SourceSortMode; label: string }[] = [
  { value: 'citations', label: 'Most Cited' },
  { value: 'domain', label: 'By Domain' },
  { value: 'recent', label: 'Recent' },
];

const TIME_PERIODS: { value: TimePeriodFilter; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All Time' },
];

export default function SourceFilterPills({ sort, period }: SourceFilterPillsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateUrl = useCallback(
    (newSort: SourceSortMode, newPeriod: TimePeriodFilter) => {
      const params = new URLSearchParams(searchParams.toString());

      if (newSort === 'citations') {
        params.delete('sort');
      } else {
        params.set('sort', newSort);
      }

      if (newPeriod === 'all') {
        params.delete('t');
      } else {
        params.set('t', newPeriod);
      }

      const queryString = params.toString();
      router.push(queryString ? `/sources?${queryString}` : '/sources');
    },
    [router, searchParams]
  );

  return (
    <div data-testid="source-filter-pills" className="flex flex-wrap items-center gap-4 mb-8">
      {/* Sort mode pills */}
      <div className="flex items-center gap-1 bg-[var(--surface-elevated)] rounded-full p-1 border border-[var(--border-default)]">
        {SORT_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            data-testid={`source-sort-${value}`}
            onClick={() => updateUrl(value, period)}
            className={`
              px-5 py-2 text-sm font-ui font-medium rounded-full transition-all duration-200
              ${
                sort === value
                  ? 'bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] text-[var(--text-on-primary)] shadow-warm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]'
              }
            `}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Time period pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {TIME_PERIODS.map(({ value, label }) => (
          <button
            key={value}
            data-testid={`source-period-${value}`}
            onClick={() => updateUrl(sort, value)}
            className={`
              px-3 py-1.5 text-xs font-ui font-medium rounded-full transition-all duration-200
              ${
                period === value
                  ? 'bg-[var(--accent-gold)]/15 text-[var(--accent-gold)] border border-[var(--accent-gold)]'
                  : 'bg-transparent text-[var(--text-muted)] border border-[var(--border-default)] hover:border-[var(--accent-copper)] hover:text-[var(--text-secondary)]'
              }
            `}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
