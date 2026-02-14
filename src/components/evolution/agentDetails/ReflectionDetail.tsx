// Detail view for ReflectionAgent showing per-variant critique results with dimension scores.

import type { ReflectionExecutionDetail } from '@/lib/evolution/types';
import { StatusBadge, DetailSection, CostDisplay, ShortId } from './shared';

export function ReflectionDetail({ detail }: { detail: ReflectionExecutionDetail }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="reflection-detail">
      <DetailSection title="Critiques">
        <div className="space-y-2">
          {detail.variantsCritiqued.map((v, i) => (
            <div key={i} className="px-3 py-2 bg-[var(--surface-elevated)] rounded-page text-xs">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <ShortId id={v.variantId} />
                  <StatusBadge status={v.status} />
                </div>
                {v.avgScore !== undefined && (
                  <span className="font-mono text-[var(--text-secondary)]">{v.avgScore.toFixed(2)} avg</span>
                )}
              </div>
              {v.dimensionScores && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {Object.entries(v.dimensionScores).map(([dim, score]) => (
                    <span key={dim} className="text-[var(--text-muted)] font-ui">
                      {dim}: <span className="font-mono">{score.toFixed(1)}</span>
                    </span>
                  ))}
                </div>
              )}
              {v.error && <div className="text-[var(--status-error)] mt-1">{v.error}</div>}
            </div>
          ))}
        </div>
      </DetailSection>
      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] font-ui">
        <span>Dimensions: {detail.dimensions.join(', ')}</span>
        <span>Cost: <CostDisplay cost={detail.totalCost} /></span>
      </div>
    </div>
  );
}
