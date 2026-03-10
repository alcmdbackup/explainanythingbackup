// Detail view for MetaReviewAgent showing analysis arrays and threshold triggers.

import type { MetaReviewExecutionDetail } from '@evolution/lib/types';
import type { AgentDetailEnrichment } from './AgentExecutionDetailView';
import { formatScore, formatElo } from '@evolution/lib/utils/formatters';
import { DetailSection, CostDisplay, Metric } from './shared';

function ListSection({ items, emptyText }: { items: string[]; emptyText: string }): JSX.Element {
  if (items.length === 0) return <div className="text-xs text-[var(--text-muted)] font-ui italic">{emptyText}</div>;
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="text-xs font-body text-[var(--text-secondary)]">
          {item}
        </li>
      ))}
    </ul>
  );
}

export function MetaReviewDetail({ detail }: { detail: MetaReviewExecutionDetail; runId?: string; enrichment?: AgentDetailEnrichment }): JSX.Element {
  const { analysis } = detail;
  return (
    <div className="space-y-3" data-testid="meta-review-detail">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DetailSection title="Successful Strategies">
          <ListSection items={detail.successfulStrategies} emptyText="None identified" />
        </DetailSection>
        <DetailSection title="Recurring Weaknesses">
          <ListSection items={detail.recurringWeaknesses} emptyText="None identified" />
        </DetailSection>
        <DetailSection title="Patterns to Avoid">
          <ListSection items={detail.patternsToAvoid} emptyText="None identified" />
        </DetailSection>
        <DetailSection title="Priority Improvements">
          <ListSection items={detail.priorityImprovements} emptyText="None identified" />
        </DetailSection>
      </div>
      <DetailSection title="Analysis Snapshot">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <Metric label="Bottom Quartile" value={analysis.bottomQuartileCount} />
          <Metric label="Pool Diversity" value={formatScore(analysis.poolDiversity)} />
          <Metric label="Mu Range" value={formatElo(analysis.muRange)} />
          <Metric label="Active Strategies" value={analysis.activeStrategies} />
          <Metric label="Top Variant Age" value={analysis.topVariantAge} />
          <Metric label="Cost" value={<CostDisplay cost={detail.totalCost} />} />
        </div>
      </DetailSection>
    </div>
  );
}
