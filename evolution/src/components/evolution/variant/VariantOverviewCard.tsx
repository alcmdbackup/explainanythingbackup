// Header card for variant detail page showing metadata, attribution badge, and navigation links.
// Displays variant identity, Elo score, agent, generation, and links to parent entities.

import Link from 'next/link';

import { AttributionBadge } from '@evolution/components/evolution/AttributionBadge';
import { EvolutionStatusBadge } from '@evolution/components/evolution';
import type { EvolutionRunStatus } from '@evolution/lib/types';
import { buildExplanationUrl, buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatElo } from '@evolution/lib/utils/formatters';
import type { VariantFullDetail } from '@evolution/services/variantDetailActions';

interface VariantOverviewCardProps {
  variant: VariantFullDetail;
}

const NAV_LINK_CLASS = 'px-3 py-1.5 border border-[var(--border-default)] rounded-page text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]';

export function VariantOverviewCard({ variant }: VariantOverviewCardProps): JSX.Element {
  return (
    <div
      className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-6 space-y-4"
      data-testid="variant-overview-card"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--text-primary)]">
            Variant {variant.id.substring(0, 8)}
          </h1>
          <div className="mt-1 text-xs text-[var(--text-muted)] font-mono" title={variant.id}>
            {variant.id}
          </div>
        </div>
        <div className="flex gap-2">
          {variant.explanationId != null && (
            <Link href={buildExplanationUrl(variant.explanationId)} className={NAV_LINK_CLASS}>
              Explanation
            </Link>
          )}
          <Link href={buildRunUrl(variant.runId)} className={NAV_LINK_CLASS}>
            View Run
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" data-testid="variant-stats">
        <div>
          <div className="text-xs text-[var(--text-muted)]">Elo Score</div>
          <div className="text-xl font-semibold text-[var(--text-primary)]">{formatElo(variant.eloScore)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)]">Agent</div>
          <div className="text-sm font-mono text-[var(--text-primary)]">{variant.agentName}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)]">Generation</div>
          <div className="text-xl font-semibold text-[var(--text-primary)]">{variant.generation}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)]">Matches</div>
          <div className="text-xl font-semibold text-[var(--text-primary)]">{variant.matchCount}</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <EvolutionStatusBadge status={variant.runStatus as EvolutionRunStatus} />
        {variant.isWinner && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--status-success)]/20 text-[var(--status-success)]">
            Winner
          </span>
        )}
        {variant.explanationTitle && (
          <span className="text-xs text-[var(--text-muted)]">
            Article: <span className="text-[var(--text-secondary)]">{variant.explanationTitle}</span>
          </span>
        )}
        {variant.eloAttribution && (
          <AttributionBadge attribution={variant.eloAttribution} />
        )}
      </div>
    </div>
  );
}
