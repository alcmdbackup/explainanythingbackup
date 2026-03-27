'use client';
// Inline variant detail panel showing parent lineage, match count, and content preview.
// V2 rewrite: uses variantDetailActions instead of checkpoint-based visualization actions.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getVariantFullDetailAction,
  getVariantParentsAction,
  type VariantFullDetail,
  type VariantRelative,
} from '@evolution/services/variantDetailActions';
import { buildRunUrl, buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';

interface VariantDetailPanelProps {
  runId: string;
  variantId: string;
  agentName?: string;
  generation?: number;
}

export function VariantDetailPanel({ runId, variantId, agentName, generation }: VariantDetailPanelProps): JSX.Element {
  const [detail, setDetail] = useState<VariantFullDetail | null>(null);
  const [parents, setParents] = useState<VariantRelative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [detailResult, parentsResult] = await Promise.all([
        getVariantFullDetailAction(variantId),
        getVariantParentsAction(variantId),
      ]);
      if (detailResult.success && detailResult.data) {
        setDetail(detailResult.data);
      } else {
        setError(detailResult.error?.message ?? 'Variant not found');
      }
      if (parentsResult.success && parentsResult.data) {
        setParents(parentsResult.data);
      }
      setLoading(false);
    }
    load();
  }, [variantId]);

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="h-4 bg-[var(--surface-elevated)] rounded w-1/3" />
        <div className="h-20 bg-[var(--surface-elevated)] rounded" />
      </div>
    );
  }

  if (error || !detail) {
    return <div className="text-xs text-[var(--text-muted)] p-2">{error ?? 'No detail available'}</div>;
  }

  const effectiveAgent = detail.agentName || agentName;
  const effectiveGen = detail.generation ?? generation;

  return (
    <div className="space-y-3 text-xs" data-testid="variant-detail-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href={buildVariantDetailUrl(detail.id)}
            className="font-mono text-[var(--accent-gold)] hover:underline"
          >
            {detail.id.substring(0, 8)}
          </Link>
          <span className="font-mono text-[var(--text-muted)]">Rating {Math.round(detail.eloScore)}</span>
          <span className="text-[var(--text-muted)]">{effectiveAgent}</span>
          <span className="text-[var(--text-muted)]">gen {effectiveGen}</span>
        </div>
        {effectiveAgent && effectiveGen !== undefined && (
          <Link
            href={buildRunUrl(runId)}
            className="text-[var(--accent-gold)] hover:underline"
          >
            View run
          </Link>
        )}
      </div>

      {/* Parent Lineage */}
      {parents.length > 0 && (
        <div data-testid="parent-lineage">
          <div className="text-[var(--text-muted)] font-ui font-medium mb-1">
            Parents ({parents.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {parents.map(p => (
              <Link
                key={p.id}
                href={buildVariantDetailUrl(p.id)}
                className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
              >
                {p.id.substring(0, 8)} (gen {p.generation}, {Math.round(p.eloScore)})
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Content Preview */}
      <div>
        <div className="text-[var(--text-muted)] font-ui font-medium mb-1">Content Preview</div>
        <pre className="whitespace-pre-wrap text-[var(--text-secondary)] max-h-64 overflow-y-auto p-2 bg-[var(--surface-elevated)] rounded-page">
          {detail.variantContent.substring(0, 1000)}
          {detail.variantContent.length > 1000 && '...'}
        </pre>
      </div>
    </div>
  );
}
