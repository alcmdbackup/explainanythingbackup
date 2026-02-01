'use client';
// Sortable variants table with Elo sparklines, strategy filtering, and text expansion.
// Displays all variants from an evolution run ranked by Elo score.

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { EloSparkline } from '@/components/evolution';
import {
  getEvolutionVariantsAction,
  type EvolutionVariant,
} from '@/lib/services/evolutionActions';
import {
  getEvolutionRunEloHistoryAction,
  type EloHistoryData,
} from '@/lib/services/evolutionVisualizationActions';

export function VariantsTab({ runId }: { runId: string }) {
  const [variants, setVariants] = useState<EvolutionVariant[]>([]);
  const [eloHistory, setEloHistory] = useState<EloHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [strategyFilter, setStrategyFilter] = useState<string>('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [varResult, eloResult] = await Promise.all([
        getEvolutionVariantsAction(runId),
        getEvolutionRunEloHistoryAction(runId),
      ]);
      if (varResult.success && varResult.data) {
        setVariants(varResult.data);
      } else {
        setError(varResult.error?.message ?? 'Failed to load variants');
      }
      if (eloResult.success && eloResult.data) {
        setEloHistory(eloResult.data);
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  // Build sparkline data per variant from Elo history
  const sparklineMap = useMemo(() => {
    const map = new Map<string, { iteration: number; elo: number }[]>();
    if (!eloHistory) return map;
    // Match DB variants to in-memory IDs by strategy + position
    // Since DB and in-memory IDs don't match, sparklines use in-memory history
    for (const v of eloHistory.variants) {
      const points: { iteration: number; elo: number }[] = [];
      for (const h of eloHistory.history) {
        if (h.ratings[v.id] !== undefined) {
          points.push({ iteration: h.iteration, elo: h.ratings[v.id] });
        }
      }
      map.set(v.shortId, points);
    }
    return map;
  }, [eloHistory]);

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
      {/* Filters */}
      <div className="flex items-center justify-between">
        <select
          value={strategyFilter}
          onChange={e => setStrategyFilter(e.target.value)}
          className="px-3 py-1.5 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)] text-xs"
        >
          <option value="">All strategies</option>
          {strategies.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <Link
          href={`/admin/quality/evolution/run/${runId}/compare`}
          className="text-xs text-[var(--accent-gold)] hover:underline"
        >
          Full Compare
        </Link>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-[var(--border-default)] rounded-book">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <th className="p-3 text-left">Rank</th>
              <th className="p-3 text-left">ID</th>
              <th className="p-3 text-right">Elo</th>
              <th className="p-3 text-center">Trend</th>
              <th className="p-3 text-right">Matches</th>
              <th className="p-3 text-left">Strategy</th>
              <th className="p-3 text-right">Gen</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v, i) => (
              <>
                <tr
                  key={v.id}
                  className={`border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)] ${v.is_winner ? 'bg-[var(--status-success)]/5' : ''}`}
                >
                  <td className="p-3 text-[var(--text-muted)]">
                    #{i + 1}
                    {v.is_winner && <span className="ml-1 text-[var(--accent-gold)]">&#9733;</span>}
                  </td>
                  <td className="p-3 font-mono text-xs text-[var(--text-muted)]">{v.id.substring(0, 8)}</td>
                  <td className="p-3 text-right font-semibold">{Math.round(v.elo_score)}</td>
                  <td className="p-3 text-center">
                    <EloSparkline data={sparklineMap.get(v.id.substring(0, 8)) ?? []} />
                  </td>
                  <td className="p-3 text-right text-[var(--text-muted)]">{v.match_count}</td>
                  <td className="p-3 font-mono text-xs">{v.agent_name}</td>
                  <td className="p-3 text-right text-[var(--text-muted)]">{v.generation}</td>
                  <td className="p-3">
                    <button
                      onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}
                      className="text-[var(--accent-gold)] hover:underline text-xs"
                    >
                      {expandedId === v.id ? 'Hide' : 'View'}
                    </button>
                  </td>
                </tr>
                {expandedId === v.id && (
                  <tr key={`${v.id}-text`}>
                    <td colSpan={8} className="p-4 bg-[var(--surface-secondary)]">
                      <pre className="whitespace-pre-wrap text-xs text-[var(--text-secondary)] max-h-64 overflow-y-auto">
                        {v.variant_content}
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
