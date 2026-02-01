'use client';
// Timeline visualization showing iteration-by-iteration execution of an evolution run.
// Displays agents, cost, variants added, and matches played per iteration step.

import { useEffect, useState } from 'react';
import { PhaseIndicator } from '@/components/evolution';
import {
  getEvolutionRunTimelineAction,
  type TimelineData,
} from '@/lib/services/evolutionVisualizationActions';

export function TimelineTab({ runId }: { runId: string }) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getEvolutionRunTimelineAction(runId);
      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load timeline');
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  if (loading) return <TimelineSkeleton />;
  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;
  if (!data || data.iterations.length === 0) {
    return <div className="text-[var(--text-muted)] text-sm p-4">No timeline data available</div>;
  }

  const transitionSet = new Set(data.phaseTransitions.map(t => t.afterIteration));

  return (
    <div className="space-y-4" data-testid="timeline-tab">
      {data.iterations.map((iter, i) => (
        <div key={iter.iteration}>
          {/* Phase transition marker */}
          {transitionSet.has(data.iterations[i - 1]?.iteration) && (
            <div className="flex items-center gap-3 py-2">
              <div className="flex-1 h-px bg-[var(--accent-gold)]/30" />
              <span className="text-xs text-[var(--accent-gold)] font-medium">Phase Transition</span>
              <div className="flex-1 h-px bg-[var(--accent-gold)]/30" />
            </div>
          )}

          {/* Iteration block */}
          <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  Iteration {iter.iteration}
                </span>
                <PhaseIndicator
                  phase={iter.phase}
                  iteration={iter.iteration}
                  maxIterations={data.iterations.length}
                />
              </div>
            </div>

            {/* Agent entries */}
            <div className="space-y-2">
              {iter.agents.map((agent, j) => (
                <div
                  key={`${iter.iteration}-${j}`}
                  className="flex items-center justify-between text-xs bg-[var(--surface-secondary)] rounded-page px-3 py-2"
                >
                  <span className="font-mono text-[var(--text-secondary)]">{agent.name}</span>
                  <div className="flex items-center gap-4 text-[var(--text-muted)]">
                    <span>+{agent.variantsAdded} variants</span>
                    <span>{agent.matchesPlayed} matches</span>
                    <span className="font-mono">${agent.costUsd.toFixed(3)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-24 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      ))}
    </div>
  );
}
