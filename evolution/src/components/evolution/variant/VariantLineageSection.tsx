// Displays parent, children, and ancestor lineage chain for a variant.
// Fetches data from server actions and renders as linked cards.

'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatElo } from '@evolution/lib/utils/formatters';
import {
  getVariantChildrenAction,
  getVariantLineageChainAction,
  getVariantParentsAction,
  type LineageEntry,
  type VariantRelative,
} from '@evolution/services/variantDetailActions';

interface VariantLineageSectionProps {
  variantId: string;
}

export function VariantLineageSection({ variantId }: VariantLineageSectionProps): JSX.Element {
  const [parents, setParents] = useState<VariantRelative[]>([]);
  const [children, setChildren] = useState<VariantRelative[]>([]);
  const [lineage, setLineage] = useState<LineageEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getVariantParentsAction(variantId),
      getVariantChildrenAction(variantId),
      getVariantLineageChainAction(variantId),
    ]).then(([pRes, cRes, lRes]) => {
      if (pRes.success && pRes.data) setParents(pRes.data);
      if (cRes.success && cRes.data) setChildren(cRes.data);
      if (lRes.success && lRes.data) setLineage(lRes.data);
      setLoading(false);
    }).catch(() => { setLoading(false); });
  }, [variantId]);

  if (loading) {
    return <div className="h-32 bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  }

  const hasData = parents.length > 0 || children.length > 0 || lineage.length > 0;

  if (!hasData) {
    return (
      <div className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-6" data-testid="variant-lineage-section">
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)] mb-2">Lineage</h2>
        <p className="text-sm text-[var(--text-muted)]">This variant has no parent or child relationships.</p>
      </div>
    );
  }

  return (
    <div
      className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-6 space-y-4"
      data-testid="variant-lineage-section"
    >
      <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">Lineage</h2>

      {parents.length > 0 && (
        <div>
          <h3 className="text-xl font-display font-medium text-[var(--text-muted)] uppercase mb-2">Parent</h3>
          <div className="space-y-2">
            {parents.map(p => <RelativeCard key={p.id} relative={p} />)}
          </div>
        </div>
      )}

      {children.length > 0 && (
        <div>
          <h3 className="text-xl font-display font-medium text-[var(--text-muted)] uppercase mb-2">Children ({children.length})</h3>
          <div className="space-y-2">
            {children.map(c => <RelativeCard key={c.id} relative={c} />)}
          </div>
        </div>
      )}

      {lineage.length > 0 && (
        <div>
          <h3 className="text-xl font-display font-medium text-[var(--text-muted)] uppercase mb-2">Ancestor Chain</h3>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {lineage.map((ancestor, i) => (
              <div key={ancestor.id} className="flex items-center gap-2 shrink-0">
                {i > 0 && <span className="text-[var(--text-muted)]">&larr;</span>}
                <Link
                  href={buildVariantDetailUrl(ancestor.id)}
                  className="px-2 py-1 border border-[var(--border-default)] rounded bg-[var(--surface-secondary)] text-xs hover:bg-[var(--surface-elevated)] transition-colors"
                  title={ancestor.preview}
                >
                  <span className="font-mono text-[var(--accent-gold)]">{ancestor.id.substring(0, 8)}</span>
                  <span className="ml-2 text-[var(--text-muted)]">Gen {ancestor.generation}</span>
                  <span className="ml-2 text-[var(--text-secondary)]">{formatElo(ancestor.eloScore)}</span>
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RelativeCard({ relative }: { relative: VariantRelative }): JSX.Element {
  return (
    <Link
      href={buildVariantDetailUrl(relative.id)}
      className="block border border-[var(--border-default)] rounded bg-[var(--surface-secondary)] p-3 hover:bg-[var(--surface-elevated)] transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-[var(--accent-gold)]">{relative.id.substring(0, 8)}</span>
          <span className="font-mono text-xs text-[var(--text-muted)]">{relative.agentName}</span>
          <span className="text-xs text-[var(--text-muted)]">Gen {relative.generation}</span>
          {relative.isWinner && <span className="text-[var(--status-success)]" title="Winner">★</span>}
        </div>
        <span className="text-sm font-semibold text-[var(--text-primary)]">{formatElo(relative.eloScore)}</span>
      </div>
      {relative.preview && (
        <p className="text-xs text-[var(--text-muted)] mt-1 truncate">{relative.preview}</p>
      )}
    </Link>
  );
}
