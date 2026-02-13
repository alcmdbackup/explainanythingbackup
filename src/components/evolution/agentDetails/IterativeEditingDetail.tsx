// Detail view for IterativeEditingAgent showing edit cycles with accept/reject verdicts.

import type { IterativeEditingExecutionDetail } from '@/lib/evolution/types';
import { StatusBadge, DetailSection, CostDisplay, ShortId, Metric } from './shared';

function DimensionScores({ scores }: { scores: Record<string, number> }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(scores).map(([dim, score]) => (
        <span key={dim} className="text-[var(--text-muted)] font-ui text-xs">
          {dim}: <span className="font-mono">{score.toFixed(1)}</span>
        </span>
      ))}
    </div>
  );
}

export function IterativeEditingDetail({ detail }: { detail: IterativeEditingExecutionDetail }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="iterative-editing-detail">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-ui text-[var(--text-muted)]">Target:</span>
        <ShortId id={detail.targetVariantId} />
        <StatusBadge status={detail.stopReason} />
      </div>
      <DetailSection title="Initial Critique">
        <DimensionScores scores={detail.initialCritique.dimensionScores} />
      </DetailSection>
      <DetailSection title={`Edit Cycles (${detail.cycles.length})`}>
        <div className="space-y-2">
          {detail.cycles.map((c) => (
            <div key={c.cycleNumber} className="px-3 py-2 bg-[var(--surface-elevated)] rounded-page text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-ui text-[var(--text-secondary)]">Cycle {c.cycleNumber}</span>
                  <StatusBadge status={c.verdict} />
                  <span className="text-[var(--text-muted)]">conf: {c.confidence.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {c.newVariantId && <ShortId id={c.newVariantId} />}
                  {!c.formatValid && (
                    <span className="text-[var(--status-warning)]" title={c.formatIssues?.join(', ')}>
                      format issues
                    </span>
                  )}
                </div>
              </div>
              <div className="text-[var(--text-muted)] mt-1">
                <span className="font-ui">{c.target.source}:</span>{' '}
                {c.target.dimension && <span className="font-mono">{c.target.dimension}</span>}
                {c.target.score !== undefined && <span className="font-mono"> ({c.target.score.toFixed(1)})</span>}
                {' — '}{c.target.description}
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
      {detail.finalCritique && (
        <DetailSection title="Final Critique">
          <DimensionScores scores={detail.finalCritique.dimensionScores} />
        </DetailSection>
      )}
      <div className="grid grid-cols-3 gap-4">
        <Metric label="Consecutive Rejections" value={detail.consecutiveRejections} />
        <Metric label="Max Cycles" value={detail.config.maxCycles} />
        <Metric label="Cost" value={<CostDisplay cost={detail.totalCost} />} />
      </div>
    </div>
  );
}
