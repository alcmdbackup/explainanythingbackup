// Detail view for TreeSearchAgent showing beam search config, tree stats, and revision path.

import type { TreeSearchExecutionDetail } from '@/lib/evolution/types';
import { StatusBadge, DetailSection, CostDisplay, ShortId, Metric } from './shared';

export function TreeSearchDetail({ detail }: { detail: TreeSearchExecutionDetail }): JSX.Element {
  return (
    <div className="space-y-3" data-testid="tree-search-detail">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-ui text-[var(--text-muted)]">Root:</span>
        <ShortId id={detail.rootVariantId} />
        {detail.bestLeafVariantId && (
          <>
            <span className="text-[var(--text-muted)]">→</span>
            <span className="font-ui text-[var(--text-muted)]">Best:</span>
            <ShortId id={detail.bestLeafVariantId} />
          </>
        )}
        <StatusBadge status={detail.addedToPool ? 'added' : 'not_added'} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Metric label="Tree Size" value={detail.result.treeSize} />
        <Metric label="Max Depth" value={detail.result.maxDepth} />
        <Metric label="Pruned" value={detail.result.prunedBranches} />
        <Metric label="Cost" value={<CostDisplay cost={detail.totalCost} />} />
      </div>
      <DetailSection title="Config">
        <div className="flex gap-4 text-xs text-[var(--text-muted)] font-mono">
          <span>beam={detail.config.beamWidth}</span>
          <span>branch={detail.config.branchingFactor}</span>
          <span>depth={detail.config.maxDepth}</span>
        </div>
      </DetailSection>
      {detail.result.revisionPath.length > 0 && (
        <DetailSection title="Revision Path">
          <div className="space-y-1">
            {detail.result.revisionPath.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs px-3 py-1 bg-[var(--surface-elevated)] rounded-page">
                <span className="font-mono text-[var(--text-secondary)]">{r.type}</span>
                {r.dimension && <span className="text-[var(--text-muted)]">{r.dimension}</span>}
                <span className="text-[var(--text-muted)] font-body truncate">{r.description}</span>
              </div>
            ))}
          </div>
        </DetailSection>
      )}
    </div>
  );
}
