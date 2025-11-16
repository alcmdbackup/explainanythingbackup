'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/solid';
import { formatUserFriendlyDate } from '@/lib/utils/formatDate';
import { type ExplanationFullDbType } from '@/lib/schemas/schemas';
import Navigation from '@/components/Navigation';

/**
 * ExplanationsTablePage component
 * - Renders the navigation bar and search bar (optional, default true)
 * - Renders a sortable table of explanations with title, content preview, and date
 * - Handles sorting by title or date, ascending/descending
 * - Navigates to explanation details on View link click
 * - Receives explanations and error as props from parent
 * - Uses stripTitleFromContent to show content preview without title
 *
 * Used by: ExplanationsPage, other pages that need a full explanations table with navigation
 * Calls: Navigation, SearchBar, formatUserFriendlyDate
 */
export default function ExplanationsTablePage({
    explanations,
    error,
    showNavigation = true,
    pageTitle = 'All Explanations',
}: {
    explanations: (ExplanationFullDbType & { dateSaved?: string })[];
    error: string | null;
    showNavigation?: boolean;
    pageTitle?: string;
}) {
    const [sortBy, setSortBy] = useState<'title' | 'date'>('date');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    function stripTitleFromContent(content: string): string {
        return content.replace(/^#+\s.*(?:\r?\n|$)/, '').trim();
    }

    function getSortedExplanations() {
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

    // Determine if any explanation has dateSaved
    const hasDateSaved = explanations.some(e => e.dateSaved);

    return (
        <div className="min-h-screen bg-white dark:bg-gray-900">
            {showNavigation && (
                <Navigation
                    showSearchBar={true}
                    searchBarProps={{
                        placeholder: 'Search any topic...',
                        maxLength: 100,
                        onSearch: (query: string) => {
                            if (!query.trim()) return;
                            window.location.href = `/results?q=${encodeURIComponent(query)}`;
                        },
                    }}
                />
            )}
            <main className="container mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
                    {pageTitle}
                </h1>
                {error && (
                    <div className="mb-6 p-4 bg-red-100 text-red-700 rounded-md">
                        {error}
                    </div>
                )}
                {/* Subtle divider for aesthetics */}
                <div className="h-px bg-gradient-to-r from-transparent via-gray-300/50 to-transparent dark:via-gray-600/50 my-6"></div>
                {/* Table layout for explanations */}
                <div className="overflow-x-auto rounded-lg shadow border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 max-h-[70vh]">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gradient-to-r from-blue-600 to-blue-400 dark:from-blue-800 dark:to-blue-700 text-white border-b-2 border-blue-400 shadow-md sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none" onClick={() => handleSort('title')}>
                                    Title
                                    {sortBy === 'title' && (
                                        sortOrder === 'asc' ? <ArrowUpIcon className="inline w-4 h-4 ml-1" /> : <ArrowDownIcon className="inline w-4 h-4 ml-1" />
                                    )}
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider">Content</th>
                                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none" onClick={() => handleSort('date')}>
                                    Date Created
                                    {sortBy === 'date' && (
                                        sortOrder === 'asc' ? <ArrowUpIcon className="inline w-4 h-4 ml-1" /> : <ArrowDownIcon className="inline w-4 h-4 ml-1" />
                                    )}
                                </th>
                                {hasDateSaved && (
                                    <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider">
                                        Date Saved
                                    </th>
                                )}
                                <th className="px-6 py-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {getSortedExplanations().map((explanation) => (
                                <tr
                                    key={explanation.id}
                                    data-testid="explanation-row"
                                    className="odd:bg-gray-50 even:bg-white dark:odd:bg-gray-800 dark:even:bg-gray-900 hover:bg-blue-100 dark:hover:bg-blue-800 transition-colors"
                                >
                                    <td data-testid="explanation-title" className="px-6 py-4 whitespace-nowrap font-medium text-gray-900 dark:text-white">
                                        {explanation.explanation_title}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-gray-400 max-w-xs truncate">
                                        {stripTitleFromContent(explanation.content)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {formatUserFriendlyDate(explanation.timestamp)}
                                    </td>
                                    {hasDateSaved && (
                                        <td data-testid="save-date" className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {explanation.dateSaved
                                                ? formatUserFriendlyDate(explanation.dateSaved)
                                                : '-'}
                                        </td>
                                    )}
                                    <td className="px-6 py-4 whitespace-nowrap text-right">
                                        <Link
                                            href={`/results?explanation_id=${explanation.id}`}
                                            className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                        >
                                            View
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </main>
        </div>
    );
} 