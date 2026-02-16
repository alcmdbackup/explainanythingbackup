// Detail view for IterativeEditingAgent showing edit cycles with accept/reject verdicts.

import type { IterativeEditingExecutionDetail } from '@/lib/evolution/types';
import { formatScore, formatScore1 } from '@/lib/utils/formatters';
import { StatusBadge, DetailSection, CostDisplay, ShortId, Metric, DimensionScoresDisplay } from './shared';
import { AgentErrorBlock } from './AgentErrorBlock';

export function IterativeEditingDetail({ detail, runId }: { detail: IterativeEditingExecutionDetail; runId?: string }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="iterative-editing-detail">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-ui text-[var(--text-muted)]">Target:</span>
        <ShortId id={detail.targetVariantId} runId={runId} />
        <StatusBadge status={detail.stopReason} />
      </div>
      <DetailSection title="Initial Critique">
        <DimensionScoresDisplay scores={detail.initialCritique.dimensionScores} />
      </DetailSection>
      <DetailSection title={`Edit Cycles (${detail.cycles.length})`}>
        <div className="space-y-2">
          {detail.cycles.map((c) => (
            <div key={c.cycleNumber} className="px-3 py-2 bg-[var(--surface-elevated)] rounded-page text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-ui text-[var(--text-secondary)]">Cycle {c.cycleNumber}</span>
                  <StatusBadge status={c.verdict} />
                  <span className="text-[var(--text-muted)]">conf: {formatScore(c.confidence)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {c.newVariantId && <ShortId id={c.newVariantId} runId={runId} />}
                  {!c.formatValid && c.formatIssues && c.formatIssues.length > 0 && (
                    <AgentErrorBlock error="Format issues" formatIssues={c.formatIssues} />
                  )}
                </div>
              </div>
              <div className="text-[var(--text-muted)] mt-1">
                <span className="font-ui">{c.target.source}:</span>{' '}
                {c.target.dimension && <span className="font-mono">{c.target.dimension}</span>}
                {c.target.score !== undefined && <span className="font-mono"> ({formatScore1(c.target.score)})</span>}
                {' — '}{c.target.description}
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
      {detail.finalCritique && (
        <DetailSection title="Final Critique">
          <DimensionScoresDisplay scores={detail.finalCritique.dimensionScores} />
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
