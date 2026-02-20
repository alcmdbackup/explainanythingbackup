/**
 * Pie chart showing cost distribution across agents.
 * Helps identify which agents consume the most budget.
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AgentROI } from '@evolution/services/eloBudgetActions';
import { formatCost } from '@evolution/lib/utils/formatters';

interface CostBreakdownPieProps {
  agents: AgentROI[];
  loading: boolean;
}

// Agent colors for consistent visualization using CSS variables
const AGENT_COLORS: Record<string, string> = {
  generation: 'var(--accent-gold)',
  calibration: 'var(--accent-copper)',
  tournament: 'var(--status-info)',
  evolution: 'var(--status-success)',
  reflection: 'var(--status-warning)',
  debate: 'var(--status-error)',
  iterativeEditing: 'var(--accent-blue)',
  proximity: 'var(--border-strong)',
  metaReview: 'var(--text-muted)',
};

function getAgentColor(agentName: string): string {
  return AGENT_COLORS[agentName] ?? 'var(--text-muted)';
}

export function CostBreakdownPie({ agents, loading }: CostBreakdownPieProps) {
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);

  if (loading) {
    return (
      <Card className="bg-[var(--surface-secondary)] paper-texture">
        <CardHeader>
          <CardTitle className="text-xl font-display text-[var(--text-primary)]">
            Cost Distribution
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

  if (agents.length === 0) {
    return (
      <Card className="bg-[var(--surface-secondary)] paper-texture">
        <CardHeader>
          <CardTitle className="text-xl font-display text-[var(--text-primary)]">
            Cost Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-[var(--text-muted)] font-body">
            No cost data yet. Run experiments to see cost distribution.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate total cost and percentages
  const totalCost = agents.reduce((sum, a) => sum + a.avgCostUsd * a.sampleSize, 0);
  const slices = agents.map(agent => ({
    ...agent,
    totalCost: agent.avgCostUsd * agent.sampleSize,
    percentage: totalCost > 0 ? (agent.avgCostUsd * agent.sampleSize / totalCost) * 100 : 0,
  })).sort((a, b) => b.totalCost - a.totalCost);

  // SVG dimensions
  const size = 200;
  const center = size / 2;
  const radius = 80;
  const innerRadius = 40;

  // Generate pie slices
  let currentAngle = -90; // Start at top
  const slicePaths = slices.map(slice => {
    const angle = (slice.percentage / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    // Convert to radians
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    // Calculate arc points
    const x1 = center + radius * Math.cos(startRad);
    const y1 = center + radius * Math.sin(startRad);
    const x2 = center + radius * Math.cos(endRad);
    const y2 = center + radius * Math.sin(endRad);
    const x3 = center + innerRadius * Math.cos(endRad);
    const y3 = center + innerRadius * Math.sin(endRad);
    const x4 = center + innerRadius * Math.cos(startRad);
    const y4 = center + innerRadius * Math.sin(startRad);

    // Large arc flag
    const largeArc = angle > 180 ? 1 : 0;

    const path = `
      M ${x1} ${y1}
      A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}
      L ${x3} ${y3}
      A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4}
      Z
    `;

    return {
      ...slice,
      path,
      startAngle,
      endAngle,
    };
  });

  const hoveredData = slicePaths.find(s => s.agentName === hoveredSlice);

  return (
    <Card className="bg-[var(--surface-secondary)] paper-texture">
      <CardHeader>
        <CardTitle className="text-xl font-display text-[var(--text-primary)]">
          Cost Distribution
        </CardTitle>
        <p className="text-xs font-ui text-[var(--text-muted)] mt-1">
          Total: {formatCost(totalCost)} across {agents.reduce((s, a) => s + a.sampleSize, 0)} samples
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex gap-6 items-start">
          {/* Pie chart */}
          <div className="flex-shrink-0">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              {slicePaths.map((slice) => (
                <path
                  key={slice.agentName}
                  d={slice.path}
                  fill={getAgentColor(slice.agentName)}
                  stroke="var(--surface-secondary)"
                  strokeWidth={2}
                  opacity={hoveredSlice === null || hoveredSlice === slice.agentName ? 1 : 0.4}
                  className="cursor-pointer transition-opacity duration-150"
                  onMouseEnter={() => setHoveredSlice(slice.agentName)}
                  onMouseLeave={() => setHoveredSlice(null)}
                />
              ))}
              {/* Center text */}
              <text
                x={center}
                y={center - 5}
                textAnchor="middle"
                className="font-display text-lg fill-[var(--text-primary)]"
              >
                {hoveredData ? `${hoveredData.percentage.toFixed(1)}%` : 'Cost'}
              </text>
              <text
                x={center}
                y={center + 12}
                textAnchor="middle"
                className="font-ui text-xs fill-[var(--text-muted)]"
              >
                {hoveredData ? hoveredData.agentName : 'by agent'}
              </text>
            </svg>
          </div>

          {/* Legend */}
          <div className="flex-1 space-y-2">
            {slicePaths.slice(0, 7).map((slice) => (
              <div
                key={slice.agentName}
                className={`flex items-center gap-2 px-2 py-1 rounded-page transition-colors cursor-pointer ${
                  hoveredSlice === slice.agentName ? 'bg-[var(--surface-elevated)]' : ''
                }`}
                onMouseEnter={() => setHoveredSlice(slice.agentName)}
                onMouseLeave={() => setHoveredSlice(null)}
              >
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: getAgentColor(slice.agentName) }}
                />
                <span className="font-ui text-sm text-[var(--text-primary)] capitalize flex-1">
                  {slice.agentName}
                </span>
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  {slice.percentage.toFixed(1)}%
                </span>
                <span className="font-mono text-xs text-[var(--text-secondary)]">
                  {formatCost(slice.totalCost)}
                </span>
              </div>
            ))}
            {slicePaths.length > 7 && (
              <div className="text-xs font-ui text-[var(--text-muted)] px-2">
                +{slicePaths.length - 7} more agents
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
