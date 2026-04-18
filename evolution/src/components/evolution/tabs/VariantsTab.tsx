'use client';
// Sortable variants table with tactic filtering and text expansion.
// Displays all variants from an evolution run (runId) or tactic (strategyId — all runs
// of that tactic) ranked by Elo score. Renders Elo with 95% CI via formatEloWithUncertainty
// and formatEloCIRange (Phase 4b: per-variant Elo CI everywhere).

import { Fragment, useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import {
  getEvolutionVariantsAction,
  type EvolutionVariant,
} from '@evolution/services/evolutionActions';
import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatEloWithUncertainty, formatEloCIRange } from '@evolution/lib/utils/formatters';
import { dbToRating } from '@evolution/lib/shared/computeRatings';

/** Extended variant type with optional parent_variant_id for display. */
interface VariantWithParent extends EvolutionVariant {
  parent_variant_id?: string | null;
}

interface VariantsTabProps {
  /** When set, load variants for a single run (original behavior). */
  runId?: string;
  /** When set (and runId is not), load variants across all runs of the given strategy. Phase 4c. */
  strategyId?: string;
  runStatus?: string;
}

/** Compute Elo-scale uncertainty from the DB mu/sigma columns, or null when either is missing
 *  (legacy variant rows that predate the mu/sigma select — display bare Elo in that case). */
function variantUncertainty(v: EvolutionVariant): number | null {
  if (v.mu == null || v.sigma == null) return null;
  return dbToRating(v.mu, v.sigma).uncertainty;
}

export function VariantsTab({ runId, strategyId, runStatus }: VariantsTabProps): JSX.Element {
  if (!runId && !strategyId) {
    throw new Error('VariantsTab: must specify runId or strategyId');
  }
  const searchParams = useSearchParams();
  const initialVariant = searchParams.get('variant');
  const [variants, setVariants] = useState<VariantWithParent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [strategyFilter, setStrategyFilter] = useState<string>('');
  const [iterationFilter, setIterationFilter] = useState<string>('');
  const [includeDiscarded, setIncludeDiscarded] = useState(false);
  const initialVariantApplied = useRef(false);

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true);
      const result = await getEvolutionVariantsAction(
        runId ? { runId, includeDiscarded } : { strategyId, includeDiscarded },
      );
      if (result.success && result.data) {
        setVariants(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load variants');
      }
      setLoading(false);
    }
    load();
  }, [runId, strategyId, includeDiscarded]);

  useEffect(() => {
    if (!initialVariant || loading || initialVariantApplied.current || variants.length === 0) return;
    initialVariantApplied.current = true;
    const match = variants.find(v => v.id === initialVariant || v.id.startsWith(initialVariant));
    if (match) setExpandedIds(new Set([match.id]));
  }, [initialVariant, loading, variants]);

  const strategies = useMemo(() => {
    const set = new Set(variants.map(v => v.agent_name).filter(Boolean));
    return Array.from(set).sort();
  }, [variants]);

  const iterations = useMemo(() => {
    const set = new Set(variants.map(v => v.generation));
    return Array.from(set).sort((a, b) => a - b);
  }, [variants]);

  // Pre-compute rank map from unfiltered (sorted) list so ranks stay stable when filtering
  const rankMap = useMemo(() => {
    const map = new Map<string, number>();
    variants.forEach((v, i) => map.set(v.id, i + 1));
    return map;
  }, [variants]);

  const filtered = useMemo(() => {
    let result = variants;
    if (strategyFilter) result = result.filter(v => v.agent_name === strategyFilter);
    if (iterationFilter) result = result.filter(v => String(v.generation) === iterationFilter);
    return result;
  }, [variants, strategyFilter, iterationFilter]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 bg-[var(--surface-elevated)] rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;

  return (
    <div className="space-y-4" data-testid="variants-tab">
      {runId && runStatus === 'failed' && (
        <div className="rounded-book border border-[var(--status-warning)] bg-[var(--status-warning)]/10 p-3 text-sm font-ui text-[var(--status-warning)]">
          This run failed. Variant data may be incomplete or from a partial execution.
        </div>
      )}
      <div className="flex items-center justify-between relative z-10 gap-3">
        <div className="flex items-center gap-2">
          <select
            value={strategyFilter}
            onChange={e => setStrategyFilter(e.target.value)}
            className="px-3 py-1.5 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)] text-xs"
          >
            <option value="">All tactics</option>
            {strategies.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={iterationFilter}
            onChange={e => setIterationFilter(e.target.value)}
            className="px-3 py-1.5 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)] text-xs"
            data-testid="iteration-filter"
          >
            <option value="">All iterations</option>
            {iterations.map(i => <option key={i} value={String(i)}>Iteration {i}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs font-ui text-[var(--text-secondary)] cursor-pointer" data-testid="include-discarded-toggle">
          <input
            type="checkbox"
            checked={includeDiscarded}
            onChange={e => setIncludeDiscarded(e.target.checked)}
            className="cursor-pointer"
          />
          Include discarded variants
        </label>
      </div>

      <div className="overflow-x-auto border border-[var(--border-default)] rounded-book">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <th className="px-2 py-2 text-left">Rank</th>
              <th className="px-2 py-2 text-right" title="Elo score ± uncertainty (standard deviation on the Elo scale)">Rating</th>
              <th className="px-2 py-2 text-right" title="95% confidence interval: Elo ± 1.96 × uncertainty">95% CI</th>
              <th className="px-2 py-2 text-right" title="Run-local matches only (excludes arena matches)">Matches</th>
              <th className="px-2 py-2 text-left">Tactic</th>
              <th className="px-2 py-2 text-right">Iteration</th>
              <th className="px-2 py-2 text-left">Parent</th>
              <th className="px-2 py-2 text-center" title="Persisted to final pool (false = discarded)">Persisted</th>
              <th className="px-2 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm font-ui text-[var(--text-muted)]">
                  No variants match this filter.
                </td>
              </tr>
            )}
            {filtered.map((v, i) => (
              <Fragment key={v.id}>
                <tr
                  className={`border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)] ${v.is_winner ? 'bg-[var(--status-success)]/5' : ''}`}
                >
                  <td className="px-2 py-2 text-[var(--text-muted)]">
                    <span className="cursor-pointer" title={v.id} onClick={() => setExpandedIds(prev => { const next = new Set(prev); if (next.has(v.id)) next.delete(v.id); else next.add(v.id); return next; })}>
                      #{rankMap.get(v.id) ?? i + 1}
                      {v.is_winner && <span className="mx-1 text-[var(--accent-gold)]">★</span>}
                      <span className="ml-1.5 font-mono text-xs text-[var(--accent-gold)]">{v.id.substring(0, 6)}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right font-semibold" data-testid={`rating-${v.id.substring(0, 6)}`}>
                    {(() => {
                      const u = variantUncertainty(v);
                      return u != null
                        ? (formatEloWithUncertainty(v.elo_score, u) ?? Math.round(v.elo_score))
                        : Math.round(v.elo_score);
                    })()}
                  </td>
                  <td className="px-2 py-2 text-right text-xs text-[var(--text-muted)]" data-testid={`ci-${v.id.substring(0, 6)}`}>
                    {(() => {
                      const u = variantUncertainty(v);
                      return u != null ? (formatEloCIRange(v.elo_score, u) ?? '—') : '—';
                    })()}
                  </td>
                  <td className="px-2 py-2 text-right text-[var(--text-muted)]">{v.match_count}</td>
                  <td className="px-2 py-2 font-mono text-xs">{v.agent_name || '—'}</td>
                  <td className="px-2 py-2 text-right text-[var(--text-muted)]">{v.generation}</td>
                  <td className="px-2 py-2">
                    {(v as VariantWithParent).parent_variant_id ? (
                      <Link
                        href={buildVariantDetailUrl((v as VariantWithParent).parent_variant_id!)}
                        className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
                        title={(v as VariantWithParent).parent_variant_id!}
                      >
                        {(v as VariantWithParent).parent_variant_id!.substring(0, 6)}
                      </Link>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center" data-testid={`persisted-${v.id.substring(0, 6)}`}>
                    {v.persisted === false ? (
                      <span className="text-xs font-ui text-[var(--status-error)]" title="Discarded — not in final pool">✗</span>
                    ) : (
                      <span className="text-xs font-ui text-[var(--status-success)]" title="Surfaced to final pool">✓</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <span className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedIds(prev => { const next = new Set(prev); if (next.has(v.id)) next.delete(v.id); else next.add(v.id); return next; })}
                        className="text-[var(--accent-gold)] hover:underline text-xs"
                      >
                        {expandedIds.has(v.id) ? 'Hide' : 'Preview'}
                      </button>
                      <Link
                        href={buildVariantDetailUrl(v.id)}
                        className="text-[var(--text-muted)] hover:text-[var(--accent-gold)] text-xs"
                        title="Full variant detail"
                      >
                        Detail
                      </Link>
                    </span>
                  </td>
                </tr>
                {expandedIds.has(v.id) && (
                  <tr key={`${v.id}-text`}>
                    <td colSpan={8} className="p-4 bg-[var(--surface-secondary)]">
                      <pre className="whitespace-pre-wrap text-xs text-[var(--text-secondary)] max-h-64 overflow-y-auto">
                        {v.variant_content}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
