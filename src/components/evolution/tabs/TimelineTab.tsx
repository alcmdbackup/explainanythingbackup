'use client';
// Timeline visualization showing iteration-by-iteration execution of an evolution run.
// Displays all agents per iteration with expandable detail panels showing per-agent metrics.

import { useEffect, useState, useCallback } from 'react';
import { PhaseIndicator } from '@/components/evolution';
import {
  getEvolutionRunTimelineAction,
  type TimelineData,
} from '@/lib/services/evolutionVisualizationActions';

/** Agent colors for visual differentiation in timeline rows. */
const AGENT_PALETTE: Record<string, string> = {
  generation: '#3b82f6', // blue
  calibration: '#22c55e', // green
  evolution: '#a855f7', // purple
  reflection: '#f97316', // orange
  iterativeEditing: '#ec4899', // pink
  debate: '#14b8a6', // teal
  proximity: '#eab308', // yellow
  metaReview: '#6366f1', // indigo
  tournament: '#ef4444', // red
};

type TimelineAgent = TimelineData['iterations'][number]['agents'][number];

/** Detail panel showing expanded metrics for a single agent. */
function AgentDetailPanel({ agent }: { agent: TimelineAgent }) {
  return (
    <div
      className="mt-1 p-3 bg-[var(--surface-secondary)] rounded-page border border-[var(--border-default)]"
      data-testid="agent-detail-panel"
    >
      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs mb-3">
        <div>
          <div className="text-[var(--text-muted)]">Variants Added</div>
          <div className="font-mono" data-testid="metric-variants-added">{agent.variantsAdded}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)]">Matches Played</div>
          <div className="font-mono" data-testid="metric-matches-played">{agent.matchesPlayed}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)]">Cost</div>
          <div className="font-mono">${agent.costUsd.toFixed(4)}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)]">Diversity After</div>
          <div className="font-mono">{agent.diversityScoreAfter?.toFixed(2) ?? '—'}</div>
        </div>
      </div>

      {/* Additional metrics row */}
      {(agent.critiquesAdded || agent.debatesAdded || agent.metaFeedbackPopulated) && (
        <div className="grid grid-cols-3 gap-4 text-xs mb-3">
          {agent.critiquesAdded !== undefined && agent.critiquesAdded > 0 && (
            <div>
              <div className="text-[var(--text-muted)]">Critiques Added</div>
              <div className="font-mono">{agent.critiquesAdded}</div>
            </div>
          )}
          {agent.debatesAdded !== undefined && agent.debatesAdded > 0 && (
            <div>
              <div className="text-[var(--text-muted)]">Debates Added</div>
              <div className="font-mono">{agent.debatesAdded}</div>
            </div>
          )}
          {agent.metaFeedbackPopulated && (
            <div>
              <div className="text-[var(--text-muted)]">Meta Feedback</div>
              <div className="text-[var(--status-success)]">✓ Populated</div>
            </div>
          )}
        </div>
      )}

      {/* New variants list */}
      {agent.newVariantIds && agent.newVariantIds.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-[var(--text-muted)] mb-1">New Variants</div>
          <div className="flex flex-wrap gap-1">
            {agent.newVariantIds.map(id => (
              <span
                key={id}
                className="px-2 py-0.5 bg-[var(--surface-elevated)] rounded text-xs font-mono"
              >
                {id.substring(0, 8)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Elo changes */}
      {agent.eloChanges && Object.keys(agent.eloChanges).length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-[var(--text-muted)] mb-1">Elo Changes</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(agent.eloChanges).slice(0, 10).map(([variantId, delta]) => (
              <span
                key={variantId}
                className={`px-2 py-0.5 rounded text-xs font-mono ${
                  delta > 0
                    ? 'bg-[var(--status-success)]/10 text-[var(--status-success)]'
                    : 'bg-[var(--status-error)]/10 text-[var(--status-error)]'
                }`}
              >
                {variantId.substring(0, 6)}: {delta > 0 ? '+' : ''}{Math.round(delta)}
              </span>
            ))}
            {Object.keys(agent.eloChanges).length > 10 && (
              <span className="text-xs text-[var(--text-muted)]">
                +{Object.keys(agent.eloChanges).length - 10} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Error message */}
      {agent.error && (
        <div className="mt-2 text-xs text-[var(--status-error)]">
          Error: {agent.error}
        </div>
      )}
    </div>
  );
}

export function TimelineTab({ runId }: { runId: string }) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

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

  const toggleExpand = useCallback((iteration: number, agentName: string) => {
    const key = `${iteration}-${agentName}`;
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  if (loading) return <TimelineSkeleton />;
  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;
  if (!data || data.iterations.length === 0) {
    return <div className="text-[var(--text-muted)] text-sm p-4">No timeline data available</div>;
  }

  const transitionSet = new Set(data.phaseTransitions.map(t => t.afterIteration));

  return (
    <div className="space-y-4" data-testid="timeline-tab">
      {data.iterations.map((iter, i) => {
        const totalVariants = iter.totalVariantsAdded ?? iter.agents.reduce((s, a) => s + a.variantsAdded, 0);
        const totalCost = iter.totalCostUsd ?? iter.agents.reduce((s, a) => s + a.costUsd, 0);

        return (
          <div key={iter.iteration} data-testid={`iteration-${iter.iteration}`}>
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
              {/* Iteration header with summary */}
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
                <div className="text-xs text-[var(--text-muted)]">
                  {iter.agents.length} agents • +{totalVariants} variants • ${totalCost.toFixed(3)}
                </div>
              </div>

              {/* Agent entries with expandable rows */}
              <div className="space-y-2">
                {iter.agents.map((agent) => {
                  const expandKey = `${iter.iteration}-${agent.name}`;
                  const isExpanded = expandedAgents.has(expandKey);

                  return (
                    <div key={expandKey}>
                      <div
                        className="flex items-center justify-between text-xs bg-[var(--surface-secondary)] rounded-page px-3 py-2 cursor-pointer hover:bg-[var(--surface-primary)]"
                        onClick={() => toggleExpand(iter.iteration, agent.name)}
                        data-testid={`agent-row-${agent.name}`}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-1 h-4 rounded-full"
                            style={{ backgroundColor: AGENT_PALETTE[agent.name] ?? 'var(--text-muted)' }}
                          />
                          <span className="font-mono text-[var(--text-secondary)]">{agent.name}</span>
                          {agent.skipped && (
                            <span className="text-[var(--status-warning)]">(skipped)</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-[var(--text-muted)]">
                          <span>+{agent.variantsAdded} variants</span>
                          <span>{agent.matchesPlayed} matches</span>
                          <span className="font-mono" data-testid={`agent-cost-${agent.name}`}>
                            ${agent.costUsd.toFixed(3)}
                          </span>
                          <button className="text-[var(--accent-gold)] hover:underline ml-2">
                            {isExpanded ? 'Hide' : 'Details'}
                          </button>
                        </div>
                      </div>

                      {/* Expanded detail panel */}
                      {isExpanded && <AgentDetailPanel agent={agent} />}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
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
