/**
 * SourceLeaderboardPage — Client component that renders the source leaderboard with filters.
 * Receives server-fetched data and renders SourceCard list with SourceFilterPills.
 */
'use client';

import Navigation from '@/components/Navigation';
import SourceCard from './SourceCard';
import SourceFilterPills from './SourceFilterPills';
import { type SourceCitationCountType } from '@/lib/schemas/schemas';
import { type TimePeriodFilter, type SourceSortMode } from '@/lib/services/sourceDiscovery';

interface SourceLeaderboardPageProps {
  sources: SourceCitationCountType[];
  error: string | null;
  sort: SourceSortMode;
  period: TimePeriodFilter;
}

export default function SourceLeaderboardPage({
  sources,
  error,
  sort,
  period,
}: SourceLeaderboardPageProps) {
  return (
    <div className="min-h-screen bg-[var(--surface-primary)]">
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

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Page Header */}
        <div className="mb-8 text-center">
          <h1 className="atlas-display-section atlas-animate-fade-up stagger-1">
            Sources
          </h1>
          <p className="mt-2 text-sm font-body text-[var(--text-muted)]">
            Most-cited sources across all explanations
          </p>
          <div className="title-flourish mt-4"></div>
        </div>

        {/* Filter Pills */}
        <SourceFilterPills sort={sort} period={period} />

        {/* Error State */}
        {error && (
          <div className="mb-6 p-4 bg-[var(--surface-elevated)] border-l-4 border-l-[var(--destructive)] border border-[var(--border-default)] rounded-r-lg text-[var(--destructive)]">
            <span className="font-body">{error}</span>
          </div>
        )}

        {/* Empty State */}
        {!error && sources.length === 0 && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[var(--surface-elevated)] mb-4">
              <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h2 className="text-lg font-display font-semibold text-[var(--text-secondary)]">
              No sources found
            </h2>
            <p className="mt-1 text-sm font-body text-[var(--text-muted)]">
              Sources will appear here once explanations start citing them.
            </p>
          </div>
        )}

        {/* Source List */}
        {sources.length > 0 && (
          <div data-testid="sources-list" className="space-y-3">
            {sources.map((source, idx) => (
              <SourceCard
                key={source.source_cache_id}
                sourceCacheId={source.source_cache_id}
                domain={source.domain}
                title={source.title}
                faviconUrl={source.favicon_url}
                totalCitations={source.total_citations}
                uniqueExplanations={source.unique_explanations}
                index={idx}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
