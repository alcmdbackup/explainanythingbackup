// Client component for variant detail rendering: header, content, and lineage sections.
'use client';

import { EntityDetailHeader } from '@evolution/components/evolution';
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard label="Agent" value={variant.agentName} />
        <MetricCard label="Generation" value={String(variant.generation)} />
        <MetricCard label="Rating" value={String(Math.round(variant.eloScore))} />
        <MetricCard label="Matches" value={String(variant.matchCount)} />
      </div>

      <VariantContentSection content={variant.variantContent} />
      <VariantLineageSection variantId={variant.id} />
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4">
      <p className="text-xs font-ui text-[var(--text-muted)] mb-1">{label}</p>
      <p className="text-lg font-body font-bold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
