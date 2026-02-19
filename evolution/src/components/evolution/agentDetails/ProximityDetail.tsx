// Detail view for ProximityAgent showing diversity metrics and pair computation stats.

import type { ProximityExecutionDetail } from '@evolution/lib/types';
import { Metric, CostDisplay, DetailSection } from './shared';

export function ProximityDetail({ detail }: { detail: ProximityExecutionDetail; runId?: string }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="proximity-detail">
      <DetailSection title="Diversity Metrics">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Metric label="New Entrants" value={detail.newEntrants} />
          <Metric label="Existing Variants" value={detail.existingVariants} />
          <Metric label="Diversity Score" value={detail.diversityScore.toFixed(3)} />
          <Metric label="Pairs Computed" value={detail.totalPairsComputed} />
        </div>
      </DetailSection>
      <div className="text-xs text-[var(--text-muted)] font-ui">
        Cost: <CostDisplay cost={detail.totalCost} />
      </div>
    </div>
  );
}
