// Detail view for DebateAgent showing adversarial transcript, judge verdict, and synthesis outcome.

import type { DebateExecutionDetail } from '@evolution/lib/types';
import { StatusBadge, DetailSection, CostDisplay, ShortId } from './shared';
import { AgentErrorBlock } from './AgentErrorBlock';

export function DebateDetail({ detail, runId }: { detail: DebateExecutionDetail; runId?: string }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="debate-detail">
      <div className="flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-ui text-[var(--text-muted)]">A:</span>
          <ShortId id={detail.variantA.id} runId={runId} />
          <span className="font-mono text-[var(--text-muted)]">#{detail.variantA.ordinal}</span>
        </div>
        <span className="text-[var(--text-muted)]">vs</span>
        <div className="flex items-center gap-1.5">
          <span className="font-ui text-[var(--text-muted)]">B:</span>
          <ShortId id={detail.variantB.id} runId={runId} />
          <span className="font-mono text-[var(--text-muted)]">#{detail.variantB.ordinal}</span>
        </div>
        {detail.failurePoint && <StatusBadge status={`failed:${detail.failurePoint}`} />}
      </div>
      <DetailSection title={`Transcript (${detail.transcript.length} turns)`}>
        <div className="space-y-1.5">
          {detail.transcript.map((t, i) => (
            <div key={i} className="px-3 py-2 bg-[var(--surface-elevated)] rounded-page text-xs">
              <span className="font-ui font-medium text-[var(--text-secondary)] mr-2">{t.role}</span>
              <span className="text-[var(--text-muted)] font-body line-clamp-2">{t.content}</span>
            </div>
          ))}
        </div>
      </DetailSection>
      {detail.judgeVerdict && (
        <DetailSection title="Judge Verdict">
          <div className="px-3 py-2 bg-[var(--surface-elevated)] rounded-page text-xs space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-ui text-[var(--text-secondary)]">Winner:</span>
              <StatusBadge status={detail.judgeVerdict.winner} />
            </div>
            <div className="text-[var(--text-muted)] font-body">{detail.judgeVerdict.reasoning}</div>
            {detail.judgeVerdict.strengthsFromA.length > 0 && (
              <div>
                <span className="font-ui text-[var(--text-secondary)]">Strengths from A: </span>
                <span className="text-[var(--text-muted)]">{detail.judgeVerdict.strengthsFromA.join('; ')}</span>
              </div>
            )}
            {detail.judgeVerdict.strengthsFromB.length > 0 && (
              <div>
                <span className="font-ui text-[var(--text-secondary)]">Strengths from B: </span>
                <span className="text-[var(--text-muted)]">{detail.judgeVerdict.strengthsFromB.join('; ')}</span>
              </div>
            )}
          </div>
        </DetailSection>
      )}
      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] font-ui">
        {detail.synthesisVariantId && (
          <span>Synthesis: <ShortId id={detail.synthesisVariantId} runId={runId} /> ({detail.synthesisTextLength} chars)</span>
        )}
        {detail.formatValid === false && detail.formatIssues && detail.formatIssues.length > 0 && (
          <AgentErrorBlock error="Format issues" formatIssues={detail.formatIssues} />
        )}
        <span>Cost: <CostDisplay cost={detail.totalCost} /></span>
      </div>
    </div>
  );
}
