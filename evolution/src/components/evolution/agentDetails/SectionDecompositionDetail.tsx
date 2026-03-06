// Detail view for SectionDecompositionAgent showing per-section eligibility and improvement status.

import type { SectionDecompositionExecutionDetail } from '@evolution/lib/types';
import type { AgentDetailEnrichment } from './AgentExecutionDetailView';
import { StatusBadge, DetailSection, CostDisplay, ShortId, Metric } from './shared';

export function SectionDecompositionDetail({ detail, runId }: { detail: SectionDecompositionExecutionDetail; runId?: string; enrichment?: AgentDetailEnrichment }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="section-decomposition-detail">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-ui text-[var(--text-muted)]">Target:</span>
        <ShortId id={detail.targetVariantId} runId={runId} />
        <span className="text-[var(--text-muted)]">
          weakness: <span className="font-mono">{detail.weakness.dimension}</span>
        </span>
        {!detail.formatValid && <StatusBadge status="format_rejected" />}
      </div>
      <DetailSection title={`Sections (${detail.sections.length})`}>
        <div className="space-y-1">
          {detail.sections.map((s) => (
            <div
              key={s.index}
              className="flex items-center justify-between px-3 py-1.5 bg-[var(--surface-elevated)] rounded-page text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[var(--text-muted)] w-5">{s.index}</span>
                <span className="font-body text-[var(--text-secondary)] truncate max-w-[200px]">
                  {s.heading ?? '(no heading)'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[var(--text-muted)]">{s.charCount}</span>
                {s.eligible && !s.improved && <StatusBadge status="eligible" />}
                {s.improved && <StatusBadge status="improved" />}
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
      <div className="grid grid-cols-3 gap-4">
        <Metric label="Improved" value={`${detail.sectionsImproved}/${detail.totalEligible}`} />
        <Metric label="New Variant" value={detail.newVariantId ? <ShortId id={detail.newVariantId} runId={runId} /> : '—'} />
        <Metric label="Cost" value={<CostDisplay cost={detail.totalCost} />} />
      </div>
    </div>
  );
}
