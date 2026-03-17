// Detail view for unified RankingAgent showing triage entrants and fine-ranking summary.

import type { RankingExecutionDetail } from '@evolution/lib/types';
import type { AgentDetailEnrichment } from './AgentExecutionDetailView';
import { formatScore, formatScore1 } from '@evolution/lib/utils/formatters';
import { StatusBadge, DetailSection, CostDisplay, ShortId, Metric } from './shared';

export function RankingDetail({ detail, runId }: { detail: RankingExecutionDetail; runId?: string; enrichment?: AgentDetailEnrichment }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="ranking-detail">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Metric label="Comparisons" value={detail.totalComparisons} />
        <Metric label="Budget Tier" value={<StatusBadge status={detail.budgetTier} />} />
        <Metric label="Contenders" value={detail.eligibleContenders} />
        <Metric label="Flow Enabled" value={detail.flowEnabled ? 'Yes' : 'No'} />
      </div>

      {detail.triage.length > 0 && (
        <DetailSection title={`Triage (${detail.triage.length} entrants)`}>
          <div className="space-y-2">
            {detail.triage.map((e, i) => (
              <div key={i} className="px-3 py-2 bg-[var(--surface-elevated)] rounded-page text-xs">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <ShortId id={e.variantId} runId={runId} />
                    {e.eliminated && <StatusBadge status="eliminated" />}
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
      )}

      <DetailSection title="Fine-Ranking">
        <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] font-ui">
          <span>Rounds: {detail.fineRanking.rounds}</span>
          <span>Exit: {detail.fineRanking.exitReason}</span>
          <span>Convergence: {detail.fineRanking.convergenceStreak} streak</span>
        </div>
      </DetailSection>

      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] font-ui">
        <span>Top-20% cutoff: {formatScore1(detail.top20Cutoff)}</span>
        <span>Pressure: {formatScore(detail.budgetPressure)}</span>
        <span>Cost: <CostDisplay cost={detail.totalCost} /></span>
      </div>
    </div>
  );
}
