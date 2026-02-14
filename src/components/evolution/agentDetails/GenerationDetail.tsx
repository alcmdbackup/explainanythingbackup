// Detail view for GenerationAgent showing per-strategy results with status badges.

import type { GenerationExecutionDetail } from '@/lib/evolution/types';
import { StatusBadge, DetailSection, CostDisplay, ShortId } from './shared';

export function GenerationDetail({ detail }: { detail: GenerationExecutionDetail }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="generation-detail">
      <DetailSection title="Strategies">
        <div className="space-y-2">
          {detail.strategies.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-3 py-2 bg-[var(--surface-elevated)] rounded-page text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[var(--text-secondary)]">{s.name}</span>
                <StatusBadge status={s.status} />
              </div>
              <div className="flex items-center gap-3 text-[var(--text-muted)]">
                {s.variantId && <ShortId id={s.variantId} />}
                {s.textLength !== undefined && <span>{s.textLength} chars</span>}
                {s.error && <span className="text-[var(--status-error)]" title={s.error}>error</span>}
                {s.formatIssues && s.formatIssues.length > 0 && (
                  <span className="text-[var(--status-warning)]" title={s.formatIssues.join(', ')}>
                    {s.formatIssues.length} format issue{s.formatIssues.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] font-ui">
        <span>Feedback: {detail.feedbackUsed ? 'Used' : 'None'}</span>
        <span>Cost: <CostDisplay cost={detail.totalCost} /></span>
      </div>
    </div>
  );
}
