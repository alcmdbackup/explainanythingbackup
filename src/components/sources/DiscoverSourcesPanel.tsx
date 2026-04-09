/**
 * @deprecated Replaced by SourceCombobox which integrates discovery into the unified input.
 * Kept temporarily for reference — remove in follow-up cleanup.
 *
 * DiscoverSourcesPanel — Collapsible panel showing suggested sources.
 * Two sections: "Popular in [topic]" and "Used in similar articles".
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';
import {
  getPopularSourcesByTopicAction,
  getSimilarArticleSourcesAction,
} from '@/actions/actions';
import { type DiscoveredSource } from '@/lib/services/sourceDiscovery';

interface DiscoverSourcesPanelProps {
  explanationId: number;
  topicId: number | null;
  topicTitle?: string;
  onAddSource: (url: string) => void;
  /** URLs already present in the explanation (to disable the "Add" button) */
  existingUrls: string[];
  className?: string;
}

export default function DiscoverSourcesPanel({
  explanationId,
  topicId,
  topicTitle,
  onAddSource,
  existingUrls,
  className = '',
}: DiscoverSourcesPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [popularSources, setPopularSources] = useState<DiscoveredSource[]>([]);
  const [similarSources, setSimilarSources] = useState<DiscoveredSource[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const loadSources = useCallback(async () => {
    if (hasLoaded) return;
    setIsLoading(true);

    try {
      // Fetch both in parallel
      const [popularResult, similarResult] = await Promise.all([
        topicId
          ? getPopularSourcesByTopicAction({ topicId, limit: 5 })
          : Promise.resolve({ data: [] as DiscoveredSource[], error: null }),
        getSimilarArticleSourcesAction({ explanationId, limit: 5 }),
      ]);

      setPopularSources(popularResult.data);
      setSimilarSources(similarResult.data);
    } catch {
      // Graceful degradation — panel shows empty sections
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
    }
  }, [explanationId, topicId, hasLoaded]);

  // Fetch when panel opens for the first time
  useEffect(() => {
    if (isOpen && !hasLoaded) {
      loadSources();
    }
  }, [isOpen, hasLoaded, loadSources]);

  const existingUrlSet = new Set(existingUrls);

  return (
    <div
      data-testid="discover-sources-panel"
      className={cn('mt-4 border border-[var(--border-default)] rounded-book', className)}
    >
      {/* Toggle header */}
      <button
        data-testid="discover-sources-toggle"
        onClick={() => setIsOpen(prev => !prev)}
        className={cn(
          'w-full flex items-center justify-between px-4 py-3 text-left',
          'text-sm font-ui font-medium text-[var(--text-secondary)]',
          'hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors',
          'rounded-book focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30'
        )}
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--accent-copper)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Discover Sources
        </span>
        {isOpen ? (
          <ChevronUpIcon className="w-4 h-4" />
        ) : (
          <ChevronDownIcon className="w-4 h-4" />
        )}
      </button>

      {/* Expandable content */}
      {isOpen && (
        <div className="px-4 pb-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <span className="w-5 h-5 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
              <span className="ml-2 text-sm font-body text-[var(--text-muted)]">Finding sources...</span>
            </div>
          ) : (
            <>
              {/* Popular in [topic] section */}
              {topicId && (
                <SourceSection
                  testId="popular-sources-section"
                  title={`Popular in ${topicTitle || 'this topic'}`}
                  sources={popularSources}
                  existingUrls={existingUrlSet}
                  onAddSource={onAddSource}
                  emptyMessage="No popular sources found for this topic."
                />
              )}

              {/* Similar article sources section */}
              <SourceSection
                testId="similar-sources-section"
                title="Used in similar articles"
                sources={similarSources}
                existingUrls={existingUrlSet}
                onAddSource={onAddSource}
                emptyMessage="No sources found from similar articles."
              />

              {popularSources.length === 0 && similarSources.length === 0 && (
                <p className="text-center text-sm font-body text-[var(--text-muted)] py-4">
                  No source suggestions available yet.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Internal helper component for a section of discovered sources
// --------------------------------------------------------------------------

function SourceSection({
  testId,
  title,
  sources,
  existingUrls,
  onAddSource,
  emptyMessage,
}: {
  testId: string;
  title: string;
  sources: DiscoveredSource[];
  existingUrls: Set<string>;
  onAddSource: (url: string) => void;
  emptyMessage: string;
}) {
  if (sources.length === 0) {
    return (
      <div data-testid={testId}>
        <h3 className="text-xs font-ui font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
          {title}
        </h3>
        <p className="text-xs font-body text-[var(--text-muted)]">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div data-testid={testId}>
      <h3 className="text-xs font-ui font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
        {title}
      </h3>
      <ul className="space-y-1.5">
        {sources.map(source => {
          const alreadyAdded = existingUrls.has(source.url);
          return (
            <li
              key={source.source_cache_id}
              className="flex items-center gap-2 p-2 rounded-book hover:bg-[var(--surface-secondary)] transition-colors"
            >
              {/* Favicon */}
              <div className="flex-shrink-0 w-5 h-5 rounded overflow-hidden bg-[var(--surface-page)] flex items-center justify-center">
                {source.favicon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external source favicon from arbitrary domain
                  <img src={source.favicon_url} alt="" className="w-4 h-4" loading="lazy" />
                ) : (
                  <span className="text-xs font-ui text-[var(--text-muted)] uppercase">
                    {source.domain.charAt(0)}
                  </span>
                )}
              </div>

              {/* Title + domain */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-body text-[var(--text-primary)] truncate">
                  {source.title || source.domain}
                </p>
                <p className="text-xs font-ui text-[var(--text-muted)]">
                  {source.domain} &middot; {source.frequency} {source.frequency === 1 ? 'citation' : 'citations'}
                </p>
              </div>

              {/* Add button */}
              <button
                data-testid={`source-add-btn-${source.source_cache_id}`}
                onClick={() => onAddSource(source.url)}
                disabled={alreadyAdded}
                className={cn(
                  'flex-shrink-0 p-1 rounded-book transition-colors',
                  alreadyAdded
                    ? 'text-[var(--text-muted)] cursor-not-allowed'
                    : 'text-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/10'
                )}
                title={alreadyAdded ? 'Already added' : 'Add source'}
              >
                <PlusIcon className="w-4 h-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
