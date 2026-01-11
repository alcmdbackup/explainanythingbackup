'use client';

import Link from 'next/link';
import { type ExplanationWithViewCount, type SortMode, type TimePeriod } from '@/lib/schemas/schemas';
import Navigation from '@/components/Navigation';
import MasonryGrid from './MasonryGrid';
import ExplanationCard from './ExplanationCard';
import FilterPills from './FilterPills';

/**
 * Formats a timestamp string for display
 */
function formatTimestamp(timestamp: string | undefined | null): string {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

interface ExploreGalleryPageProps {
  explanations: ExplanationWithViewCount[];
  error: string | null;
  sort: SortMode;
  period: TimePeriod;
}

/**
 * ExploreGalleryPage - Immersive card gallery for browsing explanations
 * Replaces table-based ExplanationsTablePage with masonry layout
 */
export default function ExploreGalleryPage({
  explanations,
  error,
  sort,
  period,
}: ExploreGalleryPageProps) {
  const showViews = sort === 'top';

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

      <main className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-display font-bold text-[var(--text-primary)]">
            Explore
          </h1>
          <div className="title-flourish mt-4"></div>
        </div>

        {/* Filter Pills */}
        <FilterPills sort={sort} period={period} />

        {/* Error State */}
        {error && (
          <div className="mb-6 p-4 bg-[var(--surface-elevated)] border-l-4 border-l-[var(--destructive)] border border-[var(--border-default)] rounded-r-lg text-[var(--destructive)]">
            <span className="font-serif">{error}</span>
          </div>
        )}

        {/* Empty State */}
        {explanations.length === 0 ? (
          <div className="text-center py-16 gallery-card max-w-md mx-auto">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-[var(--accent-gold)]/50"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            >
              <path
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="font-serif text-[var(--text-muted)] text-lg">
              Nothing to explore yet
            </p>
            <p className="font-sans text-sm text-[var(--text-muted)] mt-2">
              Be the first to create an explanation.
            </p>
            <Link
              href="/"
              className="inline-flex items-center mt-6 px-4 py-2 text-sm font-sans font-medium text-[var(--text-on-primary)] bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] rounded-lg shadow-warm hover:shadow-warm-lg transition-all duration-200"
            >
              Start exploring
            </Link>
          </div>
        ) : (
          /* Masonry Grid */
          <MasonryGrid>
            {explanations.map((explanation, index) => (
              <ExplanationCard
                key={explanation.id}
                explanation={explanation}
                href={`/results?${new URLSearchParams({ explanation_id: explanation.id.toString() })}`}
                index={index}
                footer={
                  <>
                    <time className="text-[var(--text-muted)]">
                      {formatTimestamp(explanation.timestamp)}
                    </time>
                    {showViews && explanation.viewCount !== undefined && (
                      <span className="text-[var(--text-muted)]">
                        {explanation.viewCount.toLocaleString()} view{explanation.viewCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </>
                }
              />
            ))}
          </MasonryGrid>
        )}
      </main>
    </div>
  );
}
