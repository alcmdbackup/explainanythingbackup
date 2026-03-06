'use client';
// Elo rating history chart showing variant performance trajectories across iterations.
// Renders a Recharts line chart with strategy-colored lines and top-N filtering.

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { STRATEGY_PALETTE } from '@evolution/components/evolution/VariantCard';
import { useAutoRefresh } from '@evolution/components/evolution/AutoRefreshProvider';
import {
  getEvolutionRunEloHistoryAction,
  type EloHistoryData,
} from '@evolution/services/evolutionVisualizationActions';

const EloChart = dynamic(() => import('recharts').then((mod) => {
  const { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Label } = mod;

  function Chart({ data, variants, topN }: {
    data: EloHistoryData['history'];
    variants: EloHistoryData['variants'];
    topN: number;
  }) {
    if (data.length === 0) return <div className="h-[400px] flex items-center justify-center text-sm text-[var(--text-muted)]">No rating data</div>;

    // Determine top N by final Elo
    const lastRatings = data[data.length - 1]?.ratings ?? {};
    const ranked = Object.entries(lastRatings).sort((a, b) => b[1] - a[1]);
    const topIds = new Set(ranked.slice(0, topN).map(([id]) => id));

    // Build chart data: each row is an iteration, each variant is a key
    const chartData = data.map(h => {
      const row: Record<string, number> = { iteration: h.iteration };
      for (const [id, rating] of Object.entries(h.ratings)) {
        row[id] = rating;
      }
      return row;
    });

    // Contextual Y-axis minimum: round down to nearest 50 below the overall min
    const allRatings = data.flatMap(h => Object.values(h.ratings));
    const minRating = allRatings.length > 0 ? Math.min(...allRatings) : 800;
    const yMin = Math.floor(minRating / 50) * 50;

    const variantMap = new Map(variants.map(v => [v.id, v]));

    return (
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData}>
          <XAxis dataKey="iteration" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}>
            <Label value="Iteration" position="insideBottom" offset={-2} fontSize={10} fill="var(--text-muted)" />
          </XAxis>
          <YAxis domain={[yMin, 'auto']} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={50}>
            <Label value="Rating" angle={-90} position="insideLeft" fontSize={10} fill="var(--text-muted)" />
          </YAxis>
          <Tooltip
            contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 11 }}
            formatter={(value, name) => {
              const v = variantMap.get(String(name));
              const label = v ? `${v.shortId} (${v.strategy}) — click in Variants tab` : String(name);
              return [Math.round(Number(value ?? 0)), label];
            }}
          />
          <ReferenceLine y={1200} stroke="var(--text-muted)" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'Baseline 1200', fill: 'var(--text-muted)', fontSize: 9, position: 'right' }} />
          {variants.map(v => {
            const isTop = topIds.has(v.id);
            return (
              <Line
                key={v.id}
                type="monotone"
                dataKey={v.id}
                name={v.id}
                stroke={isTop ? (STRATEGY_PALETTE[v.strategy] ?? 'var(--accent-gold)') : 'var(--text-muted)'}
                strokeWidth={isTop ? 2 : 0.5}
                strokeOpacity={isTop ? 1 : 0.3}
                dot={false}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return Chart;
}), { ssr: false, loading: () => <div className="h-[400px] bg-[var(--surface-secondary)] rounded-book animate-pulse" /> });

export function EloTab({ runId }: { runId: string }) {
  const { refreshKey, reportRefresh, reportError } = useAutoRefresh();
  const [data, setData] = useState<EloHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topN, setTopN] = useState(5);
  const initialLoad = useRef(true);

  useEffect(() => {
    async function load() {
      if (initialLoad.current) setLoading(true);
      const result = await getEvolutionRunEloHistoryAction(runId);
      if (result.success && result.data) {
        setData(result.data);
        reportRefresh();
      } else {
        const msg = result.error?.message ?? 'Failed to load rating history';
        setError(msg);
        if (!initialLoad.current) reportError(msg);
      }
      if (initialLoad.current) { setLoading(false); initialLoad.current = false; }
    }
    load();
  }, [runId, refreshKey, reportRefresh, reportError]);

  if (loading) return <div className="h-[400px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;

  return (
    <div className="space-y-4" data-testid="elo-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Rating Trajectories</h3>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <label htmlFor="topN">Top</label>
          <input
            id="topN"
            type="range"
            min={1}
            max={Math.max(data?.variants.length ?? 5, 5)}
            value={topN}
            onChange={e => setTopN(Number(e.target.value))}
            className="w-24"
          />
          <span data-testid="elo-top-label">{topN} of {data?.variants.length ?? 0}</span>
        </div>
      </div>
      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
        <EloChart
          data={data?.history ?? []}
          variants={data?.variants ?? []}
          topN={topN}
        />
      </div>
    </div>
  );
}
