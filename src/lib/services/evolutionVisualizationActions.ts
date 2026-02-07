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
import type {
  PipelinePhase,
  SerializedPipelineState,
  EvolutionRunStatus,
  GenerationStepName,
} from '@/lib/evolution/types';
import { isOutlineVariant } from '@/lib/evolution/types';
import type { AgentCostBreakdown } from '@/lib/services/evolutionActions';

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
  articleBankSize: number;
}

export interface DashboardRun {
  id: string;
  explanation_id: number;
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
      supabase.from('article_bank_entries').select('id', { count: 'exact', head: true }).is('deleted_at', null),
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

    // Article bank size
    const articleBankSize = bankRes.count ?? 0;

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
        articleBankSize,
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

/** Compute Elo delta between two rating snapshots. */
function computeEloDelta(
  before: Record<string, number>,
  after: Record<string, number>
): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const [id, newElo] of Object.entries(after)) {
    const oldElo = before[id] ?? 1200; // new variants start at 1200
    if (newElo !== oldElo) {
      delta[id] = newElo - oldElo;
    }
  }
  return delta;
}

/** Diff sequential checkpoints to compute per-agent metrics. */
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

    // Load run metadata for cost attribution time window
    const { data: run } = await supabase
      .from('content_evolution_runs')
      .select('started_at, completed_at')
      .eq('id', runId)
      .single();

    // Build checkpoint time boundaries for cost attribution
    type TimeBoundary = { iteration: number; agent: string; startTime: string; endTime: string };
    const boundaries: TimeBoundary[] = [];
    const allCheckpointsSorted = Array.from(iterationGroups.values())
      .flat()
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    for (let i = 0; i < allCheckpointsSorted.length; i++) {
      const cp = allCheckpointsSorted[i];
      const nextCp = allCheckpointsSorted[i + 1];
      boundaries.push({
        iteration: cp.iteration,
        agent: cp.last_agent,
        startTime: i === 0 ? (run?.started_at ?? cp.created_at) : allCheckpointsSorted[i - 1].created_at,
        endTime: nextCp?.created_at ?? run?.completed_at ?? cp.created_at,
      });
    }

    // Load LLM calls for cost attribution
    const costMap = new Map<string, number>(); // "iteration-agent" → cost
    if (run?.started_at) {
      let costQuery = supabase
        .from('llmCallTracking')
        .select('call_source, estimated_cost_usd, created_at')
        .like('call_source', 'evolution_%')
        .gte('created_at', run.started_at);
      if (run.completed_at) {
        costQuery = costQuery.lte('created_at', run.completed_at);
      }
      const { data: costData } = await costQuery;

      for (const call of costData ?? []) {
        const callTime = call.created_at as string;
        const callAgent = (call.call_source as string).replace(/^evolution_/, '');
        const callCost = (call.estimated_cost_usd as number) ?? 0;

        // Find boundary by time and agent name match
        const boundary = boundaries.find(b =>
          callTime >= b.startTime &&
          callTime <= b.endTime &&
          callAgent.toLowerCase().includes(b.agent.toLowerCase().replace(/_/g, ''))
        );
        if (boundary) {
          const key = `${boundary.iteration}-${boundary.agent}`;
          costMap.set(key, (costMap.get(key) ?? 0) + callCost);
        } else {
          // Fallback: attribute to first boundary where agent name matches
          const fallback = boundaries.find(b =>
            callAgent.toLowerCase().includes(b.agent.toLowerCase().replace(/_/g, ''))
          );
          if (fallback) {
            const key = `${fallback.iteration}-${fallback.agent}`;
            costMap.set(key, (costMap.get(key) ?? 0) + callCost);
          }
        }
      }
    }

    // Build timeline with per-agent metrics via checkpoint diffing
    const sortedIterations = Array.from(iterationGroups.entries()).sort((a, b) => a[0] - b[0]);
    const iterations: TimelineData['iterations'] = [];
    let prevIterationFinalSnapshot: SerializedPipelineState | null = null;

    for (const [iteration, checkpointGroup] of sortedIterations) {
      // Use the phase from checkpoint (more reliable than pool size heuristic)
      const phase = checkpointGroup[0]?.phase ?? 'EXPANSION';
      const agents: TimelineData['iterations'][number]['agents'] = [];
      let prevSnapshotInIteration: SerializedPipelineState | null = prevIterationFinalSnapshot;

      for (let i = 0; i < checkpointGroup.length; i++) {
        const cp = checkpointGroup[i];
        const diff = diffCheckpoints(prevSnapshotInIteration, cp.state_snapshot);
        const costKey = `${iteration}-${cp.last_agent}`;

        agents.push({
          name: cp.last_agent,
          costUsd: costMap.get(costKey) ?? 0,
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

      // Compute iteration totals
      const totalCostUsd = agents.reduce((sum, a) => sum + a.costUsd, 0);
      const totalVariantsAdded = agents.reduce((sum, a) => sum + a.variantsAdded, 0);
      const totalMatchesPlayed = agents.reduce((sum, a) => sum + a.matchesPlayed, 0);

      iterations.push({
        iteration,
        phase,
        agents,
        totalCostUsd,
        totalVariantsAdded,
        totalMatchesPlayed,
      });

      // Track final snapshot of this iteration for next iteration's first diff
      prevIterationFinalSnapshot = checkpointGroup[checkpointGroup.length - 1]?.state_snapshot ?? null;
    }

    // Detect phase transitions
    const phaseTransitions: TimelineData['phaseTransitions'] = [];
    for (let i = 1; i < iterations.length; i++) {
      if (iterations[i].phase !== iterations[i - 1].phase) {
        phaseTransitions.push({
          afterIteration: iterations[i - 1].iteration,
          reason: `Transition to ${iterations[i].phase}`,
        });
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

    // Use JSONB extraction to avoid deserializing full snapshots
    const { data: checkpoints, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('iteration, state_snapshot')
      .eq('run_id', runId)
      .order('iteration', { ascending: true })
      .order('created_at', { ascending: false });

    if (cpError) throw cpError;

    // De-duplicate: keep only the last checkpoint per iteration
    const iterationMap = new Map<number, SerializedPipelineState>();
    for (const cp of (checkpoints ?? [])) {
      if (!iterationMap.has(cp.iteration)) {
        iterationMap.set(cp.iteration, cp.state_snapshot as SerializedPipelineState);
      }
    }

    // Build history
    const history: EloHistoryData['history'] = [];
    for (const [iteration, snapshot] of Array.from(iterationMap.entries()).sort((a, b) => a[0] - b[0])) {
      // Handle both new ratings format ({mu, sigma}) and legacy eloRatings (raw numbers)
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

    // Get variant metadata from latest checkpoint
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

    // Load only the latest checkpoint for full pool data
    const { data: latestCp, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('state_snapshot')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (cpError) throw cpError;

    const snapshot = latestCp.state_snapshot as SerializedPipelineState;
    const state = deserializeState(snapshot);

    // Find winner by matching variant_content text equality with DB winner
    const { data: dbWinner } = await supabase
      .from('content_evolution_variants')
      .select('variant_content')
      .eq('run_id', runId)
      .eq('is_winner', true)
      .limit(1)
      .maybeSingle();

    const winnerText = dbWinner?.variant_content ?? null;

    // Extract tree search metadata for path highlighting
    const treeStates = state.treeSearchStates ?? [];
    const treeResults = state.treeSearchResults ?? [];

    // Map variantId → tree node info for augmenting lineage nodes
    const treeNodeByVariant = new Map<string, { depth: number; action: string }>();
    for (const ts of treeStates) {
      for (const node of Object.values(ts.nodes)) {
        treeNodeByVariant.set(node.variantId, {
          depth: node.depth,
          action: node.revisionAction.description,
        });
      }
    }

    // Collect winning path variant IDs from tree search results
    const treeSearchPath: string[] = [];
    for (let i = 0; i < treeResults.length; i++) {
      const result = treeResults[i];
      const ts = treeStates[i];
      if (!result || !ts) continue;
      // Walk from best leaf back to root
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

    // Build nodes and edges from in-memory pool
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

    const edges: LineageData['edges'] = [];
    for (const v of state.pool) {
      for (const parentId of v.parentIds) {
        edges.push({ source: parentId, target: v.id });
      }
    }

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

    // Get run time window and budget
    const { data: run, error: runError } = await supabase
      .from('content_evolution_runs')
      .select('started_at, completed_at, budget_cap_usd')
      .eq('id', runId)
      .single();

    if (runError || !run) throw new Error(`Run ${runId} not found`);

    // Query LLM calls in chronological order
    // Cost attributed via time-window correlation — concurrent runs may overlap
    let query = supabase
      .from('llmCallTracking')
      .select('call_source, estimated_cost_usd, created_at')
      .like('call_source', 'evolution_%')
      .order('created_at', { ascending: true });

    if (run.started_at) query = query.gte('created_at', run.started_at);
    if (run.completed_at) query = query.lte('created_at', run.completed_at);

    const { data: calls, error: callsError } = await query;
    if (callsError) throw callsError;

    // Agent breakdown
    const agentMap = new Map<string, { calls: number; costUsd: number }>();
    for (const call of calls ?? []) {
      const agent = (call.call_source as string).replace(/^evolution_/, '');
      const entry = agentMap.get(agent) ?? { calls: 0, costUsd: 0 };
      entry.calls += 1;
      entry.costUsd += (call.estimated_cost_usd as number) ?? 0;
      agentMap.set(agent, entry);
    }

    const agentBreakdown: AgentCostBreakdown[] = Array.from(agentMap.entries())
      .map(([agent, { calls: count, costUsd }]) => ({ agent, calls: count, costUsd }))
      .sort((a, b) => b.costUsd - a.costUsd);

    // Cumulative burn curve
    let cumulative = 0;
    const cumulativeBurn: BudgetData['cumulativeBurn'] = (calls ?? []).map((call, i) => {
      const agent = (call.call_source as string).replace(/^evolution_/, '');
      cumulative += (call.estimated_cost_usd as number) ?? 0;
      return {
        step: i + 1,
        agent,
        cumulativeCost: cumulative,
        budgetCap: run.budget_cap_usd ?? 5,
      };
    });

    return { success: true, data: { agentBreakdown, cumulativeBurn }, error: null };
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

    // Get run details
    const { data: run, error: runError } = await supabase
      .from('content_evolution_runs')
      .select('explanation_id, total_cost_usd, current_iteration, budget_cap_usd')
      .eq('id', runId)
      .single();

    if (runError || !run) throw new Error(`Run ${runId} not found`);

    // Load latest checkpoint for original text, pool, and quality scores
    const { data: latestCp } = await supabase
      .from('evolution_checkpoints')
      .select('state_snapshot')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const snapshot = latestCp?.state_snapshot as SerializedPipelineState | null;
    const originalText = snapshot?.originalText ?? '';
    const pool = snapshot?.pool ?? [];
    const allCritiques = snapshot?.allCritiques ?? null;

    // Find winner variant
    const { data: dbWinner } = await supabase
      .from('content_evolution_variants')
      .select('variant_content, agent_name, elo_score')
      .eq('run_id', runId)
      .eq('is_winner', true)
      .limit(1)
      .maybeSingle();

    // Elo improvement: winner vs initial rating (1200)
    const winnerElo = dbWinner?.elo_score ?? null;
    const eloImprovement = winnerElo !== null ? winnerElo - 1200 : null;

    // Quality scores from allCritiques (nullable — only populated by ReflectionAgent)
    let qualityScores: ComparisonData['qualityScores'] = null;
    if (allCritiques && allCritiques.length > 0) {
      // Average critiques by dimension for first vs last variants
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
          const before = scores[0] ?? 0;
          const after = scores[scores.length - 1] ?? 0;
          return { dimension: dim, before, after };
        });
      }
    }

    // Generation depth = max version in pool
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

    const snapshot = latestCp.state_snapshot as SerializedPipelineState;
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

    // Load latest checkpoint for tree search state
    const { data: latestCp, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('state_snapshot')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (cpError) throw cpError;

    const snapshot = latestCp.state_snapshot as SerializedPipelineState;
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

      const nodesList = Object.values(ts.nodes).map((n) => ({
        id: n.id,
        variantId: n.variantId,
        parentNodeId: n.parentNodeId,
        depth: n.depth,
        revisionAction: { type: n.revisionAction.type, dimension: n.revisionAction.dimension, description: n.revisionAction.description },
        value: n.value,
        pruned: n.pruned,
      }));

      trees.push({
        rootNodeId: ts.rootNodeId,
        nodes: nodesList,
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
