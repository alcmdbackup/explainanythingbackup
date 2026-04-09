/**
 * SourceCard — Displays a source with domain, title, citation count, and favicon.
 * Used on the /sources leaderboard page and source discovery panels.
 */
'use client';

import { cn } from '@/lib/utils';

interface SourceCardProps {
  sourceCacheId: number;
  domain: string;
  title: string | null;
  faviconUrl: string | null;
  totalCitations: number;
  uniqueExplanations: number;
  index?: number;
}

export default function SourceCard({
  sourceCacheId,
  domain,
  title,
  faviconUrl,
  totalCitations,
  uniqueExplanations,
  index = 0,
}: SourceCardProps) {
  return (
    <div
      data-testid={`source-card-${sourceCacheId}`}
      className={cn(
        'group relative p-4 rounded-book border border-[var(--border-default)]',
        'bg-[var(--surface-elevated)] hover:border-[var(--accent-gold)]/40',
        'transition-all duration-200 hover:shadow-page'
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start gap-3">
        {/* Favicon */}
        <div className="flex-shrink-0 w-8 h-8 rounded-md bg-[var(--surface-page)] flex items-center justify-center overflow-hidden">
          {faviconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external source favicon from arbitrary domain
            <img
              src={faviconUrl}
              alt=""
              className="w-5 h-5"
              loading="lazy"
            />
          ) : (
            <span className="text-xs font-ui font-semibold text-[var(--text-muted)] uppercase">
              {domain.charAt(0)}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-display font-semibold text-[var(--text-primary)] truncate">
            {title || domain}
          </h3>
          <p className="text-xs font-ui text-[var(--text-muted)] truncate mt-0.5">
            {domain}
          </p>
        </div>

        {/* Citation count badge */}
        <div className="flex-shrink-0 text-right">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]">
            <span className="text-sm font-body font-bold">{totalCitations}</span>
            <span className="text-xs font-ui">citations</span>
          </span>
          <p className="text-xs font-ui text-[var(--text-muted)] mt-1">
            {uniqueExplanations} {uniqueExplanations === 1 ? 'article' : 'articles'}
          </p>
        </div>
      </div>
    </div>
  );
}
