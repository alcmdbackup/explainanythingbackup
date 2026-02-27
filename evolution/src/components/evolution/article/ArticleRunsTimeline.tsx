// Run cards showing all evolution runs for an article, ordered newest-first.
// Each card links to the run detail page and shows winner Elo + status.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EvolutionStatusBadge, EmptyState } from '@evolution/components/evolution';
import { getArticleRunsAction, type ArticleRun } from '@evolution/services/articleDetailActions';
import { buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCost, formatElo } from '@evolution/lib/utils/formatters';
import type { EvolutionRunStatus } from '@evolution/lib/types';

interface ArticleRunsTimelineProps {
  explanationId: number;
}

export function ArticleRunsTimeline({ explanationId }: ArticleRunsTimelineProps): JSX.Element {
  const [runs, setRuns] = useState<ArticleRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getArticleRunsAction(explanationId).then(res => {
      if (res.success && res.data) setRuns(res.data);
      setLoading(false);
    });
  }, [explanationId]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return <EmptyState message="No evolution runs yet for this article." />;
  }

  return (
    <div className="space-y-3" data-testid="article-runs-timeline">
      {runs.map(run => (
        <Link
          key={run.id}
          href={buildRunUrl(run.id)}
          className="block border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4 hover:bg-[var(--surface-secondary)] transition-colors"
          data-testid="article-run-card"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-[var(--accent-gold)]">{run.id.substring(0, 8)}</span>
              <EvolutionStatusBadge status={run.status as EvolutionRunStatus} />
              {run.pipelineType && (
                <span className="text-xs text-[var(--text-muted)]">{run.pipelineType}</span>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
              {run.winnerElo != null && (
                <span>Winner: <span className="text-[var(--text-primary)] font-semibold">{formatElo(run.winnerElo)}</span></span>
              )}
              <span>{run.totalVariants} variants</span>
              <span>{formatCost(run.totalCostUsd)}</span>
              <span>{new Date(run.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
