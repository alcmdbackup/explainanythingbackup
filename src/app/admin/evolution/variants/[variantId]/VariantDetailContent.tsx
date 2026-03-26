// Client component for variant detail: tabbed interface with metrics, content, and lineage.
'use client';

import { EntityDetailHeader, MetricGrid, EntityDetailTabs, useTabState, EntityMetricsTab } from '@evolution/components/evolution';
import { VariantContentSection } from '@evolution/components/evolution/variant/VariantContentSection';
import { VariantLineageSection } from '@evolution/components/evolution/variant/VariantLineageSection';
import type { VariantFullDetail } from '@evolution/services/variantDetailActions';

const TABS = [
  { id: 'content', label: 'Content' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'lineage', label: 'Lineage' },
];

interface VariantDetailContentProps {
  variant: VariantFullDetail;
}

export function VariantDetailContent({ variant }: VariantDetailContentProps): JSX.Element {
  const [activeTab, setActiveTab] = useTabState(TABS);

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
        columns={4}
        variant="bordered"
        size="lg"
        metrics={[
          { label: 'Agent', value: variant.agentName || '—' },
          { label: 'Generation', value: String(variant.generation) },
          { label: 'Rating', value: String(Math.round(variant.eloScore)) },
          { label: 'Matches', value: String(variant.matchCount) },
        ]}
      />

      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'metrics' && <EntityMetricsTab entityType="variant" entityId={variant.id} />}
        {activeTab === 'content' && <VariantContentSection content={variant.variantContent} />}
        {activeTab === 'lineage' && <VariantLineageSection variantId={variant.id} />}
      </EntityDetailTabs>
    </div>
  );
}
