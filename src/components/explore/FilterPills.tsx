'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { type SortMode, type TimePeriod } from '@/lib/schemas/schemas';

interface FilterPillsProps {
  sort: SortMode;
  period: TimePeriod;
}

const TIME_PERIODS: { value: TimePeriod; label: string }[] = [
  { value: 'hour', label: 'Hour' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All Time' },
];

/**
 * FilterPills - Animated filter tabs for New/Top with time period pills
 */
export default function FilterPills({ sort, period }: FilterPillsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateUrl = useCallback(
    (newSort: SortMode, newPeriod?: TimePeriod) => {
      const params = new URLSearchParams(searchParams.toString());

      if (newSort === 'new') {
        params.delete('sort');
        params.delete('t');
      } else {
        params.set('sort', newSort);
        if (newPeriod) {
          params.set('t', newPeriod);
        }
      }

      const queryString = params.toString();
      router.push(queryString ? `/explanations?${queryString}` : '/explanations');
    },
    [router, searchParams]
  );

  const handleTabClick = (newSort: SortMode) => {
    if (newSort === sort) return;
    updateUrl(newSort, newSort === 'top' ? 'week' : undefined);
  };

  const handlePeriodChange = (newPeriod: TimePeriod) => {
    updateUrl('top', newPeriod);
  };

  return (
    <div className="flex flex-wrap items-center gap-4 mb-8">
      {/* Sort Mode Pills */}
      <div className="flex items-center gap-1 bg-[var(--surface-elevated)] rounded-full p-1 border border-[var(--border-default)]">
        <button
          onClick={() => handleTabClick('new')}
          className={`
            px-5 py-2 text-sm font-ui font-medium rounded-full transition-all duration-200
            ${
              sort === 'new'
                ? 'bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] text-[var(--text-on-primary)] shadow-warm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]'
            }
          `}
        >
          New
        </button>
        <button
          onClick={() => handleTabClick('top')}
          className={`
            px-5 py-2 text-sm font-ui font-medium rounded-full transition-all duration-200
            ${
              sort === 'top'
                ? 'bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] text-[var(--text-on-primary)] shadow-warm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]'
            }
          `}
        >
          Top
        </button>
      </div>

      {/* Time Period Pills - Only show when Top is selected */}
      {sort === 'top' && (
        <div className="flex items-center gap-2 flex-wrap animate-[fadeIn_0.2s_ease-out]">
          {TIME_PERIODS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handlePeriodChange(value)}
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
      )}
    </div>
  );
}
