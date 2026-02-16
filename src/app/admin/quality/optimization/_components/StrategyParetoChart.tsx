/**
 * Pareto frontier scatter plot for strategy Elo vs Cost analysis.
 * Highlights Pareto-optimal strategies on the efficient frontier.
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ParetoPoint } from '@/lib/services/eloBudgetActions';
import { formatCost, formatCostDetailed, formatElo } from '@/lib/utils/formatters';

interface StrategyParetoChartProps {
  points: ParetoPoint[];
  loading: boolean;
}

export function StrategyParetoChart({ points, loading }: StrategyParetoChartProps) {
  const [hoveredPoint, setHoveredPoint] = useState<ParetoPoint | null>(null);

  if (loading) {
    return (
      <Card className="bg-[var(--surface-secondary)] paper-texture">
        <CardHeader>
          <CardTitle className="text-xl font-display text-[var(--text-primary)]">
            Pareto Frontier
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
              <span className="font-ui">Loading chart...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (points.length === 0) {
    return (
      <Card className="bg-[var(--surface-secondary)] paper-texture">
        <CardHeader>
          <CardTitle className="text-xl font-display text-[var(--text-primary)]">
            Pareto Frontier
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-[var(--text-muted)] font-body">
            No strategy data yet. Run experiments to see the Pareto frontier.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate chart bounds with padding
  const costs = points.map(p => p.avgCostUsd);
  const elos = points.map(p => p.avgFinalElo);
  const minCost = Math.min(...costs) * 0.9;
  const maxCost = Math.max(...costs) * 1.1;
  const minElo = Math.min(...elos) * 0.98;
  const maxElo = Math.max(...elos) * 1.02;

  // SVG dimensions
  const width = 400;
  const height = 250;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Scale functions
  const xScale = (cost: number) =>
    padding.left + ((cost - minCost) / (maxCost - minCost)) * chartWidth;
  const yScale = (elo: number) =>
    padding.top + chartHeight - ((elo - minElo) / (maxElo - minElo)) * chartHeight;

  // Pareto frontier line (sorted by cost)
  const paretoPoints = points.filter(p => p.isPareto).sort((a, b) => a.avgCostUsd - b.avgCostUsd);
  const paretoPath = paretoPoints.length > 1
    ? `M ${paretoPoints.map(p => `${xScale(p.avgCostUsd)},${yScale(p.avgFinalElo)}`).join(' L ')}`
    : '';

  return (
    <Card className="bg-[var(--surface-secondary)] paper-texture">
      <CardHeader>
        <CardTitle className="text-xl font-display text-[var(--text-primary)]">
          Pareto Frontier
        </CardTitle>
        <p className="text-xs font-ui text-[var(--text-muted)] mt-1">
          Cost vs Elo. Gold points are Pareto-optimal (best tradeoffs).
        </p>
      </CardHeader>
      <CardContent>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
          {/* Grid lines */}
          <g className="text-[var(--border-default)]">
            {[0, 0.25, 0.5, 0.75, 1].map(t => (
              <line
                key={`h-${t}`}
                x1={padding.left}
                y1={padding.top + t * chartHeight}
                x2={width - padding.right}
                y2={padding.top + t * chartHeight}
                stroke="currentColor"
                strokeOpacity={0.3}
                strokeDasharray="2,2"
              />
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map(t => (
              <line
                key={`v-${t}`}
                x1={padding.left + t * chartWidth}
                y1={padding.top}
                x2={padding.left + t * chartWidth}
                y2={height - padding.bottom}
                stroke="currentColor"
                strokeOpacity={0.3}
                strokeDasharray="2,2"
              />
            ))}
          </g>

          {/* Pareto frontier line */}
          {paretoPath && (
            <path
              d={paretoPath}
              fill="none"
              stroke="var(--accent-gold)"
              strokeWidth={2}
              strokeOpacity={0.5}
            />
          )}

          {/* Points */}
          {points.map((point) => (
            <circle
              key={point.strategyId}
              cx={xScale(point.avgCostUsd)}
              cy={yScale(point.avgFinalElo)}
              r={hoveredPoint?.strategyId === point.strategyId ? 8 : 6}
              fill={point.isPareto ? 'var(--accent-gold)' : 'var(--text-muted)'}
              stroke={point.isPareto ? 'var(--accent-copper)' : 'var(--border-default)'}
              strokeWidth={2}
              className="cursor-pointer transition-all duration-150"
              onMouseEnter={() => setHoveredPoint(point)}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          ))}

          {/* Axes labels */}
          <text
            x={width / 2}
            y={height - 8}
            textAnchor="middle"
            className="font-ui text-xs fill-[var(--text-muted)]"
          >
            Avg Cost ($)
          </text>
          <text
            x={12}
            y={height / 2}
            textAnchor="middle"
            transform={`rotate(-90, 12, ${height / 2})`}
            className="font-ui text-xs fill-[var(--text-muted)]"
          >
            Avg Elo
          </text>

          {/* Axis values */}
          <text
            x={padding.left}
            y={height - padding.bottom + 15}
            textAnchor="start"
            className="font-mono text-xs fill-[var(--text-muted)]"
          >
            {formatCost(minCost)}
          </text>
          <text
            x={width - padding.right}
            y={height - padding.bottom + 15}
            textAnchor="end"
            className="font-mono text-xs fill-[var(--text-muted)]"
          >
            {formatCost(maxCost)}
          </text>
          <text
            x={padding.left - 5}
            y={height - padding.bottom}
            textAnchor="end"
            className="font-mono text-xs fill-[var(--text-muted)]"
          >
            {formatElo(minElo)}
          </text>
          <text
            x={padding.left - 5}
            y={padding.top + 5}
            textAnchor="end"
            className="font-mono text-xs fill-[var(--text-muted)]"
          >
            {formatElo(maxElo)}
          </text>
        </svg>

        {/* Tooltip */}
        {hoveredPoint && (
          <div className="mt-3 p-3 bg-[var(--surface-elevated)] rounded-page border border-[var(--border-default)]">
            <div className="font-ui font-medium text-sm text-[var(--text-primary)]">
              {hoveredPoint.name}
            </div>
            <div className="text-xs font-ui text-[var(--text-muted)] mt-1">
              {hoveredPoint.label}
            </div>
            <div className="flex gap-4 mt-2 text-xs font-mono">
              <span>Elo: <span className="text-[var(--text-primary)]">{formatElo(hoveredPoint.avgFinalElo)}</span></span>
              <span>Cost: <span className="text-[var(--text-primary)]">{formatCostDetailed(hoveredPoint.avgCostUsd)}</span></span>
              <span>Runs: <span className="text-[var(--text-primary)]">{hoveredPoint.runCount}</span></span>
              {hoveredPoint.isPareto && (
                <span className="text-[var(--accent-gold)]">Pareto optimal</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
