/**
 * SourceProfile — Client component displaying full source metadata,
 * citing articles, and co-cited sources.
 */
'use client';

import Link from 'next/link';
import Navigation from '@/components/Navigation';
import ExplanationCard from '@/components/explore/ExplanationCard';
import { cn } from '@/lib/utils';
import { type SourceProfileData } from '@/lib/services/sourceDiscovery';

interface SourceProfileProps {
  data: SourceProfileData;
}

export default function SourceProfile({ data }: SourceProfileProps) {
  const { source, citingArticles, coCitedSources } = data;

  return (
    <div className="min-h-screen bg-[var(--surface-primary)]">
      <Navigation />

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Source header */}
        <div data-testid="source-profile-header" className="mb-8">
          <div className="flex items-start gap-4">
            {/* Large favicon */}
            <div className="flex-shrink-0 w-12 h-12 rounded-book bg-[var(--surface-elevated)] border border-[var(--border-default)] flex items-center justify-center overflow-hidden">
              {source.favicon_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={source.favicon_url} alt="" className="w-8 h-8" />
              ) : (
                <span className="text-lg font-body font-bold text-[var(--text-muted)] uppercase">
                  {source.domain.charAt(0)}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-display font-bold text-[var(--text-primary)]">
                {source.title || source.domain}
              </h1>
              <p className="text-sm font-ui text-[var(--text-muted)] mt-1">
                {source.domain}
              </p>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-sm font-ui text-[var(--accent-gold)] hover:underline"
              >
                Visit source
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* Citing articles */}
        <section className="mb-10">
          <h2 className="text-lg font-display font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-[var(--accent-gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Cited in {citingArticles.length} {citingArticles.length === 1 ? 'article' : 'articles'}
          </h2>

          {citingArticles.length === 0 ? (
            <p className="text-sm font-body text-[var(--text-muted)]">
              No published articles cite this source yet.
            </p>
          ) : (
            <div data-testid="citing-articles-list" className="grid gap-4 sm:grid-cols-2">
              {citingArticles.map((article) => (
                <ExplanationCard
                  key={article.id}
                  explanation={article}
                  href={`/results?explanation_id=${article.id}`}
                />
              ))}
            </div>
          )}
        </section>

        {/* Co-cited sources */}
        {coCitedSources.length > 0 && (
          <section>
            <h2 className="text-lg font-display font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-[var(--accent-copper)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Frequently co-cited with
            </h2>

            <div data-testid="co-cited-sources-list" className="space-y-2">
              {coCitedSources.map((coCited) => (
                <Link
                  key={coCited.source_cache_id}
                  href={`/sources/${coCited.source_cache_id}`}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-book border border-[var(--border-default)]',
                    'hover:border-[var(--accent-copper)]/40 hover:bg-[var(--surface-elevated)] transition-colors'
                  )}
                >
                  <div className="flex-shrink-0 w-6 h-6 rounded bg-[var(--surface-page)] flex items-center justify-center overflow-hidden">
                    {coCited.favicon_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coCited.favicon_url} alt="" className="w-4 h-4" />
                    ) : (
                      <span className="text-xs font-ui text-[var(--text-muted)] uppercase">
                        {coCited.domain.charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-body text-[var(--text-primary)] truncate">
                      {coCited.title || coCited.domain}
                    </p>
                    <p className="text-xs font-ui text-[var(--text-muted)]">
                      {coCited.domain} &middot; co-cited {coCited.frequency} {coCited.frequency === 1 ? 'time' : 'times'}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
