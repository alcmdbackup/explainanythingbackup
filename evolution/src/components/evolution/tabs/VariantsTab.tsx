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
}

export function VariantsTab({ runId }: VariantsTabProps): JSX.Element {
  const searchParams = useSearchParams();
  const initialVariant = searchParams.get('variant');
  const [variants, setVariants] = useState<EvolutionVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [strategyFilter, setStrategyFilter] = useState<string>('');
  const initialVariantApplied = useRef(false);

  useEffect(() => {
    async function load() {
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
    if (match) setExpandedId(match.id);
  }, [initialVariant, loading, variants]);

  const strategies = useMemo(() => {
    const set = new Set(variants.map(v => v.agent_name));
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
                    <span className="cursor-pointer" title={v.id} onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}>
                      #{i + 1}
                      {v.is_winner && <span className="ml-1 text-[var(--accent-gold)]">&#9733;</span>}
                      <span className="ml-1 font-mono text-xs text-[var(--accent-gold)]">{v.id.substring(0, 6)}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right font-semibold">{Math.round(v.elo_score)}</td>
                  <td className="px-2 py-2 text-right text-[var(--text-muted)]">{v.match_count}</td>
                  <td className="px-2 py-2 font-mono text-xs">{v.agent_name}</td>
                  <td className="px-2 py-2 text-right text-[var(--text-muted)]">{v.generation}</td>
                  <td className="px-2 py-2">
                    <span className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}
                        className="text-[var(--accent-gold)] hover:underline text-xs"
                      >
                        {expandedId === v.id ? 'Hide' : 'View'}
                      </button>
                      <Link
                        href={buildVariantDetailUrl(v.id)}
                        className="text-[var(--text-muted)] hover:text-[var(--accent-gold)] text-xs"
                        title="Full variant detail"
                      >
                        Full
                      </Link>
                    </span>
                  </td>
                </tr>
                {expandedId === v.id && (
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
