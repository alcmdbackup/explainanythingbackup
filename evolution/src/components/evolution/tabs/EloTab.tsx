'use client';
// Elo history chart for a run, using run_summary.eloHistory from V3 schema.
// Renders a simple SVG line chart showing Elo progression across iterations.

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

  // Determine number of lines: use elos array (top-K) if available, otherwise single line
  const hasMultiLine = history.some(h => h.elos && h.elos.length > 1);
  const lineCount = hasMultiLine ? Math.max(...history.map(h => h.elos?.length ?? 1)) : 1;

  // Collect all Elo values for axis scaling
  const allEloValues = history.flatMap(h => h.elos ?? [h.elo]);
  const minElo = Math.min(...allEloValues) - 1;
  const maxElo = Math.max(...allEloValues) + 1;
  const eloRange = maxElo - minElo || 1;

  // Line colors for top-K variants (gold for #1, copper for rest, fading opacity)
  const lineColors = ['var(--accent-gold)', 'var(--accent-copper)', 'var(--text-secondary)', 'var(--text-muted)', 'var(--border-default)'];

  // Build polyline points for each rank position
  const lineData = Array.from({ length: lineCount }, (_, rank) =>
    history.map((h, i) => {
      const elo = h.elos?.[rank] ?? (rank === 0 ? h.elo : null);
      if (elo == null) return null;
      const x = padding.left + (i / Math.max(history.length - 1, 1)) * chartW;
      const y = padding.top + chartH - ((elo - minElo) / eloRange) * chartH;
      return `${x},${y}`;
    }).filter(Boolean) as string[],
  );

  return (
    <div className="space-y-4" data-testid="elo-tab">
      <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
        Rating History ({history.length} iterations{hasMultiLine ? `, Top ${lineCount}` : ''})
      </h3>
      <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-book p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-2xl">
          {/* Y axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map(pct => {
            const y = padding.top + chartH * (1 - pct);
            const val = minElo + eloRange * pct;
            return (
              <g key={pct}>
                <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="var(--border-default)" strokeDasharray="4" />
                <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="var(--text-muted)" className="text-xs">{Math.round(val)}</text>
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
          {/* Lines for each rank position (top-K) */}
          {lineData.map((pts, rank) => (
            <polyline
              key={rank}
              points={pts.join(' ')}
              fill="none"
              stroke={lineColors[rank] ?? 'var(--text-muted)'}
              strokeWidth={rank === 0 ? 2 : 1.5}
              strokeOpacity={rank === 0 ? 1 : 0.6}
            />
          ))}
          {/* Dots for top-1 line only */}
          {history.map((h, i) => {
            const x = padding.left + (i / Math.max(history.length - 1, 1)) * chartW;
            const y = padding.top + chartH - ((h.elo - minElo) / eloRange) * chartH;
            return <circle key={i} cx={x} cy={y} r="3" fill="var(--accent-gold)" />;
          })}
        </svg>
        {/* Legend for multi-line chart */}
        {hasMultiLine && (
          <div className="flex gap-4 mt-2 text-xs text-[var(--text-secondary)]">
            {Array.from({ length: Math.min(lineCount, 5) }, (_, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5" style={{ backgroundColor: lineColors[i] ?? 'var(--text-muted)', opacity: i === 0 ? 1 : 0.6 }} />
                #{i + 1}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
