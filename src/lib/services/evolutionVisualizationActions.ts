'use server';
// Read-only server actions for evolution pipeline visualization pages.
// Provides aggregated data for dashboard, timeline, Elo, lineage, budget, and comparison views.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { deserializeState } from '@/lib/evolution/core/state';
import { getOrdinal, ordinalToEloScale, createRating } from '@/lib/evolution/core/rating';
import { computeEffectiveBudgetCaps } from '@/lib/evolution/core/budgetRedistribution';
import { DEFAULT_EVOLUTION_CONFIG } from '@/lib/evolution/config';
import type { StrategyConfig } from '@/lib/evolution/core/strategyConfig';
import type {
  PipelinePhase,
  SerializedPipelineState,
  EvolutionRunStatus,
  GenerationStepName,
  AgentExecutionDetail,
} from '@/lib/evolution/types';
import { isOutlineVariant } from '@/lib/evolution/types';
import type { AgentCostBreakdown, EvolutionVariant } from '@/lib/services/evolutionActions';
import { z } from 'zod';

// FE-1: Lightweight Zod schema for SerializedPipelineState system-boundary validation.
// Validates minimum required shape before trusting the cast from DB JSON.
const serializedPipelineStateSchema = z.object({
  iteration: z.number(),
  pool: z.array(z.object({ id: z.string() }).passthrough()),
  ratings: z.record(z.string(), z.object({ mu: z.number(), sigma: z.number() })).optional(),
  eloRatings: z.record(z.string(), z.number()).optional(),
  matchCounts: z.record(z.string(), z.number()).optional(),
}).passthrough();

/** FE-1: Validate + cast checkpoint snapshot to SerializedPipelineState. */
function parseSnapshot(raw: unknown): SerializedPipelineState {
  serializedPipelineStateSchema.parse(raw);
  return raw as SerializedPipelineState;
}

// ─── Types ───────────────────────────────────────────────────────

export interface DashboardData {
  activeRuns: number;
  queueDepth: number;
  successRate7d: number;
  monthlySpend: number;
  runsPerDay: { date: string; completed: number; failed: number; paused: number }[];
  dailySpend: { date: string; amount: number }[];
  recentRuns: DashboardRun[];
  previousMonthSpend: number;
  articlesEvolvedCount: number;
  hallOfFameSize: number;
}

export interface DashboardRun {
  id: string;
  explanation_id: number | null;
  status: EvolutionRunStatus;
  phase: PipelinePhase;
  current_iteration: number;
  total_cost_usd: number;
  budget_cap_usd: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface TimelineData {
  iterations: {
    iteration: number;
    phase: PipelinePhase;
    agents: {
      name: string;
      costUsd: number;
      variantsAdded: number;
      matchesPlayed: number;
      strategy?: string;
      error?: string;
      // New fields for enhanced per-agent detail
      newVariantIds?: string[];
      eloChanges?: Record<string, number>; // variantId → delta
      critiquesAdded?: number;
      debatesAdded?: number;
      diversityScoreAfter?: number | null;
      metaFeedbackPopulated?: boolean;
      skipped?: boolean;
      executionOrder?: number; // 0-based position within iteration
      hasExecutionDetail?: boolean; // true if structured execution detail is available
    }[];
    // New iteration-level totals
    totalCostUsd?: number;
    totalVariantsAdded?: number;
    totalMatchesPlayed?: number;
  }[];
  phaseTransitions: { afterIteration: number; reason: string }[];
}

export interface EloHistoryData {
  variants: {
    id: string;
    shortId: string;
    strategy: string;
    iterationBorn: number;
  }[];
  history: { iteration: number; ratings: Record<string, number> }[];
}

export interface LineageData {
  nodes: {
    id: string;
    shortId: string;
    strategy: string;
    elo: number;
    iterationBorn: number;
    isWinner: boolean;
    /** Tree depth if this variant was produced by tree search (null otherwise). */
    treeDepth?: number | null;
    /** Revision action label if this variant was produced by tree search. */
    revisionAction?: string | null;
  }[];
  edges: { source: string; target: string }[];
  /** Winning revision path node IDs from tree search (for path highlighting). */
  treeSearchPath?: string[];
}

export interface BudgetData {
  agentBreakdown: AgentCostBreakdown[];
  cumulativeBurn: {
    step: number;
    agent: string;
    cumulativeCost: number;
    budgetCap: number;
  }[];
  /** Pre-run cost estimate (null if no estimate was stored at queue time) */
  estimate: {
    totalUsd: number;
    perAgent: Record<string, number>;
    perIteration: number;
    confidence: 'high' | 'medium' | 'low';
  } | null;
  /** Estimated vs actual comparison (null if no prediction was computed) */
  prediction: {
    estimatedUsd: number;
    actualUsd: number;
    deltaUsd: number;
    deltaPercent: number;
    confidence: 'high' | 'medium' | 'low';
    perAgent: Record<string, { estimated: number; actual: number }>;
  } | null;
  /** Per-agent budget caps in dollar amounts (effective, post-redistribution) */
  agentBudgetCaps: Record<string, number>;
  /** Run status for auto-refresh logic (avoids adding a prop to BudgetTab) */
  runStatus: string;
}

export interface TreeSearchData {
  trees: {
    rootNodeId: string;
    nodes: {
      id: string;
      variantId: string;
      parentNodeId: string | null;
      depth: number;
      revisionAction: { type: string; dimension?: string; description: string };
      value: number;
      pruned: boolean;
    }[];
    result: {
      bestLeafNodeId: string;
      treeSize: number;
      maxDepth: number;
      prunedBranches: number;
      revisionPath: { type: string; dimension?: string; description: string }[];
    };
  }[];
}

export interface ComparisonData {
  originalText: string;
  winnerText: string | null;
  winnerStrategy: string | null;
  winnerElo: number | null;
  eloImprovement: number | null;
  qualityScores: { dimension: string; before: number; after: number }[] | null;
  totalIterations: number;
  totalCost: number;
  variantsExplored: number;
  generationDepth: number;
}

// ─── Helpers ────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateRunId(runId: string): void {
  if (!UUID_REGEX.test(runId)) {
    throw new Error(`Invalid run ID format: ${runId}`);
  }
}

type ActionResult<T> = { success: boolean; data: T | null; error: ErrorResponse | null };

// ─── 1. Dashboard ───────────────────────────────────────────────

const _getEvolutionDashboardDataAction = withLogging(async (): Promise<ActionResult<DashboardData>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Parallel queries
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const firstOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

    const [activeRes, queueRes, last7dRes, monthSpendRes, last30dRes, recentRes, prevMonthSpendRes, evolvedRes, bankRes] = await Promise.all([
      supabase.from('content_evolution_runs').select('id', { count: 'exact', head: true }).in('status', ['running', 'claimed']),
      supabase.from('content_evolution_runs').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('content_evolution_runs').select('status, created_at').gte('created_at', sevenDaysAgo).in('status', ['completed', 'failed', 'paused']),
      supabase.from('content_evolution_runs').select('total_cost_usd').gte('created_at', firstOfMonth),
      supabase.from('content_evolution_runs').select('status, total_cost_usd, created_at').gte('created_at', thirtyDaysAgo),
      supabase.from('content_evolution_runs').select('id, explanation_id, status, phase, current_iteration, total_cost_usd, budget_cap_usd, started_at, completed_at, created_at').order('created_at', { ascending: false }).limit(20),
      supabase.from('content_evolution_runs').select('total_cost_usd').gte('created_at', firstOfPreviousMonth).lt('created_at', firstOfMonth),
      supabase.from('content_evolution_runs').select('explanation_id').eq('status', 'completed'),
      supabase.from('hall_of_fame_entries').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    ]);

    const activeRuns = activeRes.count ?? 0;
    const queueDepth = queueRes.count ?? 0;

    // 7d success rate
    const last7d = last7dRes.data ?? [];
    const completed7d = last7d.filter(r => r.status === 'completed').length;
    const total7d = last7d.length;
    const successRate7d = total7d > 0 ? Math.round((completed7d / total7d) * 100) : 0;

    // Monthly spend
    const monthlySpend = (monthSpendRes.data ?? []).reduce((sum, r) => sum + (r.total_cost_usd ?? 0), 0);

    // Previous month spend (for trend comparison)
    const previousMonthSpend = (prevMonthSpendRes.data ?? []).reduce((sum, r) => sum + (r.total_cost_usd ?? 0), 0);

    // Articles with completed evolution runs (deduplicate explanation_ids)
    const articlesEvolvedCount = new Set((evolvedRes.data ?? []).map(r => r.explanation_id)).size;

    // Hall of Fame size
    const hallOfFameSize = bankRes.count ?? 0;

    // Runs per day (last 30d)
    const dayMap = new Map<string, { completed: number; failed: number; paused: number }>();
    for (const r of last30dRes.data ?? []) {
      const day = r.created_at.substring(0, 10);
      const entry = dayMap.get(day) ?? { completed: 0, failed: 0, paused: 0 };
      if (r.status === 'completed') entry.completed++;
      else if (r.status === 'failed') entry.failed++;
      else if (r.status === 'paused') entry.paused++;
      dayMap.set(day, entry);
    }
    const runsPerDay = Array.from(dayMap.entries())
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Daily spend (last 30d)
    const spendMap = new Map<string, number>();
    for (const r of last30dRes.data ?? []) {
      const day = r.created_at.substring(0, 10);
      spendMap.set(day, (spendMap.get(day) ?? 0) + (r.total_cost_usd ?? 0));
    }
    const dailySpend = Array.from(spendMap.entries())
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      success: true,
      data: {
        activeRuns,
        queueDepth,
        successRate7d,
        monthlySpend,
        runsPerDay,
        dailySpend,
        recentRuns: (recentRes.data ?? []) as DashboardRun[],
        previousMonthSpend,
        articlesEvolvedCount,
        hallOfFameSize,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionDashboardDataAction') };
  }
}, 'getEvolutionDashboardDataAction');

export const getEvolutionDashboardDataAction = serverReadRequestId(_getEvolutionDashboardDataAction);

// ─── 2. Run Timeline ────────────────────────────────────────────

/** Metrics computed by diffing sequential checkpoints. */
interface AgentDiffMetrics {
  variantsAdded: number;
  newVariantIds: string[];
  matchesPlayed: number;
  eloChanges: Record<string, number>;
  critiquesAdded: number;
  debatesAdded: number;
  diversityScoreAfter: number | null;
  metaFeedbackPopulated: boolean;
}

function computeEloDelta(
  before: Record<string, number>,
  after: Record<string, number>
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(after)
      .map(([id, newElo]) => [id, newElo - (before[id] ?? 1200)])
      .filter(([, delta]) => delta !== 0)
  );
}

function diffCheckpoints(
  before: SerializedPipelineState | null,
  after: SerializedPipelineState
): AgentDiffMetrics {
  const beforePoolIds = new Set(before?.pool?.map(v => v.id) ?? []);
  const newVariantIds = (after.pool ?? [])
    .filter(v => !beforePoolIds.has(v.id))
    .map(v => v.id);

  return {
    variantsAdded: newVariantIds.length,
    newVariantIds,
    matchesPlayed: Math.max(0, (after.matchHistory?.length ?? 0) - (before?.matchHistory?.length ?? 0)),
    eloChanges: computeEloDelta(before?.eloRatings ?? {}, after.eloRatings ?? {}),
    critiquesAdded: Math.max(0, (after.allCritiques?.length ?? 0) - (before?.allCritiques?.length ?? 0)),
    debatesAdded: Math.max(0, (after.debateTranscripts?.length ?? 0) - (before?.debateTranscripts?.length ?? 0)),
    diversityScoreAfter: after.diversityScore ?? null,
    metaFeedbackPopulated: before?.metaFeedback === null && after.metaFeedback !== null,
  };
}

/** Checkpoint row with timestamp for cost attribution. */
interface CheckpointRow {
  iteration: number;
  phase: PipelinePhase;
  last_agent: string;
  state_snapshot: SerializedPipelineState;
  created_at: string;
}

const _getEvolutionRunTimelineAction = withLogging(async (
  runId: string
): Promise<ActionResult<TimelineData>> => {
  try {
    await requireAdmin();
    validateRunId(runId);
    const supabase = await createSupabaseServiceClient();

    // Load ALL checkpoints per iteration (not just the last) with timestamps
    const { data: checkpoints, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('iteration, phase, last_agent, state_snapshot, created_at')
      .eq('run_id', runId)
      .order('iteration', { ascending: true })
      .order('created_at', { ascending: true }); // ASC for correct execution order

    if (cpError) throw cpError;

    // Group all checkpoints per iteration, preserving execution order
    const iterationGroups = new Map<number, CheckpointRow[]>();
    for (const cp of (checkpoints ?? []) as CheckpointRow[]) {
      const group = iterationGroups.get(cp.iteration) ?? [];
      group.push(cp);
      iterationGroups.set(cp.iteration, group);
    }

    const { data: costInvocations } = await supabase
      .from('evolution_agent_invocations')
      .select('iteration, agent_name, cost_usd')
      .eq('run_id', runId)
      .order('iteration', { ascending: true })
      .order('execution_order', { ascending: true });

    const costMap = new Map<string, number>();
    const prevCostByAgent = new Map<string, number>();
    const invocationSet = new Set<string>();
    for (const inv of costInvocations ?? []) {
      const agent = inv.agent_name as string;
      const cost = Number(inv.cost_usd) || 0;
      const prev = prevCostByAgent.get(agent) ?? 0;
      prevCostByAgent.set(agent, cost);
      costMap.set(`${inv.iteration}-${agent}`, cost - prev);
      invocationSet.add(`${inv.iteration}-${agent}`);
    }

    const sortedIterations = Array.from(iterationGroups.entries()).sort((a, b) => a[0] - b[0]);
    const iterations: TimelineData['iterations'] = [];
    let prevIterationFinalSnapshot: SerializedPipelineState | null = null;

    for (const [iteration, checkpointGroup] of sortedIterations) {
      const phase = checkpointGroup[0]?.phase ?? 'EXPANSION';
      const agents: TimelineData['iterations'][number]['agents'] = [];
      let prevSnapshotInIteration: SerializedPipelineState | null = prevIterationFinalSnapshot;

      for (let i = 0; i < checkpointGroup.length; i++) {
        const cp = checkpointGroup[i];
        const diff = diffCheckpoints(prevSnapshotInIteration, cp.state_snapshot);

        agents.push({
          name: cp.last_agent,
          costUsd: costMap.get(`${iteration}-${cp.last_agent}`) ?? 0,
          variantsAdded: diff.variantsAdded,
          matchesPlayed: diff.matchesPlayed,
          newVariantIds: diff.newVariantIds,
          eloChanges: Object.keys(diff.eloChanges).length > 0 ? diff.eloChanges : undefined,
          critiquesAdded: diff.critiquesAdded > 0 ? diff.critiquesAdded : undefined,
          debatesAdded: diff.debatesAdded > 0 ? diff.debatesAdded : undefined,
          diversityScoreAfter: diff.diversityScoreAfter,
          metaFeedbackPopulated: diff.metaFeedbackPopulated || undefined,
          executionOrder: i,
        });

        prevSnapshotInIteration = cp.state_snapshot;
      }

      iterations.push({
        iteration,
        phase,
        agents,
        totalCostUsd: agents.reduce((sum, a) => sum + a.costUsd, 0),
        totalVariantsAdded: agents.reduce((sum, a) => sum + a.variantsAdded, 0),
        totalMatchesPlayed: agents.reduce((sum, a) => sum + a.matchesPlayed, 0),
      });

      prevIterationFinalSnapshot = checkpointGroup[checkpointGroup.length - 1]?.state_snapshot ?? null;
    }

    const phaseTransitions: TimelineData['phaseTransitions'] = [];
    for (let i = 1; i < iterations.length; i++) {
      if (iterations[i].phase !== iterations[i - 1].phase) {
        phaseTransitions.push({
          afterIteration: iterations[i - 1].iteration,
          reason: `Transition to ${iterations[i].phase}`,
        });
      }
    }

    for (const iter of iterations) {
      for (const agent of iter.agents) {
        agent.hasExecutionDetail = invocationSet.has(`${iter.iteration}-${agent.name}`);
      }
    }

    return { success: true, data: { iterations, phaseTransitions }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionRunTimelineAction', { runId }) };
  }
}, 'getEvolutionRunTimelineAction');

export const getEvolutionRunTimelineAction = serverReadRequestId(_getEvolutionRunTimelineAction);

// ─── 3. Elo History ─────────────────────────────────────────────

const _getEvolutionRunEloHistoryAction = withLogging(async (
  runId: string
): Promise<ActionResult<EloHistoryData>> => {
  try {
    await requireAdmin();
    validateRunId(runId);
    const supabase = await createSupabaseServiceClient();

    const { data: checkpoints, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('iteration, state_snapshot')
      .eq('run_id', runId)
      .order('iteration', { ascending: true })
      .order('created_at', { ascending: false });

    if (cpError) throw cpError;

    const iterationMap = new Map<number, SerializedPipelineState>();
    for (const cp of (checkpoints ?? [])) {
      if (!iterationMap.has(cp.iteration)) {
        // FE-1: Validate checkpoint shape before trusting the cast
        iterationMap.set(cp.iteration, parseSnapshot(cp.state_snapshot));
      }
    }

    const history: EloHistoryData['history'] = [];
    for (const [iteration, snapshot] of Array.from(iterationMap.entries()).sort((a, b) => a[0] - b[0])) {
      if (snapshot.ratings && Object.keys(snapshot.ratings).length > 0) {
        const converted: Record<string, number> = {};
        for (const [id, r] of Object.entries(snapshot.ratings)) {
          converted[id] = ordinalToEloScale(getOrdinal(r as { mu: number; sigma: number }));
        }
        history.push({ iteration, ratings: converted });
      } else if (snapshot.eloRatings) {
        history.push({ iteration, ratings: snapshot.eloRatings });
      }
    }

    const latestSnapshot = Array.from(iterationMap.values()).pop();
    const variants: EloHistoryData['variants'] = (latestSnapshot?.pool ?? []).map(v => ({
      id: v.id,
      shortId: v.id.substring(0, 8),
      strategy: v.strategy,
      iterationBorn: v.iterationBorn,
    }));

    return { success: true, data: { variants, history }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionRunEloHistoryAction', { runId }) };
  }
}, 'getEvolutionRunEloHistoryAction');

export const getEvolutionRunEloHistoryAction = serverReadRequestId(_getEvolutionRunEloHistoryAction);

// ─── 4. Lineage ─────────────────────────────────────────────────

const _getEvolutionRunLineageAction = withLogging(async (
  runId: string
): Promise<ActionResult<LineageData>> => {
  try {
    await requireAdmin();
    validateRunId(runId);
    const supabase = await createSupabaseServiceClient();

    const { data: latestCp, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('state_snapshot')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (cpError) throw cpError;

    // FE-1: Validate checkpoint shape before trusting the cast
    const snapshot = parseSnapshot(latestCp.state_snapshot);
    const state = deserializeState(snapshot);

    const { data: dbWinner } = await supabase
      .from('content_evolution_variants')
      .select('variant_content')
      .eq('run_id', runId)
      .eq('is_winner', true)
      .limit(1)
      .maybeSingle();

    const winnerText = dbWinner?.variant_content ?? null;

    const treeStates = state.treeSearchStates ?? [];
    const treeResults = state.treeSearchResults ?? [];

    const treeNodeByVariant = new Map<string, { depth: number; action: string }>();
    for (const ts of treeStates) {
      for (const node of Object.values(ts.nodes)) {
        treeNodeByVariant.set(node.variantId, {
          depth: node.depth,
          action: node.revisionAction.description,
        });
      }
    }

    const treeSearchPath: string[] = [];
    for (let i = 0; i < treeResults.length; i++) {
      const result = treeResults[i];
      const ts = treeStates[i];
      if (!result || !ts) continue;
      let nodeId: string | null = result.bestLeafNodeId;
      while (nodeId) {
        const treeNode: { variantId: string; parentNodeId: string | null } | undefined = ts.nodes[nodeId];
        if (treeNode) {
          treeSearchPath.push(treeNode.variantId);
          nodeId = treeNode.parentNodeId;
        } else {
          break;
        }
      }
    }

    const nodes: LineageData['nodes'] = state.pool.map(v => {
      const treeInfo = treeNodeByVariant.get(v.id);
      return {
        id: v.id,
        shortId: v.id.substring(0, 8),
        strategy: v.strategy,
        elo: ordinalToEloScale(getOrdinal(state.ratings.get(v.id) ?? createRating())),
        iterationBorn: v.iterationBorn,
        isWinner: winnerText !== null && v.text === winnerText,
        treeDepth: treeInfo?.depth ?? null,
        revisionAction: treeInfo?.action ?? null,
      };
    });

    const edges: LineageData['edges'] = state.pool.flatMap(v =>
      v.parentIds.map(parentId => ({ source: parentId, target: v.id }))
    );

    return {
      success: true,
      data: { nodes, edges, treeSearchPath: treeSearchPath.length > 0 ? treeSearchPath : undefined },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionRunLineageAction', { runId }) };
  }
}, 'getEvolutionRunLineageAction');

export const getEvolutionRunLineageAction = serverReadRequestId(_getEvolutionRunLineageAction);

// ─── 5. Budget ──────────────────────────────────────────────────

const _getEvolutionRunBudgetAction = withLogging(async (
  runId: string
): Promise<ActionResult<BudgetData>> => {
  try {
    await requireAdmin();
    validateRunId(runId);
    const supabase = await createSupabaseServiceClient();

    // Get run time window, budget, cost estimate, config, and status
    const { data: run, error: runError } = await supabase
      .from('content_evolution_runs')
      .select('started_at, completed_at, budget_cap_usd, cost_estimate_detail, cost_prediction, config, status')
      .eq('id', runId)
      .single();

    if (runError || !run) throw new Error(`Run ${runId} not found`);

    const { data: invocations, error: invError } = await supabase
      .from('evolution_agent_invocations')
      .select('agent_name, cost_usd, iteration, execution_order')
      .eq('run_id', runId)
      .order('iteration', { ascending: true })
      .order('execution_order', { ascending: true });

    if (invError) throw invError;

    const prevCost = new Map<string, number>();
    const agentMap = new Map<string, { invocations: number; maxCost: number }>();
    const cumulativeBurn: BudgetData['cumulativeBurn'] = [];
    let cumulative = 0;

    for (const inv of invocations ?? []) {
      const agent = inv.agent_name as string;
      const cost = Number(inv.cost_usd) || 0;

      const entry = agentMap.get(agent) ?? { invocations: 0, maxCost: 0 };
      entry.invocations += 1;
      entry.maxCost = Math.max(entry.maxCost, cost);
      agentMap.set(agent, entry);

      const prev = prevCost.get(agent) ?? 0;
      const delta = cost - prev;
      prevCost.set(agent, cost);

      cumulative += delta;
      cumulativeBurn.push({
        step: cumulativeBurn.length + 1,
        agent,
        cumulativeCost: cumulative,
        budgetCap: run.budget_cap_usd ?? 5,
      });
    }

    const agentBreakdown: AgentCostBreakdown[] = Array.from(agentMap.entries())
      .map(([agent, { invocations: count, maxCost }]) => ({ agent, calls: count, costUsd: maxCost }))
      .sort((a, b) => b.costUsd - a.costUsd);

    const estimate = (run.cost_estimate_detail as BudgetData['estimate']) ?? null;
    const prediction = (run.cost_prediction as BudgetData['prediction']) ?? null;

    // Compute per-agent budget caps in dollar amounts from strategy config
    const config = run.config as StrategyConfig | null;
    const budgetCapUsd = run.budget_cap_usd ?? 5;
    let agentBudgetCaps: Record<string, number> = {};
    if (config?.budgetCaps) {
      const effectivePcts = computeEffectiveBudgetCaps(
        { ...DEFAULT_EVOLUTION_CONFIG.budgetCaps, ...config.budgetCaps },
        config.enabledAgents,
        !!config.singleArticle,
      );
      agentBudgetCaps = Object.fromEntries(
        Object.entries(effectivePcts).map(([agent, pct]) => [agent, pct * budgetCapUsd]),
      );
    }

    const runStatus = (run.status as string) ?? 'unknown';

    return { success: true, data: { agentBreakdown, cumulativeBurn, estimate, prediction, agentBudgetCaps, runStatus }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionRunBudgetAction', { runId }) };
  }
}, 'getEvolutionRunBudgetAction');

export const getEvolutionRunBudgetAction = serverReadRequestId(_getEvolutionRunBudgetAction);

// ─── 6. Comparison ──────────────────────────────────────────────

const _getEvolutionRunComparisonAction = withLogging(async (
  runId: string
): Promise<ActionResult<ComparisonData>> => {
  try {
    await requireAdmin();
    validateRunId(runId);
    const supabase = await createSupabaseServiceClient();

    const { data: run, error: runError } = await supabase
      .from('content_evolution_runs')
      .select('explanation_id, total_cost_usd, current_iteration, budget_cap_usd')
      .eq('id', runId)
      .single();

    if (runError || !run) throw new Error(`Run ${runId} not found`);

    const { data: latestCp } = await supabase
      .from('evolution_checkpoints')
      .select('state_snapshot')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // FE-1: Validate checkpoint shape; null-safe for maybeSingle()
    const snapshot = latestCp?.state_snapshot
      ? parseSnapshot(latestCp.state_snapshot)
      : null;
    const originalText = snapshot?.originalText ?? '';
    const pool = snapshot?.pool ?? [];
    const allCritiques = snapshot?.allCritiques ?? null;

    const { data: dbWinner } = await supabase
      .from('content_evolution_variants')
      .select('variant_content, agent_name, elo_score')
      .eq('run_id', runId)
      .eq('is_winner', true)
      .limit(1)
      .maybeSingle();

    const winnerElo = dbWinner?.elo_score ?? null;
    const eloImprovement = winnerElo !== null ? winnerElo - 1200 : null;

    let qualityScores: ComparisonData['qualityScores'] = null;
    if (allCritiques && allCritiques.length > 0) {
      const dimensions = new Set<string>();
      for (const c of allCritiques) {
        if (c.dimensionScores) {
          Object.keys(c.dimensionScores).forEach(d => dimensions.add(d));
        }
      }
      if (dimensions.size > 0) {
        qualityScores = Array.from(dimensions).map(dim => {
          const scores = allCritiques
            .filter(c => c.dimensionScores?.[dim] !== undefined)
            .map(c => c.dimensionScores[dim]);
          return { dimension: dim, before: scores[0] ?? 0, after: scores[scores.length - 1] ?? 0 };
        });
      }
    }

    const generationDepth = pool.reduce((max, v) => Math.max(max, v.version), 0);

    return {
      success: true,
      data: {
        originalText,
        winnerText: dbWinner?.variant_content ?? null,
        winnerStrategy: dbWinner?.agent_name ?? null,
        winnerElo,
        eloImprovement,
        qualityScores,
        totalIterations: run.current_iteration ?? 0,
        totalCost: run.total_cost_usd ?? 0,
        variantsExplored: pool.length,
        generationDepth,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionRunComparisonAction', { runId }) };
  }
}, 'getEvolutionRunComparisonAction');

export const getEvolutionRunComparisonAction = serverReadRequestId(_getEvolutionRunComparisonAction);

// ─── 7. Variant Step Scores ─────────────────────────────────────

/** Step score data for outline variants, keyed by variant ID. */
export interface VariantStepData {
  variantId: string;
  steps: Array<{ name: GenerationStepName; score: number; costUsd: number }>;
  outline: string;
  weakestStep: GenerationStepName | null;
}

const _getEvolutionRunStepScoresAction = withLogging(async (
  runId: string
): Promise<ActionResult<VariantStepData[]>> => {
  try {
    await requireAdmin();
    validateRunId(runId);
    const supabase = await createSupabaseServiceClient();

    const { data: latestCp, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('state_snapshot')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (cpError) throw cpError;

    // FE-1: Validate checkpoint shape before trusting the cast
    const snapshot = parseSnapshot(latestCp.state_snapshot);
    const state = deserializeState(snapshot);

    const stepDataList: VariantStepData[] = [];
    for (const v of state.pool) {
      if (isOutlineVariant(v)) {
        stepDataList.push({
          variantId: v.id,
          steps: v.steps.map(s => ({ name: s.name, score: s.score, costUsd: s.costUsd })),
          outline: v.outline,
          weakestStep: v.weakestStep,
        });
      }
    }

    return { success: true, data: stepDataList, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionRunStepScoresAction', { runId }) };
  }
}, 'getEvolutionRunStepScoresAction');

export const getEvolutionRunStepScoresAction = serverReadRequestId(_getEvolutionRunStepScoresAction);

// ─── 8. Tree Search ─────────────────────────────────────────────

const _getEvolutionRunTreeSearchAction = withLogging(async (
  runId: string
): Promise<ActionResult<TreeSearchData>> => {
  try {
    await requireAdmin();
    validateRunId(runId);
    const supabase = await createSupabaseServiceClient();

    const { data: latestCp, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('state_snapshot')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (cpError) throw cpError;

    // FE-1: Validate checkpoint shape before trusting the cast
    const snapshot = parseSnapshot(latestCp.state_snapshot);
    const treeStates = snapshot.treeSearchStates ?? [];
    const treeResults = snapshot.treeSearchResults ?? [];

    if (treeStates.length === 0) {
      return { success: true, data: { trees: [] }, error: null };
    }

    const trees: TreeSearchData['trees'] = [];
    for (let i = 0; i < treeStates.length; i++) {
      const ts = treeStates[i];
      const result = treeResults[i];
      if (!ts || !result) continue;

      trees.push({
        rootNodeId: ts.rootNodeId,
        nodes: Object.values(ts.nodes).map((n) => ({
          id: n.id,
          variantId: n.variantId,
          parentNodeId: n.parentNodeId,
          depth: n.depth,
          revisionAction: { type: n.revisionAction.type, dimension: n.revisionAction.dimension, description: n.revisionAction.description },
          value: n.value,
          pruned: n.pruned,
        })),
        result: {
          bestLeafNodeId: result.bestLeafNodeId,
          treeSize: result.treeSize,
          maxDepth: result.maxDepth,
          prunedBranches: result.prunedBranches,
          revisionPath: result.revisionPath,
        },
      });
    }

    return { success: true, data: { trees }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionRunTreeSearchAction', { runId }) };
  }
}, 'getEvolutionRunTreeSearchAction');

export const getEvolutionRunTreeSearchAction = serverReadRequestId(_getEvolutionRunTreeSearchAction);

// ─── 9. Checkpoint-based variant fallback ────────────────────────

/**
 * Reconstruct EvolutionVariant[] from the latest checkpoint when the DB table
 * (content_evolution_variants) has no rows — e.g. for running, failed, or paused runs.
 * Not a server action (no withLogging/serverReadRequestId) since it's called from
 * getEvolutionVariantsAction which already handles auth/logging.
 */
export async function buildVariantsFromCheckpoint(
  runId: string
): Promise<ActionResult<EvolutionVariant[]>> {
  try {
    validateRunId(runId);
    const supabase = await createSupabaseServiceClient();

    const [cpResult, runResult] = await Promise.all([
      supabase
        .from('evolution_checkpoints')
        .select('state_snapshot')
        .eq('run_id', runId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('content_evolution_runs')
        .select('explanation_id')
        .eq('id', runId)
        .single(),
    ]);

    if (cpResult.error) throw cpResult.error;
    if (runResult.error) throw runResult.error;
    if (!cpResult.data) {
      return { success: true, data: [], error: null };
    }

    // FE-1: Validate checkpoint shape before trusting the cast
    const snapshot = parseSnapshot(cpResult.data.state_snapshot);
    const explanationId = runResult.data?.explanation_id ?? null;
    const pool = snapshot.pool ?? [];
    const matchCounts = snapshot.matchCounts ?? {};

    const eloLookup = buildEloLookup(snapshot);

    const variants: EvolutionVariant[] = pool.map(v => ({
      id: v.id,
      run_id: runId,
      explanation_id: explanationId,
      variant_content: v.text,
      elo_score: eloLookup[v.id] ?? 1200,
      generation: v.version,
      agent_name: v.strategy,
      match_count: matchCounts[v.id] ?? 0,
      is_winner: false,
      created_at: new Date(v.createdAt).toISOString(),
    }));

    variants.sort((a, b) => b.elo_score - a.elo_score);

    return { success: true, data: variants, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'buildVariantsFromCheckpoint', { runId }) };
  }
}

/** Build an Elo lookup from either new {mu,sigma} ratings or legacy eloRatings. */
function buildEloLookup(snapshot: SerializedPipelineState): Record<string, number> {
  // Prefer new format: convert {mu, sigma} → Elo scale
  if (snapshot.ratings && Object.keys(snapshot.ratings).length > 0) {
    return Object.fromEntries(
      Object.entries(snapshot.ratings).map(([id, r]) => [
        id,
        ordinalToEloScale(getOrdinal(r as { mu: number; sigma: number })),
      ]),
    );
  }

  // Fallback: legacy raw Elo numbers
  if (snapshot.eloRatings && Object.keys(snapshot.eloRatings).length > 0) {
    return snapshot.eloRatings;
  }

  return {};
}

// ─── Agent Invocation Detail ────────────────────────────────────

/** Row shape returned by invocation queries (base fields + typed execution detail). */
export interface AgentInvocationRow {
  id: string;
  run_id: string;
  iteration: number;
  agent_name: string;
  execution_order: number;
  success: boolean;
  cost_usd: number;
  skipped: boolean;
  error_message: string | null;
  execution_detail: AgentExecutionDetail | Record<string, never>;
  created_at: string;
}

/** Fetch typed execution detail for a single agent invocation. */
const _getAgentInvocationDetailAction = withLogging(async (
  runId: string,
  iteration: number,
  agentName: string,
): Promise<ActionResult<AgentExecutionDetail | null>> => {
  try {
    await requireAdmin();
    validateRunId(runId);
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('evolution_agent_invocations')
      .select('execution_detail')
      .eq('run_id', runId)
      .eq('iteration', iteration)
      .eq('agent_name', agentName)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No row found — not an error, just no detail available
        return { success: true, data: null, error: null };
      }
      throw error;
    }

    const detail = data?.execution_detail as AgentExecutionDetail | Record<string, never> | null;
    if (!detail || !('detailType' in detail)) {
      return { success: true, data: null, error: null };
    }

    return { success: true, data: detail as AgentExecutionDetail, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getAgentInvocationDetailAction', { runId, iteration, agentName }) };
  }
}, 'getAgentInvocationDetailAction');

export const getAgentInvocationDetailAction = serverReadRequestId(_getAgentInvocationDetailAction);

/** Fetch all agent invocations for a given iteration (batch load for timeline expand). */
const _getIterationInvocationsAction = withLogging(async (
  runId: string,
  iteration: number,
): Promise<ActionResult<AgentInvocationRow[]>> => {
  try {
    await requireAdmin();
    validateRunId(runId);
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('evolution_agent_invocations')
      .select('*')
      .eq('run_id', runId)
      .eq('iteration', iteration)
      .order('execution_order', { ascending: true });

    if (error) throw error;

    return { success: true, data: (data ?? []) as AgentInvocationRow[], error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getIterationInvocationsAction', { runId, iteration }) };
  }
}, 'getIterationInvocationsAction');

export const getIterationInvocationsAction = serverReadRequestId(_getIterationInvocationsAction);

/** Fetch all invocations for a specific agent across all iterations (explorer drill-down). */
const _getAgentInvocationsForRunAction = withLogging(async (
  runId: string,
  agentName: string,
): Promise<ActionResult<AgentInvocationRow[]>> => {
  try {
    await requireAdmin();
    validateRunId(runId);
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('evolution_agent_invocations')
      .select('*')
      .eq('run_id', runId)
      .eq('agent_name', agentName)
      .order('iteration', { ascending: true });

    if (error) throw error;

    return { success: true, data: (data ?? []) as AgentInvocationRow[], error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getAgentInvocationsForRunAction', { runId, agentName }) };
  }
}, 'getAgentInvocationsForRunAction');

export const getAgentInvocationsForRunAction = serverReadRequestId(_getAgentInvocationsForRunAction);
