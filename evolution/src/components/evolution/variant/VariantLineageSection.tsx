// Displays full ancestor chain (root → leaf) with inline TextDiff between consecutive hops
// and a From/To node-picker for arbitrary-pair diffs. Uses the recursive RPC
// get_variant_full_chain for cycle-safe walk.
//
// Also renders children separately for navigational context.

'use client';

import { useEffect, useMemo, useState } from 'react';

import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatElo, formatEloWithUncertainty } from '@evolution/lib/utils/formatters';
import {
  getVariantChildrenAction,
  getVariantFullChainAction,
  type VariantChainNode,
  type VariantRelative,
} from '@evolution/services/variantDetailActions';
import Link from 'next/link';
import { TextDiff } from '@evolution/components/evolution/visualizations/TextDiff';
import { VariantParentBadge } from './VariantParentBadge';
import { bootstrapDeltaCI } from '@evolution/lib/shared/ratingDelta';

interface VariantLineageSectionProps {
  variantId: string;
}

export function VariantLineageSection({ variantId }: VariantLineageSectionProps): JSX.Element {
  const [children, setChildren] = useState<VariantRelative[]>([]);
  const [chain, setChain] = useState<VariantChainNode[]>([]);
  const [loading, setLoading] = useState(true);
  // Defaults for arbitrary-pair picker: root = index 0 (earliest), leaf = last (this variant).
  const [fromIdx, setFromIdx] = useState<number | null>(null);
  const [toIdx, setToIdx] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      getVariantChildrenAction(variantId),
      getVariantFullChainAction(variantId),
    ]).then(([cRes, chRes]) => {
      if (cRes.success && cRes.data) setChildren(cRes.data);
      if (chRes.success && chRes.data) {
        setChain(chRes.data);
        if (chRes.data.length >= 2) {
          setFromIdx(0);
          setToIdx(chRes.data.length - 1);
        }
      }
      setLoading(false);
    }).catch(() => { setLoading(false); });
  }, [variantId]);

  const chainTruncated = chain.length >= 20 && chain[0]?.parentVariantId != null;

  const pickerDiff = useMemo(() => {
    if (fromIdx == null || toIdx == null || fromIdx === toIdx) return null;
    const fromNode = chain[fromIdx];
    const toNode = chain[toIdx];
    if (!fromNode || !toNode) return null;
    const childRating = { elo: toNode.eloScore, uncertainty: toNode.uncertainty ?? 0 };
    const parentRating = { elo: fromNode.eloScore, uncertainty: fromNode.uncertainty ?? 0 };
    const { delta, ci } = bootstrapDeltaCI(childRating, parentRating);
    return { fromNode, toNode, delta, ci };
  }, [chain, fromIdx, toIdx]);

  if (loading) {
    return <div className="h-32 bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  }

  const hasData = chain.length > 0 || children.length > 0;
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
      className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-6 space-y-6"
      data-testid="variant-lineage-section"
    >
      <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">Lineage</h2>

      {chainTruncated && (
        <div className="text-xs font-ui text-[var(--status-warning)]" data-testid="chain-truncation-banner">
          Chain truncated at 20 hops — older ancestors not shown.
        </div>
      )}

      {chain.length > 0 && (
        <div data-testid="lineage-full-chain">
          <h3 className="text-xl font-display font-medium text-[var(--text-muted)] uppercase mb-3">Full chain (root → leaf)</h3>
          <div className="space-y-4">
            {chain.map((node, i) => {
              const parent = i > 0 ? chain[i - 1] : null;
              const nodeRating = { elo: node.eloScore, uncertainty: node.uncertainty ?? 0 };
              const parentRating = parent ? { elo: parent.eloScore, uncertainty: parent.uncertainty ?? 0 } : null;
              const deltaResult = parentRating ? bootstrapDeltaCI(nodeRating, parentRating) : null;
              return (
                <div key={node.id} className="space-y-2">
                  {parent && (
                    <div className="pl-4 text-xs font-ui text-[var(--text-secondary)]" data-testid="chain-hop-delta">
                      ↓ {node.agentName || 'variant'} · Δ {deltaResult?.delta != null
                        ? (deltaResult.delta > 0 ? `+${Math.round(deltaResult.delta)}` : String(Math.round(deltaResult.delta)))
                        : '—'}
                      {deltaResult?.ci && (
                        <span className="ml-1">
                          [{deltaResult.ci[0] >= 0 ? `+${Math.round(deltaResult.ci[0])}` : String(Math.round(deltaResult.ci[0]))},
                          {' '}
                          {deltaResult.ci[1] >= 0 ? `+${Math.round(deltaResult.ci[1])}` : String(Math.round(deltaResult.ci[1]))}]
                        </span>
                      )}
                    </div>
                  )}
                  {parent && (
                    <details className="pl-4">
                      <summary className="cursor-pointer text-xs font-ui text-[var(--text-muted)] hover:text-[var(--accent-gold)]">
                        Show text diff
                      </summary>
                      <div className="mt-2">
                        <TextDiff original={parent.variantContent} modified={node.variantContent} />
                      </div>
                    </details>
                  )}
                  <ChainNodeCard node={node} isLeaf={i === chain.length - 1} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {chain.length >= 2 && (
        <div data-testid="lineage-pair-picker" className="border-t border-[var(--border-default)] pt-4">
          <h3 className="text-xl font-display font-medium text-[var(--text-muted)] uppercase mb-3">
            Compare any two in this chain
          </h3>
          <div className="flex flex-wrap items-end gap-3 text-sm font-ui">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--text-muted)]">From</span>
              <select
                className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded px-2 py-1 text-xs font-mono"
                value={fromIdx ?? ''}
                onChange={(e) => setFromIdx(e.target.value === '' ? null : Number(e.target.value))}
                data-testid="pair-picker-from"
              >
                {chain.map((n, i) => (
                  <option key={n.id} value={i}>
                    #{n.id.substring(0, 8)} · gen {n.generation} · {formatElo(n.eloScore)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--text-muted)]">To</span>
              <select
                className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded px-2 py-1 text-xs font-mono"
                value={toIdx ?? ''}
                onChange={(e) => setToIdx(e.target.value === '' ? null : Number(e.target.value))}
                data-testid="pair-picker-to"
              >
                {chain.map((n, i) => (
                  <option key={n.id} value={i}>
                    #{n.id.substring(0, 8)} · gen {n.generation} · {formatElo(n.eloScore)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {pickerDiff && (
            <div className="mt-4 space-y-3">
              <VariantParentBadge
                parentId={pickerDiff.fromNode.id}
                parentElo={pickerDiff.fromNode.eloScore}
                parentUncertainty={pickerDiff.fromNode.uncertainty ?? null}
                delta={pickerDiff.delta}
                deltaCi={pickerDiff.ci}
                role="from"
              />
              <TextDiff
                original={pickerDiff.fromNode.variantContent}
                modified={pickerDiff.toNode.variantContent}
              />
            </div>
          )}
        </div>
      )}

      {children.length > 0 && (
        <div className="border-t border-[var(--border-default)] pt-4">
          <h3 className="text-xl font-display font-medium text-[var(--text-muted)] uppercase mb-2">
            Children ({children.length})
          </h3>
          <div className="space-y-2">
            {children.map(c => <RelativeCard key={c.id} relative={c} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ChainNodeCard({ node, isLeaf }: { node: VariantChainNode; isLeaf: boolean }): JSX.Element {
  const eloLabel = node.uncertainty != null
    ? (formatEloWithUncertainty(node.eloScore, node.uncertainty) ?? formatElo(node.eloScore))
    : formatElo(node.eloScore);
  return (
    <Link
      href={buildVariantDetailUrl(node.id)}
      className="block border border-[var(--border-default)] rounded bg-[var(--surface-secondary)] p-3 hover:bg-[var(--surface-elevated)] transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-[var(--accent-gold)]">#{node.id.substring(0, 8)}</span>
          <span className="text-xs text-[var(--text-muted)]">gen {node.generation}</span>
          <span className="text-xs text-[var(--text-muted)]">{node.agentName || '—'}</span>
          {isLeaf && <span className="text-xs font-medium text-[var(--accent-gold)]">[you]</span>}
        </div>
        <span className="text-sm font-semibold text-[var(--text-primary)]">{eloLabel}</span>
      </div>
    </Link>
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
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {relative.uncertainty != null
            ? (formatEloWithUncertainty(relative.eloScore, relative.uncertainty) ?? formatElo(relative.eloScore))
            : formatElo(relative.eloScore)}
        </span>
      </div>
      {relative.preview && (
        <p className="text-xs text-[var(--text-muted)] mt-1 truncate">{relative.preview}</p>
      )}
    </Link>
  );
}
