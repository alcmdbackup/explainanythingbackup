/**
 * Bibliography — Footer section displaying numbered source references in scholarly style.
 * Optionally shows "Cited in N articles" badges linking to source profile pages.
 */
'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

interface BibliographySource {
  index: number;
  title: string;
  domain: string;
  url: string;
  favicon_url?: string | null;
  /** source_cache_id for linking to profile page */
  source_cache_id?: number;
}

interface CitationCount {
  source_cache_id: number;
  total_citations: number;
}

interface BibliographyProps {
  sources: BibliographySource[];
  /** Optional citation counts — when provided, renders "Cited in N articles" badges */
  citationCounts?: CitationCount[];
  className?: string;
}

/**
 * Bibliography - Footer section for articles with sources
 *
 * Displays numbered references in scholarly style:
 * [n] Title - domain.com (clickable link)
 */
export default function Bibliography({ sources, citationCounts, className = '' }: BibliographyProps) {
  if (!sources || sources.length === 0) {
    return null;
  }

  // Build a lookup map for citation counts
  const countMap = new Map<number, number>();
  if (citationCounts) {
    for (const cc of citationCounts) {
      countMap.set(cc.source_cache_id, cc.total_citations);
    }
  }

  return (
    <div className={cn('mt-8 pt-6 border-t border-[var(--border-default)]', className)}>
      {/* Section header with decorative flourish */}
      <div className="mb-4">
        <h2 className="text-lg font-display font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <svg className="w-5 h-5 text-[var(--accent-gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          Sources
        </h2>
        <div className="title-flourish mt-2 w-24"></div>
      </div>

      {/* References list */}
      <ol className="space-y-3">
        {sources.map((source) => {
          const citationCount = source.source_cache_id != null
            ? countMap.get(source.source_cache_id)
            : undefined;

          return (
            <li
              key={source.index}
              id={`source-${source.index}`}
              className="flex items-start gap-3 group"
            >
              {/* Citation number */}
              <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-[var(--accent-gold)]/10 text-[var(--accent-gold)] text-xs font-ui font-bold">
                {source.index}
              </span>

              {/* Source details */}
              <div className="flex-1 min-w-0">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/link inline-flex items-start gap-2 text-sm"
                >
                  {/* Favicon - using img for dynamic external URLs */}
                  {source.favicon_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={source.favicon_url}
                      alt=""
                      className="w-4 h-4 mt-0.5 rounded-sm flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}

                  {/* Title and domain */}
                  <span className="flex-1">
                    <span className="font-body text-[var(--text-primary)] group-hover/link:text-[var(--accent-gold)] transition-colors">
                      {source.title || source.domain}
                    </span>
                    {source.title && (
                      <span className="text-[var(--text-muted)] ml-2">
                        — {source.domain}
                      </span>
                    )}
                  </span>

                  {/* External link icon */}
                  <svg
                    className="w-3.5 h-3.5 mt-0.5 text-[var(--text-muted)] group-hover/link:text-[var(--accent-gold)] transition-colors flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>

                {/* Citation count badge — links to source profile */}
                {citationCount != null && citationCount > 1 && source.source_cache_id != null && (
                  <Link
                    href={`/sources/${source.source_cache_id}`}
                    data-testid={`citation-badge-${source.source_cache_id}`}
                    className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-[var(--surface-secondary)] text-xs font-ui text-[var(--text-muted)] hover:text-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/10 transition-colors"
                  >
                    Cited in {citationCount} articles
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
