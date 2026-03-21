'use client';
// Elo/mu history chart for a run, using run_summary.muHistory from V2 schema.
// Renders a simple SVG line chart showing mu progression across iterations.

import { useEffect, useState } from 'react';
import {
  getEvolutionRunEloHistoryAction,
  type EloHistoryPoint,
} from '@evolution/services/evolutionVisualizationActions';

interface EloTabProps {
  runId: string;
}

export function EloTab({ runId }: EloTabProps): JSX.Element {
  const [history, setHistory] = useState<EloHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getEvolutionRunEloHistoryAction(runId);
      if (result.success && result.data) {
        setHistory(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load elo history');
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  if (loading) {
    return <div className="h-64 bg-[var(--surface-elevated)] rounded animate-pulse" />;
  }

  if (error) {
    return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;
  }

  if (history.length === 0) {
    return (
      <div className="text-[var(--text-muted)] text-sm p-8 text-center" data-testid="elo-tab-empty">
        No Elo history available for this run.
      </div>
    );
  }

  // SVG chart dimensions
  const width = 600;
  const height = 300;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const muValues = history.map(h => h.mu);
  const minMu = Math.min(...muValues) - 1;
  const maxMu = Math.max(...muValues) + 1;
  const muRange = maxMu - minMu || 1;

  const points = history.map((h, i) => {
    const x = padding.left + (i / Math.max(history.length - 1, 1)) * chartW;
    const y = padding.top + chartH - ((h.mu - minMu) / muRange) * chartH;
    return `${x},${y}`;
  });

  return (
    <div className="space-y-4" data-testid="elo-tab">
      <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
        Rating History ({history.length} iterations)
      </h3>
      <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-book p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-2xl">
          {/* Y axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map(pct => {
            const y = padding.top + chartH * (1 - pct);
            const val = minMu + muRange * pct;
            return (
              <g key={pct}>
                <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="var(--border-default)" strokeDasharray="4" />
                <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="var(--text-muted)" className="text-xs">{val.toFixed(1)}</text>
              </g>
            );
          })}
          {/* X axis labels */}
          {history.filter((_, i) => i === 0 || i === history.length - 1 || i % Math.ceil(history.length / 5) === 0).map(h => {
            const x = padding.left + ((h.iteration - 1) / Math.max(history.length - 1, 1)) * chartW;
            return (
              <text key={h.iteration} x={x} y={height - 8} textAnchor="middle" fill="var(--text-muted)" className="text-xs">
                {h.iteration}
              </text>
            );
          })}
          {/* Line */}
          <polyline
            points={points.join(' ')}
            fill="none"
            stroke="var(--accent-gold)"
            strokeWidth="2"
          />
          {/* Dots */}
          {history.map((h, i) => {
            const x = padding.left + (i / Math.max(history.length - 1, 1)) * chartW;
            const y = padding.top + chartH - ((h.mu - minMu) / muRange) * chartH;
            return <circle key={i} cx={x} cy={y} r="3" fill="var(--accent-gold)" />;
          })}
        </svg>
      </div>
    </div>
  );
}
