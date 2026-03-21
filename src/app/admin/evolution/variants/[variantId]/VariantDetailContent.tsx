// Client component for variant detail rendering: header, content, and lineage sections.
'use client';

import { EntityDetailHeader, MetricGrid } from '@evolution/components/evolution';
import { VariantContentSection } from '@evolution/components/evolution/variant/VariantContentSection';
import { VariantLineageSection } from '@evolution/components/evolution/variant/VariantLineageSection';
import type { VariantFullDetail } from '@evolution/services/variantDetailActions';

interface VariantDetailContentProps {
  variant: VariantFullDetail;
}

export function VariantDetailContent({ variant }: VariantDetailContentProps): JSX.Element {
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
          { label: 'Agent', value: variant.agentName },
          { label: 'Generation', value: String(variant.generation) },
          { label: 'Rating', value: String(Math.round(variant.eloScore)) },
          { label: 'Matches', value: String(variant.matchCount) },
        ]}
      />

      <VariantContentSection content={variant.variantContent} />
      <VariantLineageSection variantId={variant.id} />
    </div>
  );
}

