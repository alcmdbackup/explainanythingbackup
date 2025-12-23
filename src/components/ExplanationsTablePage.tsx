'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/solid';
import { formatUserFriendlyDate } from '@/lib/utils/formatDate';
import { type ExplanationWithViewCount, type SortMode, type TimePeriod } from '@/lib/schemas/schemas';
import Navigation from '@/components/Navigation';
import ExploreTabs from '@/components/ExploreTabs';

/**
 * ExplanationsTablePage component
 * Table display for browsing explanations
 */
export default function ExplanationsTablePage({
    explanations,
    error,
    showNavigation = true,
    pageTitle = 'Explore',
    sort,
    period,
}: {
    explanations: (ExplanationWithViewCount & { dateSaved?: string })[];
    error: string | null;
    showNavigation?: boolean;
    pageTitle?: string;
    sort?: SortMode;
    period?: TimePeriod;
}) {
    // Only show ExploreTabs when sort/period are explicitly provided (i.e., on /explanations page)
    const showExploreTabs = sort !== undefined && period !== undefined;
    const [sortBy, setSortBy] = useState<'title' | 'date'>('date');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    function stripTitleFromContent(content: string): string {
        return content.replace(/^#+\s.*(?:\r?\n|$)/, '').trim();
    }

    function getSortedExplanations() {
        // When sort='top', preserve server's view-based ordering
        if (sort === 'top') {
            return explanations;
        }
        const sorted = [...explanations];
        if (sortBy === 'title') {
            sorted.sort((a, b) => {
                const tA = a.explanation_title.toLowerCase();
                const tB = b.explanation_title.toLowerCase();
                if (tA < tB) return sortOrder === 'asc' ? -1 : 1;
                if (tA > tB) return sortOrder === 'asc' ? 1 : -1;
                return 0;
            });
        } else if (sortBy === 'date') {
            sorted.sort((a, b) => {
                const dA = new Date(a.timestamp).getTime();
                const dB = new Date(b.timestamp).getTime();
                return sortOrder === 'asc' ? dA - dB : dB - dA;
            });
        }
        return sorted;
    }

    const handleSort = (column: 'title' | 'date') => {
        if (sortBy === column) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(column);
            setSortOrder('asc');
        }
    };

    const hasDateSaved = explanations.some(e => e.dateSaved);

    return (
        <div className="min-h-screen bg-[var(--surface-primary)]">
            {showNavigation && (
                <Navigation
                    showSearchBar={true}
                    searchBarProps={{
                        placeholder: 'Search...',
                        maxLength: 100,
                        onSearch: (query: string) => {
                            if (!query.trim()) return;
                            window.location.href = `/results?q=${encodeURIComponent(query)}`;
                        },
                    }}
                />
            )}
            <main className="container mx-auto px-4 py-8 max-w-6xl">
                {/* Page Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-display font-bold text-[var(--text-primary)]">
                        {pageTitle}
                    </h1>
                    <div className="title-flourish mt-4"></div>
                </div>

                {/* Discovery Mode Tabs - only shown on /explanations page */}
                {showExploreTabs && <ExploreTabs sort={sort!} period={period!} />}

                {error && (
                    <div className="mb-6 p-4 bg-[var(--surface-elevated)] border-l-4 border-l-[var(--destructive)] border border-[var(--border-default)] rounded-r-page text-[var(--destructive)]">
                        <span className="font-serif">{error}</span>
                    </div>
                )}

                {explanations.length === 0 ? (
                    <div className="text-center py-16 scholar-card">
                        <svg
                            className="w-16 h-16 mx-auto mb-4 text-[var(--accent-gold)]/50"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1"
                        >
                            <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <p className="font-serif text-[var(--text-muted)] text-lg">Nothing saved yet</p>
                        <p className="font-sans text-sm text-[var(--text-muted)] mt-2">Save explanations you want to revisit.</p>
                        <Link
                            href="/"
                            className="inline-flex items-center mt-6 px-4 py-2 text-sm font-sans font-medium text-[var(--text-on-primary)] bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] rounded-page shadow-warm hover:shadow-warm-md transition-all duration-200"
                        >
                            Start exploring
                        </Link>
                    </div>
                ) : (
                    <div className="scholar-card overflow-hidden">
                        <div className="overflow-x-auto max-h-[70vh]">
                            <table className="min-w-full">
                                <thead className="bg-[var(--surface-elevated)] border-b-2 border-[var(--accent-gold)]/30 sticky top-0 z-10">
                                    <tr>
                                        <th
                                            className="px-6 py-4 text-left text-xs font-sans font-medium text-[var(--accent-gold)] uppercase tracking-wider cursor-pointer select-none hover:text-[var(--accent-copper)] transition-colors"
                                            onClick={() => handleSort('title')}
                                        >
                                            <span className="flex items-center gap-1">
                                                Title
                                                {sortBy === 'title' && (
                                                    sortOrder === 'asc' ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDownIcon className="w-3 h-3" />
                                                )}
                                            </span>
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-sans font-medium text-[var(--text-muted)] uppercase tracking-wider">
                                            Preview
                                        </th>
                                        <th
                                            className="px-6 py-4 text-left text-xs font-sans font-medium text-[var(--accent-gold)] uppercase tracking-wider cursor-pointer select-none hover:text-[var(--accent-copper)] transition-colors"
                                            onClick={() => handleSort('date')}
                                        >
                                            <span className="flex items-center gap-1">
                                                Created
                                                {sortBy === 'date' && (
                                                    sortOrder === 'asc' ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDownIcon className="w-3 h-3" />
                                                )}
                                            </span>
                                        </th>
                                        {sort === 'top' && (
                                            <th className="px-6 py-4 text-left text-xs font-sans font-medium text-[var(--accent-gold)] uppercase tracking-wider">
                                                Views
                                            </th>
                                        )}
                                        {hasDateSaved && (
                                            <th className="px-6 py-4 text-left text-xs font-sans font-medium text-[var(--text-muted)] uppercase tracking-wider">
                                                Saved
                                            </th>
                                        )}
                                        <th className="px-6 py-4"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--border-default)]">
                                    {getSortedExplanations().map((explanation, index) => (
                                        <tr
                                            key={explanation.id}
                                            data-testid="explanation-row"
                                            className={`
                                                ${index % 2 === 0 ? 'bg-[var(--surface-secondary)]' : 'bg-[var(--surface-elevated)]/50'}
                                                scholar-table-row cursor-pointer
                                            `}
                                            onClick={() => window.location.href = `/results?explanation_id=${explanation.id}`}
                                        >
                                            <td data-testid="explanation-title" className="px-6 py-4 whitespace-nowrap">
                                                <span className="font-display font-medium text-[var(--text-primary)]">
                                                    {explanation.explanation_title}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap max-w-xs">
                                                <span className="font-serif text-sm text-[var(--text-secondary)] truncate block">
                                                    {stripTitleFromContent(explanation.content)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-sm font-sans text-[var(--text-muted)]">
                                                    {formatUserFriendlyDate(explanation.timestamp)}
                                                </span>
                                            </td>
                                            {sort === 'top' && (
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className="text-sm font-sans text-[var(--accent-gold)]">
                                                        {explanation.viewCount ?? 0}
                                                    </span>
                                                </td>
                                            )}
                                            {hasDateSaved && (
                                                <td data-testid="save-date" className="px-6 py-4 whitespace-nowrap">
                                                    <span className="text-sm font-sans text-[var(--text-muted)]">
                                                        {explanation.dateSaved
                                                            ? formatUserFriendlyDate(explanation.dateSaved)
                                                            : '—'}
                                                    </span>
                                                </td>
                                            )}
                                            <td className="px-6 py-4 whitespace-nowrap text-right">
                                                <Link
                                                    href={`/results?explanation_id=${explanation.id}`}
                                                    className="text-sm font-sans text-[var(--accent-gold)] hover:text-[var(--accent-copper)] transition-colors gold-underline"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    View →
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
