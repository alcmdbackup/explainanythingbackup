// Lists all variants across runs for an article, ordered by Elo descending.
// Each row links to the variant detail page and shows key metrics.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getArticleVariantsAction, type ArticleVariant } from '@evolution/services/articleDetailActions';
import { AttributionBadge } from '@evolution/components/evolution/AttributionBadge';
import { buildVariantDetailUrl, buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatElo } from '@evolution/lib/utils/formatters';
import { EmptyState } from '@evolution/components/evolution';

interface ArticleVariantsListProps {
  explanationId: number;
}

export function ArticleVariantsList({ explanationId }: ArticleVariantsListProps): JSX.Element {
  const [variants, setVariants] = useState<ArticleVariant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getArticleVariantsAction(explanationId).then(res => {
      if (res.success && res.data) setVariants(res.data);
      setLoading(false);
    });
  }, [explanationId]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-12 bg-[var(--surface-elevated)] rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (variants.length === 0) {
    return <EmptyState message="No variants found for this article." />;
  }

  return (
    <div className="border border-[var(--border-default)] rounded-book overflow-hidden" data-testid="article-variants-list">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--surface-secondary)] text-xs text-[var(--text-muted)]">
            <th className="text-left px-4 py-2 font-medium">Variant</th>
            <th className="text-left px-4 py-2 font-medium">Run</th>
            <th className="text-left px-4 py-2 font-medium">Agent</th>
            <th className="text-right px-4 py-2 font-medium">Elo</th>
            <th className="text-right px-4 py-2 font-medium">Gen</th>
            <th className="text-right px-4 py-2 font-medium">Matches</th>
            <th className="text-right px-4 py-2 font-medium">Attribution</th>
          </tr>
        </thead>
        <tbody>
          {variants.map(v => (
            <tr key={v.id} className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)] transition-colors">
              <td className="px-4 py-2">
                <Link href={buildVariantDetailUrl(v.id)} className="font-mono text-xs text-[var(--accent-gold)] hover:underline" title={v.id}>
                  {v.id.substring(0, 8)}
                </Link>
                {v.isWinner && <span className="ml-1 text-[var(--status-success)]" title="Winner">★</span>}
              </td>
              <td className="px-4 py-2">
                <Link href={buildRunUrl(v.runId)} className="font-mono text-xs text-[var(--accent-gold)] hover:underline" title={v.runId}>
                  {v.runId.substring(0, 8)}
                </Link>
              </td>
              <td className="px-4 py-2 font-mono text-xs text-[var(--text-secondary)]">{v.agentName}</td>
              <td className="px-4 py-2 text-right font-semibold text-[var(--text-primary)]">{formatElo(v.eloScore)}</td>
              <td className="px-4 py-2 text-right text-[var(--text-muted)]">{v.generation}</td>
              <td className="px-4 py-2 text-right text-[var(--text-muted)]">{v.matchCount}</td>
              <td className="px-4 py-2 text-right">
                {v.eloAttribution && <AttributionBadge attribution={v.eloAttribution} compact />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
