'use client';
// Elo rating history chart showing variant performance trajectories across iterations.
// Renders a Recharts line chart with strategy-colored lines and top-N filtering.

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { STRATEGY_PALETTE } from '@/components/evolution/VariantCard';
import {
  getEvolutionRunEloHistoryAction,
  type EloHistoryData,
} from '@/lib/services/evolutionVisualizationActions';

const EloChart = dynamic(() => import('recharts').then((mod) => {
  const { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } = mod;

  function Chart({ data, variants, topN }: {
    data: EloHistoryData['history'];
    variants: EloHistoryData['variants'];
    topN: number;
  }) {
    if (data.length === 0) return <div className="h-[400px] flex items-center justify-center text-sm text-[var(--text-muted)]">No Elo data</div>;

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

    const variantMap = new Map(variants.map(v => [v.id, v]));

    return (
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData}>
          <XAxis dataKey="iteration" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
          <YAxis domain={[800, 'auto']} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={50} />
          <Tooltip
            contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 11 }}
            formatter={(value, name) => {
              const v = variantMap.get(String(name));
              return [Math.round(Number(value ?? 0)), v ? `${v.shortId} (${v.strategy})` : String(name)];
            }}
          />
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
  const [data, setData] = useState<EloHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topN, setTopN] = useState(5);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getEvolutionRunEloHistoryAction(runId);
      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load Elo history');
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  if (loading) return <div className="h-[400px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;

  return (
    <div className="space-y-4" data-testid="elo-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Elo Trajectories</h3>
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
          <span>{topN}</span>
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
