// Detail view for EvolutionAgent (evolvePool) showing mutation results and creative exploration state.

import type { EvolutionExecutionDetail } from '@/lib/evolution/types';
import { StatusBadge, DetailSection, CostDisplay, ShortId } from './shared';
import { AgentErrorBlock } from './AgentErrorBlock';

export function EvolutionDetail({ detail, runId }: { detail: EvolutionExecutionDetail; runId?: string }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="evolution-detail">
      <div className="flex items-center gap-3 text-xs">
        {detail.creativeExploration && (
          <StatusBadge status={`creative:${detail.creativeReason ?? 'unknown'}`} />
        )}
        {detail.feedbackUsed && <span className="text-[var(--text-muted)] font-ui">Feedback used</span>}
      </div>
      <DetailSection title="Parents">
        <div className="flex flex-wrap gap-2">
          {detail.parents.map((p, i) => (
            <div key={i} className="flex items-center gap-1 text-xs">
              <ShortId id={p.id} runId={runId} />
              <span className="font-mono text-[var(--text-muted)]">#{p.ordinal}</span>
            </div>
          ))}
        </div>
      </DetailSection>
      <DetailSection title="Mutations">
        <div className="space-y-1.5">
          {detail.mutations.map((m, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-3 py-1.5 bg-[var(--surface-elevated)] rounded-page text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[var(--text-secondary)]">{m.strategy}</span>
                <StatusBadge status={m.status} />
              </div>
              <div className="flex items-center gap-3 text-[var(--text-muted)]">
                {m.variantId && <ShortId id={m.variantId} runId={runId} />}
                {m.textLength !== undefined && <span>{m.textLength} chars</span>}
                {m.error && <AgentErrorBlock error={m.error} />}
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
      {detail.overrepresentedStrategies && detail.overrepresentedStrategies.length > 0 && (
        <div className="text-xs text-[var(--text-muted)] font-ui">
          Overrepresented: {detail.overrepresentedStrategies.join(', ')}
        </div>
      )}
      <div className="text-xs text-[var(--text-muted)] font-ui">
        Cost: <CostDisplay cost={detail.totalCost} />
      </div>
    </div>
  );
}
