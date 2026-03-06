// Header card showing explanation metadata: title, total runs, best Elo, and HoF standing.
// Displays at the top of the article detail page as a summary dashboard.

import Link from 'next/link';
import type { ArticleOverview } from '@evolution/services/articleDetailActions';
import { buildExplanationUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatElo } from '@evolution/lib/utils/formatters';

interface ArticleOverviewCardProps {
  overview: ArticleOverview;
}

export function ArticleOverviewCard({ overview }: ArticleOverviewCardProps): JSX.Element {
  return (
    <div
      className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-6 space-y-4"
      data-testid="article-overview-card"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--text-primary)]">
            {overview.title}
          </h1>
          <div className="mt-1 text-xs text-[var(--text-muted)] font-mono">
            Explanation #{overview.explanationId}
          </div>
        </div>
        <Link
          href={buildExplanationUrl(overview.explanationId)}
          className="px-3 py-1.5 border border-[var(--border-default)] rounded-page text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
        >
          View Public Page
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-4" data-testid="article-stats">
        <StatCell label="Total Runs" value={String(overview.totalRuns)} />
        <StatCell label="Best Elo" value={overview.bestElo != null ? formatElo(overview.bestElo) : '\u2014'} />
        <StatCell label="Best Variant" value={overview.bestVariantId ? overview.bestVariantId.substring(0, 8) : '\u2014'} mono />
        <StatCell label="HoF Entries" value={String(overview.hofEntries)} />
      </div>
    </div>
  );
}

function StatCell({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="text-center">
      <div className={`text-xl font-semibold text-[var(--text-primary)] ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
    </div>
  );
}
