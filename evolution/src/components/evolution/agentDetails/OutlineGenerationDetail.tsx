// Detail view for OutlineGenerationAgent showing pipeline step metrics and weakest step.

import type { OutlineGenerationExecutionDetail } from '@evolution/lib/types';
import type { AgentDetailEnrichment } from './AgentExecutionDetailView';
import { formatScore } from '@evolution/lib/utils/formatters';
import { StatusBadge, DetailSection, CostDisplay, ShortId, Metric } from './shared';

export function OutlineGenerationDetail({ detail, runId }: { detail: OutlineGenerationExecutionDetail; runId?: string; enrichment?: AgentDetailEnrichment }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="outline-generation-detail">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-ui text-[var(--text-muted)]">Variant:</span>
        <ShortId id={detail.variantId} runId={runId} />
        {detail.weakestStep && (
          <span className="text-[var(--status-warning)] font-ui">
            weakest: <span className="font-mono">{detail.weakestStep}</span>
          </span>
        )}
      </div>
      <DetailSection title="Pipeline Steps">
        <div className="space-y-1.5">
          {detail.steps.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between px-3 py-2 bg-[var(--surface-elevated)] rounded-page text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[var(--text-secondary)]">{s.name}</span>
                {s.name === detail.weakestStep && <StatusBadge status="weakest" />}
              </div>
              <div className="flex items-center gap-3 text-[var(--text-muted)] font-mono">
                <span>score: {formatScore(s.score)}</span>
                <span>{s.inputLength}→{s.outputLength}</span>
                <CostDisplay cost={s.costUsd} />
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
      <Metric label="Total Cost" value={<CostDisplay cost={detail.totalCost} />} />
    </div>
  );
}
