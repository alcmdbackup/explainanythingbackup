'use client';
// Timeline visualization with integrated budget analysis for an evolution run.
// Shows iteration-by-iteration execution, cost summary, burn curve, and agent cost breakdown.

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { PhaseIndicator } from '@/components/evolution';
import { useAutoRefresh } from '@/components/evolution/AutoRefreshProvider';
import {
  getEvolutionRunTimelineAction,
  getAgentInvocationDetailAction,
  getEvolutionRunBudgetAction,
  type TimelineData,
  type BudgetData,
} from '@/lib/services/evolutionVisualizationActions';
import { formatCost, formatCostDetailed, formatCostMicro, formatScore } from '@/lib/utils/formatters';
import type { AgentExecutionDetail } from '@/lib/evolution/types';
import { AgentExecutionDetailView } from '@/components/evolution/agentDetails';
import { ShortId } from '@/components/evolution/agentDetails/shared';

// ─── Dynamic Recharts Imports (Budget Charts) ──────────────────────

const BurnChart = dynamic(() => import('recharts').then((mod) => {
  const { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Label } = mod;
  function Chart({ data, estimatedTotal }: { data: BudgetData['cumulativeBurn']; estimatedTotal?: number | null }) {
    if (data.length === 0) return <div className="h-[280px] flex items-center justify-center text-sm text-[var(--text-muted)]">No cost data</div>;
    const budgetCap = data[0]?.budgetCap ?? 5;
    return (
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data}>
          <XAxis dataKey="step" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}>
            <Label value="Step" position="insideBottom" offset={-2} fontSize={10} fill="var(--text-muted)" />
          </XAxis>
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={55} tickFormatter={(v: number) => `$${v.toFixed(2)}`}>
            <Label value="Cost (USD)" angle={-90} position="insideLeft" fontSize={10} fill="var(--text-muted)" offset={5} />
          </YAxis>
          <Tooltip contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 12 }} formatter={(v) => [`$${Number(v ?? 0).toFixed(3)}`, 'Cost']} />
          <ReferenceLine y={budgetCap} stroke="var(--status-error)" strokeDasharray="4 4" label={{ value: `$${budgetCap.toFixed(2)} budget`, fill: 'var(--status-error)', fontSize: 10, position: 'right' }} />
          {estimatedTotal != null && (
            <ReferenceLine y={estimatedTotal} stroke="var(--status-warning)" strokeDasharray="6 3" label={{ value: `~$${estimatedTotal.toFixed(2)} est`, fill: 'var(--status-warning)', fontSize: 9, position: 'right' }} />
          )}
          <Area type="monotone" dataKey="cumulativeCost" stroke="var(--accent-gold)" fill="var(--accent-gold)" fillOpacity={0.2} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  return Chart;
}), { ssr: false, loading: () => <div className="h-[280px] bg-[var(--surface-secondary)] rounded-book animate-pulse" /> });

const AgentBarChart = dynamic(() => import('recharts').then((mod) => {
  const { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } = mod;
  function Chart({ data }: { data: BudgetData['agentBreakdown'] }) {
    if (data.length === 0) return <div className="h-[200px] flex items-center justify-center text-sm text-[var(--text-muted)]">No cost data</div>;
    return (
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical">
          <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
          <YAxis type="category" dataKey="agent" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={100} />
          <Tooltip contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 12 }} formatter={(v) => [`$${Number(v ?? 0).toFixed(3)}`, 'Cost']} />
          <Bar dataKey="costUsd" fill="var(--accent-gold)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return Chart;
}), { ssr: false, loading: () => <div className="h-[200px] bg-[var(--surface-secondary)] rounded-book animate-pulse" /> });

// ─── Budget Helper Components ───────────────────────────────────────

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-[var(--status-success)]/10 text-[var(--status-success)]',
  medium: 'bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]',
  low: 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]',
};

function ConfidenceBadge({ confidence }: { confidence: string }): JSX.Element {
  const style = CONFIDENCE_STYLES[confidence] ?? CONFIDENCE_STYLES.low;
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${style}`}>
      {confidence} confidence
    </span>
  );
}

function getDeltaStyle(deltaPercent: number): string {
  const abs = Math.abs(deltaPercent);
  if (abs <= 10) return 'bg-[var(--status-success)]/10 text-[var(--status-success)]';
  if (abs <= 30) return 'bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]';
  return 'bg-[var(--status-error)]/10 text-[var(--status-error)]';
}

function getBudgetBarColor(pct: number): string {
  if (pct >= 90) return 'bg-[var(--status-error)]';
  if (pct >= 70) return 'bg-[var(--accent-gold)]';
  return 'bg-[var(--status-success)]';
}

/** Budget status card showing On Track / At Risk / Over Budget with burn rate. */
function BudgetStatusCard({ data }: { data: BudgetData }) {
  const burn = data.cumulativeBurn;
  const budgetCap = burn.length > 0 ? burn[0].budgetCap : 0;
  const totalSpent = burn.length > 0 ? burn[burn.length - 1].cumulativeCost : 0;
  const pct = budgetCap > 0 ? (totalSpent / budgetCap) * 100 : 0;

  const uniqueSteps = [...new Set(burn.map(b => b.step))];
  const iterationCount = uniqueSteps.length;
  const burnPerIteration = iterationCount > 0 ? totalSpent / iterationCount : 0;
  const iterationsUntilBudget = burnPerIteration > 0 ? Math.floor((budgetCap - totalSpent) / burnPerIteration) : Infinity;

  let status: string;
  let statusColor: string;
  if (pct >= 100) {
    status = 'Over Budget';
    statusColor = 'text-[var(--status-error)]';
  } else if (pct >= 70) {
    status = 'At Risk';
    statusColor = 'text-[var(--status-warning)]';
  } else {
    status = 'On Track';
    statusColor = 'text-[var(--status-success)]';
  }

  return (
    <div
      className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4"
      data-testid="budget-status"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Budget Status</h3>
          <span className={`text-sm font-bold ${statusColor}`} data-testid="budget-status-label">
            {status}
          </span>
        </div>
        <span className="font-mono text-sm text-[var(--text-muted)]">
          {formatCost(totalSpent)} / {formatCost(budgetCap)} ({Math.round(pct)}%)
        </span>
      </div>
      {burnPerIteration > 0 && (
        <div className="mt-2 text-xs text-[var(--text-muted)]" data-testid="burn-rate">
          ~{formatCostDetailed(burnPerIteration)}/iteration
          {iterationsUntilBudget < Infinity && iterationsUntilBudget > 0 && (
            <span> — will hit budget in ~{iterationsUntilBudget} iteration{iterationsUntilBudget !== 1 ? 's' : ''}</span>
          )}
          {iterationsUntilBudget <= 0 && pct < 100 && (
            <span> — budget nearly exhausted</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Budget Section (self-contained with own data lifecycle) ────────

function BudgetSection({ runId, defaultExpanded }: {
  runId: string;
  defaultExpanded: boolean;
}): JSX.Element {
  const { refreshKey, reportRefresh, reportError } = useAutoRefresh();
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const initialLoad = useRef(true);

  const load = useCallback(async () => {
    const result = await getEvolutionRunBudgetAction(runId);
    if (result.success && result.data) {
      setData(result.data);
      reportRefresh();
    } else {
      const msg = result.error?.message ?? 'Failed to load budget data';
      setError(msg);
      if (!initialLoad.current) reportError(msg);
    }
  }, [runId, reportRefresh, reportError]);

  // Initial load + refresh on shared tick
  useEffect(() => {
    if (initialLoad.current) {
      setLoading(true);
      load().finally(() => { setLoading(false); initialLoad.current = false; });
    } else {
      load();
    }
  }, [load, refreshKey]);

  if (loading) {
    return (
      <div className="space-y-3" data-testid="budget-tab">
        <div className="h-16 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-[var(--status-error)] text-sm p-4" data-testid="budget-tab">
        {error}
      </div>
    );
  }

  const prediction = data?.prediction;
  const estimate = data?.estimate;

  return (
    <div className="space-y-4" data-testid="budget-tab">
      {/* Budget status card (always visible) */}
      {data && <BudgetStatusCard data={data} />}

      {/* Collapsible budget details */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        data-testid="budget-details-toggle"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Budget Details
      </button>

      {expanded && (
        <div className="space-y-4">
          {/* Estimated vs Actual comparison */}
          {prediction && (
            <div
              className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4 space-y-3"
              data-testid="estimate-comparison"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Estimated vs Actual</h3>
                {estimate && <ConfidenceBadge confidence={estimate.confidence} />}
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-[var(--text-muted)]">
                  Estimated: <span className="font-mono font-semibold text-[var(--text-secondary)]">{formatCost(prediction.estimatedUsd)}</span>
                </span>
                <span className="text-[var(--text-muted)]">
                  Actual: <span className="font-mono font-semibold text-[var(--text-secondary)]">{formatCost(prediction.actualUsd)}</span>
                </span>
                <span
                  className={`text-xs font-mono px-2 py-0.5 rounded ${getDeltaStyle(prediction.deltaPercent)}`}
                  data-testid="delta-badge"
                >
                  {prediction.deltaPercent >= 0 ? '+' : ''}{prediction.deltaPercent.toFixed(0)}%
                  {prediction.deltaPercent > 0 ? ' over' : prediction.deltaPercent < 0 ? ' under' : ''} estimate
                </span>
              </div>
              <div className="space-y-1.5">
                {Object.entries(prediction.perAgent)
                  .sort(([, a], [, b]) => Math.max(b.estimated, b.actual) - Math.max(a.estimated, a.actual))
                  .map(([agent, { estimated, actual }]) => {
                    const maxVal = Math.max(estimated, actual, 0.001);
                    return (
                      <div key={agent} className="flex items-center gap-2 text-xs">
                        <span className="w-28 text-[var(--text-muted)] font-mono truncate">{agent}</span>
                        <div className="flex-1 space-y-0.5">
                          <div className="h-2 bg-[var(--surface-secondary)] rounded overflow-hidden">
                            <div
                              className="h-full bg-[var(--accent-gold)]/40 rounded border border-[var(--accent-gold)]"
                              style={{ width: `${(estimated / maxVal) * 100}%` }}
                              title={`Estimated: $${estimated.toFixed(3)}`}
                            />
                          </div>
                          <div className="h-2 bg-[var(--surface-secondary)] rounded overflow-hidden">
                            <div
                              className="h-full bg-[var(--accent-gold)] rounded"
                              style={{ width: `${(actual / maxVal) * 100}%` }}
                              title={`Actual: $${actual.toFixed(3)}`}
                            />
                          </div>
                        </div>
                        <span className="w-20 text-right text-[var(--text-muted)]">
                          ${estimated.toFixed(3)} / ${actual.toFixed(3)}
                        </span>
                      </div>
                    );
                  })}
                <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] pt-1">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-2 bg-[var(--accent-gold)]/40 border border-[var(--accent-gold)] rounded-sm" /> estimated
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-2 bg-[var(--accent-gold)] rounded-sm" /> actual
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Cumulative Burn Chart */}
          <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Cumulative Burn</h3>
            <BurnChart data={data?.cumulativeBurn ?? []} estimatedTotal={data?.estimate?.totalUsd} />
          </div>

          {/* Agent Cost Breakdown */}
          <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Agent Cost Breakdown</h3>
            <AgentBarChart data={data?.agentBreakdown ?? []} />
          </div>

          {/* Agent Budget Caps */}
          {data && data.agentBudgetCaps && Object.keys(data.agentBudgetCaps).length > 0 && (
            <div
              className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4"
              data-testid="agent-budget-caps"
            >
              <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Agent Budget Caps</h3>
              <div className="space-y-2">
                {Object.entries(data.agentBudgetCaps)
                  .sort(([, a], [, b]) => b - a)
                  .map(([agent, capUsd]) => {
                    const spent = data.agentBreakdown.find((a) => a.agent === agent)?.costUsd ?? 0;
                    const pct = capUsd > 0 ? Math.min((spent / capUsd) * 100, 100) : 0;
                    const remaining = Math.max(capUsd - spent, 0);
                    return (
                      <div key={agent} className="flex items-center gap-2 text-xs">
                        <span className="w-28 text-[var(--text-muted)] font-mono truncate">{agent}</span>
                        <div className="flex-1 h-3 bg-[var(--surface-secondary)] rounded overflow-hidden">
                          <div
                            className={`h-full rounded ${getBudgetBarColor(pct)}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-32 text-right text-[var(--text-muted)] font-mono">
                          ${spent.toFixed(3)} / ${capUsd.toFixed(3)}
                        </span>
                        <span className="w-20 text-right text-[var(--text-muted)] font-mono">
                          ${remaining.toFixed(3)}
                        </span>
                      </div>
                    );
                  })}
                <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] pt-1 border-t border-[var(--border-default)] mt-2">
                  <span className="flex items-center gap-1"><span className="w-3 h-2 bg-[var(--status-success)] rounded-sm" /> under 70%</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 bg-[var(--accent-gold)] rounded-sm" /> 70-90%</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 bg-[var(--status-error)] rounded-sm" /> over 90%</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Timeline Components ────────────────────────────────────────────

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
  treeSearch: '#06b6d4', // cyan
  sectionDecomposition: '#84cc16', // lime
  outlineGeneration: '#f59e0b', // amber
  flowCritique: '#d946ef', // fuchsia
};

type TimelineAgent = TimelineData['iterations'][number]['agents'][number];

/** Detail panel showing expanded metrics for a single agent. */
function AgentDetailPanel({ agent, runId }: { agent: TimelineAgent; runId: string }): JSX.Element {
  return (
    <div
      className="mt-1 p-3 bg-[var(--surface-secondary)] rounded-page border border-[var(--border-default)]"
      data-testid="agent-detail-panel"
    >
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
          <div className="font-mono">{formatCostMicro(agent.costUsd)}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)]">Diversity After</div>
          <div className="font-mono">{formatScore(agent.diversityScoreAfter)}</div>
        </div>
      </div>

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

      {agent.newVariantIds && agent.newVariantIds.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-[var(--text-muted)] mb-1">New Variants</div>
          <div className="flex flex-wrap gap-1">
            {agent.newVariantIds.map(id => (
              <span
                key={id}
                className="px-2 py-0.5 bg-[var(--surface-elevated)] rounded text-xs"
              >
                <ShortId id={id} runId={runId} />
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Elo changes */}
      {agent.eloChanges && (() => {
        const entries = Object.entries(agent.eloChanges);
        if (entries.length === 0) return null;
        return (
          <div className="mt-2">
            <div className="text-xs text-[var(--text-muted)] mb-1">Elo Changes</div>
            <div className="flex flex-wrap gap-2">
              {entries.slice(0, 10).map(([variantId, delta]) => (
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
              {entries.length > 10 && (
                <span className="text-xs text-[var(--text-muted)]">
                  +{entries.length - 10} more
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {agent.error && (
        <div className="mt-2 text-xs text-[var(--status-error)]">
          Error: {agent.error}
        </div>
      )}
    </div>
  );
}

/** Renders the correct state for a lazily-loaded execution detail. */
function ExecutionDetailContent({ detail, runId }: { detail: AgentExecutionDetail | null | undefined; runId: string }): JSX.Element {
  if (detail === undefined) {
    return <div className="text-xs text-[var(--text-muted)] animate-pulse">Loading execution detail...</div>;
  }
  if (detail === null) {
    return <div className="text-xs text-[var(--text-muted)]">No execution detail available</div>;
  }
  return <AgentExecutionDetailView detail={detail} runId={runId} />;
}

// ─── Main Timeline Tab ──────────────────────────────────────────────

interface TimelineTabProps {
  runId: string;
  initialAgent?: string;
  initialBudgetExpanded?: boolean;
}

export function TimelineTab({ runId, initialAgent, initialBudgetExpanded = true }: TimelineTabProps): JSX.Element | null {
  const { refreshKey, reportRefresh, reportError: reportRefreshError } = useAutoRefresh();
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [executionDetails, setExecutionDetails] = useState<Record<string, AgentExecutionDetail | null>>({});
  const fetchingRef = useRef<Set<string>>(new Set());
  const initialAgentApplied = useRef(false);
  const initialLoad = useRef(true);

  const loadTimeline = useCallback(async () => {
    const result = await getEvolutionRunTimelineAction(runId);
    if (result.success && result.data) {
      setData(result.data);
      reportRefresh();
    } else {
      const msg = result.error?.message ?? 'Failed to load timeline';
      setError(msg);
      if (!initialLoad.current) reportRefreshError(msg);
    }
  }, [runId, reportRefresh, reportRefreshError]);

  // Initial load + refresh on shared tick
  useEffect(() => {
    if (initialLoad.current) {
      setLoading(true);
      loadTimeline().finally(() => { setLoading(false); initialLoad.current = false; });
    } else {
      loadTimeline();
    }
  }, [loadTimeline, refreshKey]);

  const fetchExecutionDetail = useCallback(async (key: string, iteration: number, agentName: string) => {
    if (fetchingRef.current.has(key)) return;
    fetchingRef.current.add(key);
    const result = await getAgentInvocationDetailAction(runId, iteration, agentName);
    if (result.success && result.data) {
      setExecutionDetails(prev => ({ ...prev, [key]: result.data! }));
    } else {
      setExecutionDetails(prev => ({ ...prev, [key]: null }));
    }
  }, [runId]);

  const toggleExpand = useCallback((iteration: number, agentName: string, hasDetail?: boolean) => {
    const key = `${iteration}-${agentName}`;
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        if (hasDetail) fetchExecutionDetail(key, iteration, agentName);
      }
      return next;
    });
  }, [fetchExecutionDetail]);

  // Auto-expand iterations containing the initialAgent and fetch detail for the first match.
  useEffect(() => {
    if (!initialAgent || !data || initialAgentApplied.current) return;
    initialAgentApplied.current = true;
    const matchingKeys: string[] = [];
    for (const iter of data.iterations) {
      for (const a of iter.agents) {
        if (a.name === initialAgent) {
          matchingKeys.push(`${iter.iteration}-${a.name}`);
        }
      }
    }
    if (matchingKeys.length > 0) {
      setExpandedAgents(new Set(matchingKeys));
      const [firstKey] = matchingKeys;
      const [iterStr] = firstKey.split('-');
      const firstAgent = data.iterations.find(i => i.iteration === Number(iterStr))
        ?.agents.find(a => a.name === initialAgent);
      if (firstAgent?.hasExecutionDetail) {
        fetchExecutionDetail(firstKey, Number(iterStr), initialAgent);
      }
    }
  }, [initialAgent, data, fetchExecutionDetail]);

  return (
    <div className="space-y-6" data-testid="timeline-tab">
      {/* Budget section (self-contained, loads its own data, refreshes via shared context) */}
      <BudgetSection runId={runId} defaultExpanded={initialBudgetExpanded} />

      {/* Timeline iterations */}
      {loading ? (
        <TimelineSkeleton />
      ) : error ? (
        <div className="text-[var(--status-error)] text-sm p-4">{error}</div>
      ) : !data || data.iterations.length === 0 ? (
        <div className="text-[var(--text-muted)] text-sm p-4">No timeline data available</div>
      ) : (() => {
        const transitionSet = new Set(data.phaseTransitions.map(t => t.afterIteration));
        return (
          <div className="space-y-4">
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
                      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                        <span>{iter.agents.length} agents • +{totalVariants} variants • {formatCostDetailed(totalCost)}</span>
                        <Link
                          href={`/admin/quality/evolution/run/${runId}?tab=logs&iteration=${iter.iteration}`}
                          className="text-[var(--accent-gold)] hover:underline"
                          title={`View logs for iteration ${iter.iteration}`}
                        >
                          Logs
                        </Link>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {iter.agents.map((agent) => {
                        const expandKey = `${iter.iteration}-${agent.name}`;
                        const isExpanded = expandedAgents.has(expandKey);

                        return (
                          <div key={expandKey}>
                            <div
                              className="flex items-center justify-between text-xs bg-[var(--surface-secondary)] rounded-page px-3 py-2 cursor-pointer hover:bg-[var(--surface-primary)]"
                              onClick={() => toggleExpand(iter.iteration, agent.name, agent.hasExecutionDetail)}
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
                                  {formatCostDetailed(agent.costUsd)}
                                </span>
                                <Link
                                  href={`/admin/quality/evolution/run/${runId}?tab=logs&iteration=${iter.iteration}&agent=${agent.name}`}
                                  className="text-[var(--accent-gold)] hover:underline ml-1"
                                  onClick={(e) => e.stopPropagation()}
                                  title={`View logs for ${agent.name} in iteration ${iter.iteration}`}
                                >
                                  Logs
                                </Link>
                                <button className="text-[var(--accent-gold)] hover:underline ml-2">
                                  {isExpanded ? 'Hide' : 'Details'}
                                </button>
                              </div>
                            </div>

                            {isExpanded && (
                              <>
                                <AgentDetailPanel agent={agent} runId={runId} />
                                {agent.hasExecutionDetail && (
                                  <div className="mt-2 p-3 bg-[var(--surface-secondary)] rounded-page border border-[var(--border-default)]">
                                    <ExecutionDetailContent detail={executionDetails[expandKey]} runId={runId} />
                                  </div>
                                )}
                              </>
                            )}
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
      })()}
    </div>
  );
}

function TimelineSkeleton(): JSX.Element {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-24 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      ))}
    </div>
  );
}
