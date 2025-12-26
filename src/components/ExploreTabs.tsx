'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { type SortMode, type TimePeriod } from '@/lib/schemas/schemas';

interface ExploreTabsProps {
    sort: SortMode;
    period: TimePeriod;
}

const TIME_PERIOD_LABELS: Record<TimePeriod, string> = {
    hour: 'Past Hour',
    today: 'Today',
    week: 'This Week',
    month: 'This Month',
    all: 'All Time',
};

/**
 * ExploreTabs component - Reddit-style discovery mode tabs
 * Provides New/Top tabs with time period filtering for Top mode
 */
export default function ExploreTabs({ sort, period }: ExploreTabsProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const updateUrl = useCallback((newSort: SortMode, newPeriod?: TimePeriod) => {
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
    }, [router, searchParams]);

    const handleTabClick = (newSort: SortMode) => {
        if (newSort === sort) return;
        updateUrl(newSort, newSort === 'top' ? 'week' : undefined);
    };

    const handlePeriodChange = (newPeriod: TimePeriod) => {
        updateUrl('top', newPeriod);
    };

    return (
        <div className="flex items-center gap-4 mb-6">
            {/* Tab buttons */}
            <div className="flex items-center gap-1 bg-[var(--surface-elevated)] rounded-lg p-1 border border-[var(--border-default)]">
                <button
                    onClick={() => handleTabClick('new')}
                    className={`
                        px-4 py-2 text-sm font-sans font-medium rounded-md transition-all duration-200
                        ${sort === 'new'
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
                        px-4 py-2 text-sm font-sans font-medium rounded-md transition-all duration-200
                        ${sort === 'top'
                            ? 'bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] text-[var(--text-on-primary)] shadow-warm'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]'
                        }
                    `}
                >
                    Top
                </button>
            </div>

            {/* Time period dropdown - only show when Top is selected */}
            {sort === 'top' && (
                <Select value={period} onValueChange={(value) => handlePeriodChange(value as TimePeriod)}>
                    <SelectTrigger className="w-[140px] bg-[var(--surface-elevated)] border-[var(--border-default)] text-[var(--text-primary)]">
                        <SelectValue placeholder="Select period" />
                    </SelectTrigger>
                    <SelectContent className="bg-[var(--surface-elevated)] border-[var(--border-default)]">
                        <SelectItem value="hour" className="text-[var(--text-primary)] focus:bg-[var(--accent-gold)]/10">
                            {TIME_PERIOD_LABELS.hour}
                        </SelectItem>
                        <SelectItem value="today" className="text-[var(--text-primary)] focus:bg-[var(--accent-gold)]/10">
                            {TIME_PERIOD_LABELS.today}
                        </SelectItem>
                        <SelectItem value="week" className="text-[var(--text-primary)] focus:bg-[var(--accent-gold)]/10">
                            {TIME_PERIOD_LABELS.week}
                        </SelectItem>
                        <SelectItem value="month" className="text-[var(--text-primary)] focus:bg-[var(--accent-gold)]/10">
                            {TIME_PERIOD_LABELS.month}
                        </SelectItem>
                        <SelectItem value="all" className="text-[var(--text-primary)] focus:bg-[var(--accent-gold)]/10">
                            {TIME_PERIOD_LABELS.all}
                        </SelectItem>
                    </SelectContent>
                </Select>
            )}
        </div>
    );
}
