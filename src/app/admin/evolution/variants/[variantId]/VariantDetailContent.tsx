// Client component for variant detail: tabbed interface with metrics, content, and lineage.
'use client';

import Link from 'next/link';
import { EntityDetailHeader, MetricGrid, EntityDetailTabs, useTabState, EntityMetricsTab } from '@evolution/components/evolution';
import { VariantContentSection } from '@evolution/components/evolution/variant/VariantContentSection';
import { VariantLineageSection } from '@evolution/components/evolution/variant/VariantLineageSection';
import { VariantMatchHistory } from '@evolution/components/evolution/variant/VariantMatchHistory';
import { VariantParentBadge } from '@evolution/components/evolution/variant/VariantParentBadge';
import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';
import type { VariantFullDetail } from '@evolution/services/variantDetailActions';
import { formatEloWithUncertainty } from '@evolution/lib/utils/formatters';
import { bootstrapDeltaCI } from '@evolution/lib/shared/ratingDelta';

const TABS = [
  { id: 'content', label: 'Content' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'matches', label: 'Matches' },
  { id: 'lineage', label: 'Lineage' },
];

interface VariantDetailContentProps {
  variant: VariantFullDetail;
}

export function VariantDetailContent({ variant }: VariantDetailContentProps): JSX.Element {
  const [activeTab, setActiveTab] = useTabState(TABS);

  const parentBadge = (() => {
    if (!variant.parentVariantId) {
      return (
        <VariantParentBadge
          parentId={null}
          parentElo={null}
          parentUncertainty={null}
          delta={null}
          deltaCi={null}
        />
      );
    }
    const childRating = { elo: variant.eloScore, uncertainty: variant.uncertainty ?? 0 };
    const parentElo = variant.parentElo;
    const parentUncertainty = variant.parentUncertainty;
    const { delta, ci } = parentElo != null
      ? bootstrapDeltaCI(childRating, { elo: parentElo, uncertainty: parentUncertainty ?? 0 })
      : { delta: null, ci: null };
    return (
      <VariantParentBadge
        parentId={variant.parentVariantId}
        parentElo={parentElo}
        parentUncertainty={parentUncertainty}
        delta={delta}
        deltaCi={ci}
        crossRun={!!variant.parentRunId && variant.parentRunId !== variant.runId}
      />
    );
  })();

  return (
    <div className="space-y-6" data-testid="variant-detail-content">
      <EntityDetailHeader
        title={`Variant ${variant.id.substring(0, 8)}`}
        entityId={variant.id}
        statusBadge={
          variant.isWinner ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--status-success)] text-white font-ui">
              Winner
            </span>
          ) : null
        }
        links={[
          { prefix: 'Run', label: variant.runId.substring(0, 8), href: `/admin/evolution/runs/${variant.runId}` },
          ...(variant.explanationId
            ? [{ prefix: 'Explanation', label: `#${variant.explanationId}`, href: `/results?explanation_id=${variant.explanationId}` }]
            : []),
        ]}
      />

      <MetricGrid
        columns={5}
        variant="bordered"
        size="lg"
        metrics={[
          { label: 'Agent', value: variant.agentName || '—' },
          { label: 'Generation', value: String(variant.generation) },
          {
            label: 'Rating',
            value: variant.uncertainty != null
              ? (formatEloWithUncertainty(variant.eloScore, variant.uncertainty) ?? String(Math.round(variant.eloScore)))
              : String(Math.round(variant.eloScore)),
          },
          { label: 'Matches', value: String(variant.matchCount) },
          {
            label: 'Parent Variant',
            value: variant.parentVariantId ? (
              <Link
                href={buildVariantDetailUrl(variant.parentVariantId)}
                className="text-[var(--accent-gold)] hover:underline font-mono"
              >
                {variant.parentVariantId.substring(0, 8)}
              </Link>
            ) : '—',
          },
        ]}
      />

      <div className="text-sm font-ui" data-testid="variant-detail-parent-badge">
        {parentBadge}
      </div>

      {variant.persisted === false && (
        <div
          className="rounded-book border border-[var(--status-error)] bg-[var(--status-error)]/10 p-3"
          data-testid="variant-discarded-banner"
        >
          <p className="text-sm font-ui font-medium text-[var(--status-error)]">
            Discarded variant
          </p>
          <p className="text-xs font-ui text-[var(--text-secondary)] mt-1">
            This variant was discarded by its owning generate agent (local Elo below the
            top-15% cutoff at budget exhaustion). It is not included in run-level metrics.
          </p>
        </div>
      )}

      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'metrics' && <EntityMetricsTab entityType="variant" entityId={variant.id} />}
        {activeTab === 'content' && <VariantContentSection content={variant.variantContent} />}
        {activeTab === 'matches' && <VariantMatchHistory variantId={variant.id} />}
        {activeTab === 'lineage' && <VariantLineageSection variantId={variant.id} />}
      </EntityDetailTabs>
    </div>
  );
}
