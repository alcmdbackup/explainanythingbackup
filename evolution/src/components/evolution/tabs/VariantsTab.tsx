'use client';
// Sortable variants table with Elo sparklines, strategy filtering, and text expansion.
// Displays all variants from an evolution run ranked by Elo score.

import { Fragment, useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { EloSparkline } from '@evolution/components/evolution';
import { StepScoreBar } from '@evolution/components/evolution/StepScoreBar';

import {
  getEvolutionVariantsAction,
  type EvolutionVariant,
} from '@evolution/services/evolutionActions';
import { VariantDetailPanel } from '@evolution/components/evolution/VariantDetailPanel';
import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';
import { AttributionBadge } from '@evolution/components/evolution/AttributionBadge';
import {
  getEvolutionRunEloHistoryAction,
  getEvolutionRunStepScoresAction,
  type EloHistoryData,
  type VariantStepData,
} from '@evolution/services/evolutionVisualizationActions';

interface VariantsTabProps {
  runId: string;
}

export function VariantsTab({ runId }: VariantsTabProps): JSX.Element {
  const searchParams = useSearchParams();
  const initialVariant = searchParams.get('variant');
  const [variants, setVariants] = useState<EvolutionVariant[]>([]);
  const [eloHistory, setEloHistory] = useState<EloHistoryData | null>(null);
  const [stepScores, setStepScores] = useState<Map<string, VariantStepData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailPanelId, setDetailPanelId] = useState<string | null>(null);
  const [strategyFilter, setStrategyFilter] = useState<string>('');
  const initialVariantApplied = useRef(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [varResult, eloResult, stepResult] = await Promise.all([
        getEvolutionVariantsAction(runId),
        getEvolutionRunEloHistoryAction(runId),
        getEvolutionRunStepScoresAction(runId),
      ]);
      if (varResult.success && varResult.data) {
        setVariants(varResult.data);
      } else {
        setError(varResult.error?.message ?? 'Failed to load variants');
      }
      if (eloResult.success && eloResult.data) {
        setEloHistory(eloResult.data);
      }
      if (stepResult.success && stepResult.data) {
        const map = new Map<string, VariantStepData>();
        for (const sd of stepResult.data) map.set(sd.variantId, sd);
        setStepScores(map);
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  // Auto-expand variant when navigated to via ?variant= URL param
  useEffect(() => {
    if (!initialVariant || loading || initialVariantApplied.current || variants.length === 0) return;
    initialVariantApplied.current = true;
    // Match by full ID or prefix
    const match = variants.find(v => v.id === initialVariant || v.id.startsWith(initialVariant));
    if (match) {
      setExpandedId(match.id);
    }
  }, [initialVariant, loading, variants]);

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
      <div className="flex items-center justify-between relative z-10">
        <select
          value={strategyFilter}
          onChange={e => setStrategyFilter(e.target.value)}
          className="px-3 py-1.5 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)] text-xs"
        >
          <option value="">All strategies</option>
          {strategies.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <Link
          href={`/admin/evolution/runs/${runId}/compare`}
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
              <th className="px-2 py-2 text-left">Rank</th>
              <th className="px-2 py-2 text-right">Rating</th>
              <th className="px-2 py-2 text-center w-28">Trend</th>
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
                    <span className="cursor-pointer" title={v.id} onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === v.id ? null : v.id); }}>
                      #{i + 1}
                      {v.is_winner && <span className="ml-1 text-[var(--accent-gold)]">&#9733;</span>}
                      <span className="ml-1 font-mono text-xs text-[var(--accent-gold)]">{v.id.substring(0, 6)}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right font-semibold">{Math.round(v.elo_score)}</td>
                  <td className="px-2 py-2 text-center w-28">
                    <EloSparkline data={sparklineMap.get(v.id.substring(0, 8)) ?? []} />
                  </td>
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
                    <td colSpan={7} className="p-4 bg-[var(--surface-secondary)]">
                      <div className="flex items-center gap-2 mb-3">
                        <button
                          onClick={() => setDetailPanelId(detailPanelId === v.id ? null : v.id)}
                          className="text-xs text-[var(--accent-gold)] hover:underline"
                          data-testid="why-this-score"
                        >
                          {detailPanelId === v.id ? 'Hide details' : 'Why this score?'}
                        </button>
                        {v.elo_attribution && (
                          <AttributionBadge attribution={v.elo_attribution} />
                        )}
                      </div>
                      {detailPanelId === v.id && (
                        <div className="mb-3 p-3 border border-[var(--border-default)] rounded-page bg-[var(--surface-primary)]">
                          <VariantDetailPanel
                            runId={runId}
                            variantId={v.id}
                            agentName={v.agent_name}
                            generation={v.generation}
                          />
                        </div>
                      )}
                      {stepScores.has(v.id) && (
                        <div className="mb-3 p-3 border border-[var(--border-default)] rounded-page bg-[var(--surface-primary)]">
                          <p className="text-xs font-semibold text-[var(--text-muted)] mb-2">Step Scores</p>
                          <StepScoreBar
                            steps={stepScores.get(v.id)!.steps}
                            weakestStep={stepScores.get(v.id)!.weakestStep}
                          />
                        </div>
                      )}
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
