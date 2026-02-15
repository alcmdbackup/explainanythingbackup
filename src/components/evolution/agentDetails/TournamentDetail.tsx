// Detail view for TournamentAgent showing round-by-round match brackets and exit conditions.

import type { TournamentExecutionDetail } from '@/lib/evolution/types';
import { formatScore } from '@/lib/utils/formatters';
import { StatusBadge, DetailSection, CostDisplay, Metric, ShortId } from './shared';

export function TournamentDetail({ detail, runId }: { detail: TournamentExecutionDetail; runId?: string }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="tournament-detail">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Metric label="Comparisons" value={detail.totalComparisons} />
        <Metric label="Budget Tier" value={<StatusBadge status={detail.budgetTier} />} />
        <Metric label="Exit Reason" value={detail.exitReason} />
        <Metric label="Flow Enabled" value={detail.flowEnabled ? 'Yes' : 'No'} />
      </div>
      <DetailSection title={`Rounds (${detail.rounds.length})`}>
        <div className="space-y-2">
          {detail.rounds.map((r) => (
            <div key={r.roundNumber} className="px-3 py-2 bg-[var(--surface-elevated)] rounded-page text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-ui font-medium text-[var(--text-secondary)]">Round {r.roundNumber}</span>
                <div className="flex items-center gap-2 text-[var(--text-muted)]">
                  <span>{r.pairs.length} pairs</span>
                  {r.multiTurnUsed > 0 && <span>{r.multiTurnUsed} multi-turn</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.pairs.map((p, j) => (
                  <div key={j} className="flex items-center gap-1 text-[var(--text-muted)]">
                    <ShortId id={p.variantA} runId={runId} />
                    <span>vs</span>
                    <ShortId id={p.variantB} runId={runId} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] font-ui">
        <span>Convergence: {detail.convergenceStreak} streak</span>
        <span>Stale: {detail.staleRounds}</span>
        <span>Pressure: {formatScore(detail.budgetPressure)}</span>
        <span>Cost: <CostDisplay cost={detail.totalCost} /></span>
      </div>
    </div>
  );
}
