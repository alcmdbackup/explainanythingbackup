// Detail view for CalibrationAgent showing per-entrant match results and rating changes.

import type { CalibrationExecutionDetail } from '@evolution/lib/types';
import { formatScore, formatScore1 } from '@evolution/lib/utils/formatters';
import { StatusBadge, DetailSection, CostDisplay, ShortId, Metric } from './shared';

export function CalibrationDetail({ detail, runId }: { detail: CalibrationExecutionDetail; runId?: string }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="calibration-detail">
      <DetailSection title="Entrants">
        <div className="space-y-2">
          {detail.entrants.map((e, i) => (
            <div key={i} className="px-3 py-2 bg-[var(--surface-elevated)] rounded-page text-xs">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <ShortId id={e.variantId} runId={runId} />
                  {e.earlyExit && <StatusBadge status="early_exit" />}
                </div>
                <span className="font-mono text-[var(--text-muted)]">
                  μ {formatScore1(e.ratingBefore.mu)} → {formatScore1(e.ratingAfter.mu)}
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
                    title={`vs ${m.opponentId} (conf: ${formatScore(m.confidence)}${m.cacheHit ? ', cached' : ''})`}
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
        <Metric label="Avg Confidence" value={formatScore(detail.avgConfidence)} />
        <Metric label="Cost" value={<CostDisplay cost={detail.totalCost} />} />
      </div>
    </div>
  );
}
