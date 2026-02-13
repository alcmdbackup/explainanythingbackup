// Detail view for CalibrationAgent showing per-entrant match results and rating changes.

import type { CalibrationExecutionDetail } from '@/lib/evolution/types';
import { StatusBadge, DetailSection, CostDisplay, ShortId, Metric } from './shared';

export function CalibrationDetail({ detail }: { detail: CalibrationExecutionDetail }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="calibration-detail">
      <DetailSection title="Entrants">
        <div className="space-y-2">
          {detail.entrants.map((e, i) => (
            <div key={i} className="px-3 py-2 bg-[var(--surface-elevated)] rounded-page text-xs">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <ShortId id={e.variantId} />
                  {e.earlyExit && <StatusBadge status="early_exit" />}
                </div>
                <span className="font-mono text-[var(--text-muted)]">
                  μ {e.ratingBefore.mu.toFixed(1)} → {e.ratingAfter.mu.toFixed(1)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {e.matches.map((m, j) => (
                  <span
                    key={j}
                    className={`px-1.5 py-0.5 rounded-page font-mono ${
                      m.winner === e.variantId
                        ? 'bg-[var(--status-success)]/15 text-[var(--status-success)]'
                        : 'bg-[var(--status-error)]/15 text-[var(--status-error)]'
                    }`}
                    title={`vs ${m.opponentId} (conf: ${m.confidence.toFixed(2)}${m.cacheHit ? ', cached' : ''})`}
                  >
                    {m.winner === e.variantId ? 'W' : 'L'}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
      <div className="grid grid-cols-3 gap-4">
        <Metric label="Total Matches" value={detail.totalMatches} />
        <Metric label="Avg Confidence" value={detail.avgConfidence.toFixed(2)} />
        <Metric label="Cost" value={<CostDisplay cost={detail.totalCost} />} />
      </div>
    </div>
  );
}
