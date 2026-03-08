// Client component for variant detail: EntityDetailHeader + EntityDetailTabs.
// Renders overview metrics, content, match history, and lineage tabs.

'use client';

import { EntityDetailHeader, MetricGrid, EntityDetailTabs, useTabState } from '@evolution/components/evolution';
import { EvolutionStatusBadge } from '@evolution/components/evolution/EvolutionStatusBadge';
import { AttributionBadge } from '@evolution/components/evolution/AttributionBadge';
import { VariantContentSection } from '@evolution/components/evolution/variant/VariantContentSection';
import { VariantLineageSection } from '@evolution/components/evolution/variant/VariantLineageSection';
import { VariantMatchHistory } from '@evolution/components/evolution/variant/VariantMatchHistory';
import { buildRunUrl, buildExplanationUrl, buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatElo } from '@evolution/lib/utils/formatters';
import type { VariantFullDetail } from '@evolution/services/variantDetailActions';
import type { EvolutionRunStatus } from '@evolution/lib/types';
import type { EntityLink } from '@evolution/components/evolution/EntityDetailHeader';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'content', label: 'Content' },
  { id: 'matches', label: 'Match History' },
  { id: 'lineage', label: 'Lineage' },
];

interface Props {
  variant: VariantFullDetail;
  variantId: string;
}

export function VariantDetailContent({ variant, variantId }: Props): JSX.Element {
  const [activeTab, setActiveTab] = useTabState(TABS);

  const links: EntityLink[] = [
    { prefix: 'Run', label: variant.runId.substring(0, 8), href: buildRunUrl(variant.runId) },
    ...(variant.explanationId != null
      ? [{ prefix: 'Explanation', label: variant.explanationTitle ?? `#${variant.explanationId}`, href: buildExplanationUrl(variant.explanationId) }]
      : []),
    ...(variant.parentVariantId
      ? [{ prefix: 'Parent', label: variant.parentVariantId.substring(0, 8), href: buildVariantDetailUrl(variant.parentVariantId) }]
      : []),
  ];

  const statusBadge = (
    <div className="flex items-center gap-2">
      <EvolutionStatusBadge status={variant.runStatus as EvolutionRunStatus} />
      {variant.isWinner && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--status-success)]/20 text-[var(--status-success)]">
          Winner
        </span>
      )}
      {variant.eloAttribution && <AttributionBadge attribution={variant.eloAttribution} />}
    </div>
  );

  return (
    <>
      <EntityDetailHeader
        title={`Variant ${variantId.substring(0, 8)}`}
        entityId={variantId}
        links={links}
        statusBadge={statusBadge}
      />
      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <MetricGrid
              columns={4}
              metrics={[
                { label: 'Elo', value: formatElo(variant.eloScore) },
                { label: 'Agent', value: variant.agentName },
                { label: 'Generation', value: variant.generation },
                { label: 'Matches', value: variant.matchCount },
              ]}
            />
            {variant.variantContent && (
              <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
                <p className="text-sm font-body text-[var(--text-secondary)] line-clamp-6">
                  {variant.variantContent}
                </p>
              </div>
            )}
          </div>
        )}
        {activeTab === 'content' && <VariantContentSection content={variant.variantContent} />}
        {activeTab === 'matches' && <VariantMatchHistory variantId={variantId} />}
        {activeTab === 'lineage' && <VariantLineageSection variantId={variantId} />}
      </EntityDetailTabs>
    </>
  );
}
