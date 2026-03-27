'use client';
// Sortable variants table with strategy filtering and text expansion.
// Displays all variants from an evolution run ranked by Elo score (V2 schema).

import { Fragment, useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import {
  getEvolutionVariantsAction,
  type EvolutionVariant,
} from '@evolution/services/evolutionActions';
import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';

interface VariantsTabProps {
  runId: string;
  runStatus?: string;
}

export function VariantsTab({ runId, runStatus }: VariantsTabProps): JSX.Element {
  const searchParams = useSearchParams();
  const initialVariant = searchParams.get('variant');
  const [variants, setVariants] = useState<EvolutionVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [strategyFilter, setStrategyFilter] = useState<string>('');
  const initialVariantApplied = useRef(false);

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true);
      const result = await getEvolutionVariantsAction(runId);
      if (result.success && result.data) {
        setVariants(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load variants');
      }
      setLoading(false);
    }
    load();
  }, [runId]);

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

  const filtered = useMemo(() => {
    if (!strategyFilter) return variants;
    return variants.filter(v => v.agent_name === strategyFilter);
  }, [variants, strategyFilter]);

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
      {runStatus === 'failed' && (
        <div className="rounded-book border border-[var(--status-warning)] bg-[var(--status-warning)]/10 p-3 text-sm font-ui text-[var(--status-warning)]">
          This run failed. Variant data may be incomplete or from a partial execution.
        </div>
      )}
      <div className="flex items-center justify-between relative z-10">
        <select
          value={strategyFilter}
          onChange={e => setStrategyFilter(e.target.value)}
          className="px-3 py-1.5 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)] text-xs"
        >
          <option value="">All strategies</option>
          {strategies.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto border border-[var(--border-default)] rounded-book">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <th className="px-2 py-2 text-left">Rank</th>
              <th className="px-2 py-2 text-right">Rating</th>
              <th className="px-2 py-2 text-right">Matches</th>
              <th className="px-2 py-2 text-left">Strategy</th>
              <th className="px-2 py-2 text-right">Gen</th>
              <th className="px-2 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v, i) => (
              <Fragment key={v.id}>
                <tr
                  className={`border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)] ${v.is_winner ? 'bg-[var(--status-success)]/5' : ''}`}
                >
                  <td className="px-2 py-2 text-[var(--text-muted)]">
                    <span className="cursor-pointer" title={v.id} onClick={() => setExpandedIds(prev => { const next = new Set(prev); if (next.has(v.id)) next.delete(v.id); else next.add(v.id); return next; })}>
                      #{i + 1}
                      {v.is_winner && <span className="ml-1 text-[var(--accent-gold)]">&#9733;</span>}
                      <span className="ml-1 font-mono text-xs text-[var(--accent-gold)]">{v.id.substring(0, 6)}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right font-semibold">{Math.round(v.elo_score)}</td>
                  <td className="px-2 py-2 text-right text-[var(--text-muted)]">{v.match_count}</td>
                  <td className="px-2 py-2 font-mono text-xs">{v.agent_name || '—'}</td>
                  <td className="px-2 py-2 text-right text-[var(--text-muted)]">{v.generation}</td>
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
                    <td colSpan={6} className="p-4 bg-[var(--surface-secondary)]">
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
