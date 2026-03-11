'use server';
// Read-only server actions for evolution pipeline visualization pages.
// Provides aggregated data for dashboard, timeline, Elo, lineage, budget, and comparison views.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, createInputError, type ErrorResponse } from '@/lib/errorHandling';
import { deserializeState } from '@evolution/lib/core/state';
import { toEloScale, createRating, ELO_SIGMA_SCALE } from '@evolution/lib/core/rating';
import type {
  PipelinePhase,
  SerializedPipelineState,
  EvolutionRunStatus,
  GenerationStepName,
  AgentExecutionDetail,
  DiffMetrics,
  AgentAttribution,
} from '@evolution/lib/types';
import { isOutlineVariant } from '@evolution/lib/types';
import type { AgentCostBreakdown, EvolutionVariant } from '@evolution/services/evolutionActions';
import { z } from 'zod';

// Lightweight Zod schema for SerializedPipelineState boundary validation.
const serializedPipelineStateSchema = z.object({
  iteration: z.number(),
  pool: z.array(z.object({ id: z.string() }).passthrough()),
  ratings: z.record(z.string(), z.object({ mu: z.number(), sigma: z.number() })).optional(),
  eloRatings: z.record(z.string(), z.number()).optional(),
  matchCounts: z.record(z.string(), z.number()).optional(),
}).passthrough();

/** Validate + cast checkpoint snapshot to SerializedPipelineState. */
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
  arenaSize: number;
}

export interface DashboardRun {
  id: string;
  explanation_id: number | null;
  status: EvolutionRunStatus;
  phase: PipelinePhase;
  current_iteration: number;
  total_cost_usd: number;
  budget_cap_usd: number;
  error_message: string | null;
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
      newVariantIds?: string[];
      eloChanges?: Record<string, number>; // variantId → delta
      critiquesAdded?: number;
      debatesAdded?: number;
      diversityScoreAfter?: number | null;
      metaFeedbackPopulated?: boolean;
      skipped?: boolean;
      executionOrder?: number; // 0-based position within iteration
      hasExecutionDetail?: boolean; // true if structured execution detail is available
      invocationId?: string; // ID for linking to invocation detail page
      agentAttribution?: AgentAttribution; // creator-based Elo attribution for this agent
    }[];
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
  history: {
    iteration: number;
    ratings: Record<string, number>;
    /** Per-variant sigma values for CI bands (mu ± 1.96*sigma on Elo scale). */
    sigmas?: Record<string, number>;
  }[];
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

export interface VariantBeforeAfter {
  variantId: string;
  strategy: string;
  parentId: string | null;
  beforeText: string;
  afterText: string;
  textMissing?: boolean;
  eloDelta: number | null;
  eloAfter: number | null;
  sigmaAfter: number | null;
}

export interface InvocationFullDetail {
  invocation: {
    id: string;
    runId: string;
    iteration: number;
    agentName: string;
    executionOrder: number;
    success: boolean;
    skipped: boolean;
    costUsd: number;
    errorMessage: string | null;
    executionDetail: AgentExecutionDetail | null;
    agentAttribution: AgentAttribution | null;
    createdAt: string;
  };
  run: {
    status: string;
    phase: string | null;
    explanationId: number | null;
    explanationTitle: string | null;
  };
  diffMetrics: DiffMetrics | null;
  inputVariant: {
    variantId: string;
    strategy: string;
    text: string;
    textMissing?: boolean;
    elo: number | null;
    sigma: number | null;
  } | null;
  variantDiffs: VariantBeforeAfter[];
  eloHistory: Record<string, { iteration: number; elo: number }[]>;
}

// ─── Helpers ────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label: string): void {
  if (!UUID_REGEX.test(id)) {
    throw new Error(`Invalid ${label} format: ${id}`);
  }
}

type ActionResult<T> = { success: boolean; data: T | null; error: ErrorResponse | null };

// ─── 1. Dashboard ───────────────────────────────────────────────

const _getEvolutionDashboardDataAction = withLogging(async (): Promise<ActionResult<DashboardData>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const firstOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

    // Probe whether the 'archived' column exists (migration may not yet be applied).
    // If it does, filter out archived runs from dashboard queries.
    const archiveProbe = await supabase.from('evolution_runs').select('archived').limit(1);
    const hasArchivedCol = !archiveProbe.error;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runsQ = (cols: string, opts?: { count?: 'exact'; head?: boolean }): any => {
      const q = supabase.from('evolution_runs').select(cols, opts);
      return hasArchivedCol ? q.eq('archived', false) : q;
    };

    const [activeRes, queueRes, last7dRes, monthSpendRes, last30dRes, recentRes, prevMonthSpendRes, evolvedRes, bankRes] = await Promise.all([
      runsQ('id', { count: 'exact', head: true }).in('status', ['running', 'claimed', 'continuation_pending']),
      runsQ('id', { count: 'exact', head: true }).eq('status', 'pending'),
      runsQ('status, created_at').gte('created_at', sevenDaysAgo).in('status', ['completed', 'failed', 'paused']),
      runsQ('total_cost_usd').gte('created_at', firstOfMonth),
      runsQ('status, total_cost_usd, created_at').gte('created_at', thirtyDaysAgo),
      runsQ('id, explanation_id, status, phase, current_iteration, total_cost_usd, budget_cap_usd, error_message, started_at, completed_at, created_at').order('created_at', { ascending: false }).limit(20),
      runsQ('total_cost_usd').gte('created_at', firstOfPreviousMonth).lt('created_at', firstOfMonth),
      runsQ('explanation_id').eq('status', 'completed'),
      supabase.from('evolution_arena_entries').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    ]);

    const activeRuns = activeRes.count ?? 0;
    const queueDepth = queueRes.count ?? 0;

    const last7d = (last7dRes.data ?? []) as { status: string; created_at: string }[];
    const completed7d = last7d.filter(r => r.status === 'completed').length;
    const total7d = last7d.length;
    const successRate7d = total7d > 0 ? Math.round((completed7d / total7d) * 100) : 0;

    const monthlySpend = ((monthSpendRes.data ?? []) as { total_cost_usd: number }[]).reduce((sum: number, r) => sum + (r.total_cost_usd ?? 0), 0);
    const previousMonthSpend = ((prevMonthSpendRes.data ?? []) as { total_cost_usd: number }[]).reduce((sum: number, r) => sum + (r.total_cost_usd ?? 0), 0);
    const articlesEvolvedCount = new Set(((evolvedRes.data ?? []) as { explanation_id: number }[]).map(r => r.explanation_id)).size;
    const arenaSize = bankRes.count ?? 0;

    // Aggregate runs and spend per day from last 30 days data (single pass)
    const dayMap = new Map<string, { completed: number; failed: number; paused: number; spend: number }>();
    for (const r of last30dRes.data ?? []) {
      const day = r.created_at.substring(0, 10);
      const entry = dayMap.get(day) ?? { completed: 0, failed: 0, paused: 0, spend: 0 };
      if (r.status === 'completed') entry.completed++;
      else if (r.status === 'failed') entry.failed++;
      else if (r.status === 'paused') entry.paused++;
      entry.spend += r.total_cost_usd ?? 0;
      dayMap.set(day, entry);
    }
    const sortedDays = Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const runsPerDay = sortedDays.map(([date, d]) => ({ date, completed: d.completed, failed: d.failed, paused: d.paused }));
    const dailySpend = sortedDays.map(([date, d]) => ({ date, amount: d.spend }));

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
        arenaSize,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionDashboardDataAction') };
  }
}, 'getEvolutionDashboardDataAction');

export const getEvolutionDashboardDataAction = serverReadRequestId(_getEvolutionDashboardDataAction);

// ─── 2. Run Timeline ────────────────────────────────────────────

function computeEloDelta(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  const deltas: Record<string, number> = {};
  for (const [id, newElo] of Object.entries(after)) {
    const delta = newElo - (before[id] ?? 1200);
    if (delta !== 0) deltas[id] = delta;
  }
  return deltas;
}

function diffCheckpoints(
  before: SerializedPipelineState | null,
  after: SerializedPipelineState
): DiffMetrics {
  const beforePoolIds = new Set(before?.pool?.map(v => v.id) ?? []);
  const newVariantIds = (after.pool ?? [])
    .filter(v => !beforePoolIds.has(v.id))
    .map(v => v.id);

  return {
    variantsAdded: newVariantIds.length,
    newVariantIds,
    matchesPlayed: Math.max(0, (after.matchHistory?.length ?? 0) - (before?.matchHistory?.length ?? 0)),
    eloChanges: computeEloDelta(before ? buildEloLookup(before) : {}, buildEloLookup(after)),
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
    validateUuid(runId, 'run ID');
    const supabase = await createSupabaseServiceClient();

    const { data: checkpoints, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('iteration, phase, last_agent, state_snapshot, created_at')
      .eq('run_id', runId)
      .order('iteration', { ascending: true })
      .order('created_at', { ascending: true }); // ASC for correct execution order

    if (cpError) throw cpError;

    const iterationGroups = new Map<number, CheckpointRow[]>();
    for (const cp of (checkpoints ?? []) as CheckpointRow[]) {
      const group = iterationGroups.get(cp.iteration) ?? [];
      group.push(cp);
      iterationGroups.set(cp.iteration, group);
    }

    const { data: costInvocations } = await supabase
      .from('evolution_agent_invocations')
      .select('id, iteration, agent_name, cost_usd, execution_detail, agent_attribution')
      .eq('run_id', runId)
      .order('iteration', { ascending: true })
      .order('execution_order', { ascending: true });

    const costMap = new Map<string, number>();
    const invocationSet = new Set<string>();
    const invocationIdMap = new Map<string, string>();
    const diffMetricsMap = new Map<string, DiffMetrics>();
    const attributionMap = new Map<string, AgentAttribution>();
    for (const inv of costInvocations ?? []) {
      const agent = inv.agent_name as string;
      // cost_usd is now incremental per-invocation — use directly as the iteration cost delta
      const cost = Number(inv.cost_usd) || 0;
      const key = `${inv.iteration}-${agent}`;
      costMap.set(key, cost);
      invocationSet.add(key);
      if (inv.id) invocationIdMap.set(key, inv.id as string);
      const detail = inv.execution_detail as Record<string, unknown> | null;
      if (detail?._diffMetrics) {
        diffMetricsMap.set(key, detail._diffMetrics as DiffMetrics);
      }
      if (inv.agent_attribution) {
        attributionMap.set(agent, inv.agent_attribution as AgentAttribution);
      }
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
        const invKey = `${iteration}-${cp.last_agent}`;
        const diff = diffMetricsMap.get(invKey) ?? diffCheckpoints(prevSnapshotInIteration, cp.state_snapshot);

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
        const invKey = `${iter.iteration}-${agent.name}`;
        agent.hasExecutionDetail = invocationSet.has(invKey);
        agent.invocationId = invocationIdMap.get(invKey);
        const attr = attributionMap.get(agent.name);
        if (attr) agent.agentAttribution = attr;
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
    validateUuid(runId, 'run ID');
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
        iterationMap.set(cp.iteration, parseSnapshot(cp.state_snapshot));
      }
    }

    const history: EloHistoryData['history'] = [];
    for (const [iteration, snapshot] of Array.from(iterationMap.entries()).sort((a, b) => a[0] - b[0])) {
      const ratings = snapshot.ratings;
      if (ratings && Object.keys(ratings).length > 0) {
        const converted: Record<string, number> = {};
        const sigmas: Record<string, number> = {};
        for (const [id, r] of Object.entries(ratings)) {
          const rating = r as { mu: number; sigma: number };
          converted[id] = toEloScale(rating.mu);
          sigmas[id] = rating.sigma * ELO_SIGMA_SCALE;
        }
        history.push({ iteration, ratings: converted, sigmas });
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
    validateUuid(runId, 'run ID');
    const supabase = await createSupabaseServiceClient();

    const { data: latestCp, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('state_snapshot')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (cpError) throw cpError;

    const snapshot = parseSnapshot(latestCp.state_snapshot);
    const state = deserializeState(snapshot);

    const { data: dbWinner } = await supabase
      .from('evolution_variants')
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
        elo: toEloScale((state.ratings.get(v.id) ?? createRating()).mu),
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
    validateUuid(runId, 'run ID');
    const supabase = await createSupabaseServiceClient();

    const { data: run, error: runError } = await supabase
      .from('evolution_runs')
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

    const agentMap = new Map<string, { invocations: number; totalCost: number }>();
    const cumulativeBurn: BudgetData['cumulativeBurn'] = [];
    let cumulative = 0;

    for (const inv of invocations ?? []) {
      const agent = inv.agent_name as string;
      const cost = Number(inv.cost_usd) || 0;

      const entry = agentMap.get(agent) ?? { invocations: 0, totalCost: 0 };
      entry.invocations += 1;
      entry.totalCost += cost;
      agentMap.set(agent, entry);

      cumulative += cost;
      cumulativeBurn.push({
        step: cumulativeBurn.length + 1,
        agent,
        cumulativeCost: cumulative,
        budgetCap: run.budget_cap_usd ?? 5,
      });
    }

    const agentBreakdown: AgentCostBreakdown[] = Array.from(agentMap.entries())
      .map(([agent, { invocations: count, totalCost }]) => ({ agent, calls: count, costUsd: totalCost }))
      .sort((a, b) => b.costUsd - a.costUsd);

    const estimate = (run.cost_estimate_detail as BudgetData['estimate']) ?? null;
    const prediction = (run.cost_prediction as BudgetData['prediction']) ?? null;

    const agentBudgetCaps: Record<string, number> = {};

    const runStatus = String(run.status ?? 'unknown');

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
    validateUuid(runId, 'run ID');
    const supabase = await createSupabaseServiceClient();

    const { data: run, error: runError } = await supabase
      .from('evolution_runs')
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

    const snapshot = latestCp?.state_snapshot
      ? parseSnapshot(latestCp.state_snapshot)
      : null;
    const originalText = snapshot?.originalText ?? '';
    const pool = snapshot?.pool ?? [];
    const allCritiques = snapshot?.allCritiques ?? null;

    const { data: dbWinner } = await supabase
      .from('evolution_variants')
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
          for (const d of Object.keys(c.dimensionScores)) dimensions.add(d);
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
    validateUuid(runId, 'run ID');
    const supabase = await createSupabaseServiceClient();

    const { data: latestCp, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('state_snapshot')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (cpError) throw cpError;

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
    validateUuid(runId, 'run ID');
    const supabase = await createSupabaseServiceClient();

    const { data: latestCp, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('state_snapshot')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (cpError) throw cpError;

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
 * (evolution_variants) has no rows — e.g. for running, failed, or paused runs.
 * Not a server action (no withLogging/serverReadRequestId) since it's called from
 * getEvolutionVariantsAction which already handles auth/logging.
 */
export async function buildVariantsFromCheckpoint(
  runId: string
): Promise<ActionResult<EvolutionVariant[]>> {
  try {
    validateUuid(runId, 'run ID');
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
        .from('evolution_runs')
        .select('explanation_id')
        .eq('id', runId)
        .single(),
    ]);

    if (cpResult.error) throw cpResult.error;
    if (runResult.error) throw runResult.error;
    if (!cpResult.data) {
      return { success: true, data: [], error: null };
    }

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

/** Build Elo lookup from {mu,sigma} ratings or legacy eloRatings. */
function buildEloLookup(snapshot: SerializedPipelineState): Record<string, number> {
  const ratings = snapshot.ratings;
  if (ratings && Object.keys(ratings).length > 0) {
    return Object.fromEntries(
      Object.entries(ratings).map(([id, r]) => [
        id,
        toEloScale((r as { mu: number; sigma: number }).mu),
      ]),
    );
  }
  return snapshot.eloRatings ?? {};
}

/** Build Elo lookup with sigma for CI display. Legacy eloRatings format returns sigma=0. */
function buildEloLookupWithSigma(snapshot: SerializedPipelineState): Record<string, { elo: number; sigma: number }> {
  const ratings = snapshot.ratings;
  if (ratings && Object.keys(ratings).length > 0) {
    return Object.fromEntries(
      Object.entries(ratings).map(([id, r]) => {
        const rating = r as { mu: number; sigma: number };
        return [id, {
          elo: toEloScale(rating.mu),
          sigma: rating.sigma * ELO_SIGMA_SCALE,
        }];
      }),
    );
  }
  // Legacy format: no sigma info
  const legacy = snapshot.eloRatings ?? {};
  return Object.fromEntries(
    Object.entries(legacy).map(([id, elo]) => [id, { elo, sigma: 0 }]),
  );
}

// ─── Agent Invocation Detail ────────────────────────────────────

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

const _getAgentInvocationDetailAction = withLogging(async (
  runId: string,
  iteration: number,
  agentName: string,
): Promise<ActionResult<AgentExecutionDetail | null>> => {
  try {
    await requireAdmin();
    validateUuid(runId, 'run ID');
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

const _getIterationInvocationsAction = withLogging(async (
  runId: string,
  iteration: number,
): Promise<ActionResult<AgentInvocationRow[]>> => {
  try {
    await requireAdmin();
    validateUuid(runId, 'run ID');
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

const _getAgentInvocationsForRunAction = withLogging(async (
  runId: string,
  agentName: string,
): Promise<ActionResult<AgentInvocationRow[]>> => {
  try {
    await requireAdmin();
    validateUuid(runId, 'run ID');
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

// ─── Variant Detail ─────────────────────────────────────────────

export interface VariantDetail {
  id: string;
  text: string;
  elo: number;
  strategy: string;
  iterationBorn: number;
  costUsd: number | null;
  parentIds: string[];
  parentTexts: Record<string, string>;
  matches: Array<{
    opponentId: string;
    won: boolean;
    confidence: number;
    dimensionScores: Record<string, string>;
  }>;
  dimensionScores: Record<string, number> | null;
}

const _getVariantDetailAction = withLogging(async (
  runId: string,
  variantId: string,
): Promise<ActionResult<VariantDetail | null>> => {
  try {
    await requireAdmin();
    validateUuid(runId, 'run ID');
    const supabase = await createSupabaseServiceClient();

    const { data: cpData, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('state_snapshot')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cpError) throw cpError;
    if (!cpData) return { success: true, data: null, error: null };

    const snapshot = cpData.state_snapshot as SerializedPipelineState;
    const pool = snapshot.pool ?? [];
    const variant = pool.find(v => v.id === variantId);
    if (!variant) return { success: true, data: null, error: null };

    const eloLookup = buildEloLookup(snapshot);

    const matches = (snapshot.matchHistory ?? [])
      .filter(m => m.variationA === variantId || m.variationB === variantId)
      .map(m => ({
        opponentId: m.variationA === variantId ? m.variationB : m.variationA,
        won: m.winner === variantId,
        confidence: m.confidence,
        dimensionScores: m.dimensionScores,
      }));

    const parentTexts: Record<string, string> = {};
    for (const pid of variant.parentIds) {
      const parent = pool.find(v => v.id === pid);
      if (parent) parentTexts[pid] = parent.text;
    }

    const dimensionScores = snapshot.dimensionScores?.[variantId] ?? null;

    return {
      success: true,
      data: {
        id: variant.id,
        text: variant.text,
        elo: eloLookup[variant.id] ?? 1200,
        strategy: variant.strategy,
        iterationBorn: variant.iterationBorn,
        costUsd: variant.costUsd ?? null,
        parentIds: variant.parentIds,
        parentTexts,
        matches,
        dimensionScores,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getVariantDetailAction', { runId, variantId }) };
  }
}, 'getVariantDetailAction');

export const getVariantDetailAction = serverReadRequestId(_getVariantDetailAction);

// ─── Invocation Full Detail ─────────────────────────────────────

const _getInvocationFullDetailAction = withLogging(async (
  invocationId: string
): Promise<ActionResult<InvocationFullDetail>> => {
  try {
    await requireAdmin();
    validateUuid(invocationId, 'invocation ID');
    const supabase = await createSupabaseServiceClient();

    // 1. Fetch invocation row
    const { data: inv, error: invError } = await supabase
      .from('evolution_agent_invocations')
      .select('id, run_id, iteration, agent_name, execution_order, success, cost_usd, skipped, error_message, execution_detail, agent_attribution, created_at')
      .eq('id', invocationId)
      .single();

    if (invError) {
      if (invError.code === 'PGRST116') {
        return { success: false, data: null, error: createInputError('Invocation not found') };
      }
      throw invError;
    }

    const runId = inv.run_id as string;
    const iteration = inv.iteration as number;
    const agentName = inv.agent_name as string;

    // 2. Fetch run metadata with explanation title
    const { data: runData, error: runError } = await supabase
      .from('evolution_runs')
      .select('status, phase, explanation_id, explanations!inner(title)')
      .eq('id', runId)
      .single();

    // Fallback without join if explanation join fails
    let run: InvocationFullDetail['run'];
    if (runError || !runData) {
      const { data: runFallback } = await supabase
        .from('evolution_runs')
        .select('status, phase, explanation_id')
        .eq('id', runId)
        .single();
      run = {
        status: (runFallback?.status as string) ?? 'unknown',
        phase: (runFallback?.phase as string) ?? null,
        explanationId: (runFallback?.explanation_id as number) ?? null,
        explanationTitle: null,
      };
    } else {
      const explanations = runData.explanations as unknown as { title: string } | null;
      run = {
        status: runData.status as string,
        phase: (runData.phase as string) ?? null,
        explanationId: (runData.explanation_id as number) ?? null,
        explanationTitle: explanations?.title ?? null,
      };
    }

    // 3. Fetch checkpoints for this run to find before/after state
    const { data: checkpoints } = await supabase
      .from('evolution_checkpoints')
      .select('iteration, last_agent, state_snapshot, created_at')
      .eq('run_id', runId)
      .order('iteration', { ascending: true })
      .order('created_at', { ascending: true });

    const cpList = (checkpoints ?? []) as Array<{
      iteration: number;
      last_agent: string;
      state_snapshot: SerializedPipelineState;
      created_at: string;
    }>;

    // Find "after" checkpoint (this agent's checkpoint for this iteration)
    const afterCp = cpList.find(
      cp => cp.iteration === iteration && cp.last_agent === agentName
    );

    // Find "before" checkpoint (the checkpoint immediately before afterCp)
    let beforeCp: typeof afterCp | null = null;
    if (afterCp) {
      const afterIdx = cpList.indexOf(afterCp);
      if (afterIdx > 0) {
        beforeCp = cpList[afterIdx - 1];
      }
    }

    const afterSnapshot = afterCp?.state_snapshot ?? null;
    const beforeSnapshot = beforeCp?.state_snapshot ?? null;

    // 4. Extract diffMetrics from execution_detail if available, else compute
    const execDetail = inv.execution_detail as Record<string, unknown> | null;
    let diffMetrics: DiffMetrics | null = null;
    if (execDetail?._diffMetrics) {
      diffMetrics = execDetail._diffMetrics as DiffMetrics;
    } else if (afterSnapshot) {
      diffMetrics = diffCheckpoints(beforeSnapshot, afterSnapshot);
    }

    // 5. Build variant diffs
    const variantDiffs: VariantBeforeAfter[] = [];
    if (afterSnapshot && diffMetrics?.newVariantIds) {
      const beforePool = beforeSnapshot?.pool ?? [];
      const afterPool = afterSnapshot.pool ?? [];
      const beforePoolMap = new Map(beforePool.map(v => [v.id, v]));
      const afterPoolMap = new Map(afterPool.map(v => [v.id, v]));
      const afterEloSigma = buildEloLookupWithSigma(afterSnapshot);
      const beforeElo = beforeSnapshot ? buildEloLookup(beforeSnapshot) : {};

      for (const newId of diffMetrics.newVariantIds) {
        const variant = afterPoolMap.get(newId);
        if (!variant) continue;

        const parentId = variant.parentIds?.[0] ?? null;
        const parent = parentId ? (beforePoolMap.get(parentId) ?? afterPoolMap.get(parentId)) : null;

        const afterEntry = afterEloSigma[newId];
        const newElo = afterEntry?.elo ?? null;
        let eloDelta: number | null = null;
        if (newElo != null) {
          const baseElo = beforeElo[newId] ?? 1200;
          eloDelta = newElo - baseElo;
        }

        variantDiffs.push({
          variantId: newId,
          strategy: variant.strategy,
          parentId,
          beforeText: parent?.text ?? '',
          afterText: variant.text,
          textMissing: !variant.text,
          eloDelta,
          eloAfter: newElo,
          sigmaAfter: afterEntry?.sigma ?? null,
        });
      }
    }

    // 6. Build input variant (highest-rated variant from before pool)
    let inputVariant: InvocationFullDetail['inputVariant'] = null;
    if (beforeSnapshot) {
      const beforeEloSigma = buildEloLookupWithSigma(beforeSnapshot);
      const sorted = [...(beforeSnapshot.pool ?? [])]
        .map(v => ({ ...v, elo: beforeEloSigma[v.id]?.elo ?? 1200, sigma: beforeEloSigma[v.id]?.sigma ?? 0 }))
        .sort((a, b) => b.elo - a.elo);
      const top = sorted[0];
      if (top) {
        inputVariant = {
          variantId: top.id,
          strategy: top.strategy,
          text: top.text,
          textMissing: !top.text,
          elo: top.elo,
          sigma: top.sigma || null,
        };
      }
    }

    // 7. Build Elo history for new variants across all checkpoints
    const eloHistory: Record<string, { iteration: number; elo: number }[]> = {};
    const trackedIds = new Set(diffMetrics?.newVariantIds ?? []);
    if (trackedIds.size > 0) {
      for (const cp of cpList) {
        const elo = buildEloLookup(cp.state_snapshot);
        for (const vid of trackedIds) {
          if (elo[vid] != null) {
            if (!eloHistory[vid]) eloHistory[vid] = [];
            eloHistory[vid].push({ iteration: cp.iteration, elo: elo[vid] });
          }
        }
      }
    }

    // 8. Extract execution detail
    const executionDetail = execDetail && 'detailType' in execDetail
      ? execDetail as unknown as AgentExecutionDetail
      : null;

    return {
      success: true,
      data: {
        invocation: {
          id: inv.id as string,
          runId,
          iteration,
          agentName,
          executionOrder: (inv.execution_order as number) ?? 0,
          success: (inv.success as boolean) ?? false,
          skipped: (inv.skipped as boolean) ?? false,
          costUsd: Number(inv.cost_usd) || 0,
          errorMessage: (inv.error_message as string) ?? null,
          executionDetail,
          agentAttribution: (inv.agent_attribution as AgentAttribution) ?? null,
          createdAt: inv.created_at as string,
        },
        run,
        diffMetrics,
        inputVariant,
        variantDiffs,
        eloHistory,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getInvocationFullDetailAction', { invocationId }) };
  }
}, 'getInvocationFullDetailAction');

export const getInvocationFullDetailAction = serverReadRequestId(_getInvocationFullDetailAction);

// ─── List Invocations ───────────────────────────────────────────

const listInvocationsInputSchema = z.object({
  runId: z.string().uuid().optional(),
  agentName: z.string().optional(),
  success: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export type ListInvocationsInput = z.input<typeof listInvocationsInputSchema>;

export interface InvocationListEntry {
  id: string;
  run_id: string;
  iteration: number;
  agent_name: string;
  execution_order: number;
  success: boolean;
  cost_usd: number;
  skipped: boolean;
  error_message: string | null;
  created_at: string;
  experiment_name?: string | null;
  strategy_name?: string | null;
}

const _listInvocationsAction = withLogging(async (
  input: ListInvocationsInput = {}
): Promise<{ success: boolean; data: { items: InvocationListEntry[]; total: number } | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const parsed = listInvocationsInputSchema.parse(input);
    const supabase = await createSupabaseServiceClient();

    let query = supabase
      .from('evolution_agent_invocations')
      .select('id, run_id, iteration, agent_name, execution_order, success, cost_usd, skipped, error_message, created_at', { count: 'exact' });

    if (parsed.runId) query = query.eq('run_id', parsed.runId);
    if (parsed.agentName) query = query.eq('agent_name', parsed.agentName);
    if (parsed.success !== undefined) query = query.eq('success', parsed.success);

    query = query.order('created_at', { ascending: false })
      .range(parsed.offset, parsed.offset + parsed.limit - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    const items = (data ?? []) as InvocationListEntry[];

    // Post-fetch enrichment: batch-fetch experiment and strategy names via runs
    const runIds = [...new Set(items.map(i => i.run_id).filter(Boolean))];
    if (runIds.length > 0) {
      const { data: runData } = await supabase
        .from('evolution_runs')
        .select('id, experiment_id, strategy_config_id')
        .in('id', runIds);

      const runMap = new Map((runData ?? []).map(r => [r.id as string, r as { id: string; experiment_id: string | null; strategy_config_id: string | null }]));

      const experimentIds = [...new Set((runData ?? []).map(r => r.experiment_id as string | null).filter((id): id is string => !!id))];
      const strategyIds = [...new Set((runData ?? []).map(r => r.strategy_config_id as string | null).filter((id): id is string => !!id))];

      const [experimentMap, strategyMap] = await Promise.all([
        experimentIds.length > 0
          ? supabase.from('evolution_experiments').select('id, name').in('id', experimentIds)
              .then(({ data: d }) => new Map((d ?? []).map(e => [e.id as string, e.name as string])))
          : Promise.resolve(new Map<string, string>()),
        strategyIds.length > 0
          ? supabase.from('evolution_strategy_configs').select('id, name').in('id', strategyIds)
              .then(({ data: d }) => new Map((d ?? []).map(s => [s.id as string, s.name as string])))
          : Promise.resolve(new Map<string, string>()),
      ]);

      for (const item of items) {
        const run = runMap.get(item.run_id);
        item.experiment_name = run?.experiment_id ? experimentMap.get(run.experiment_id) ?? null : null;
        item.strategy_name = run?.strategy_config_id ? strategyMap.get(run.strategy_config_id) ?? null : null;
      }
    }

    return { success: true, data: { items, total: count ?? 0 }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'listInvocationsAction', { input }) };
  }
}, 'listInvocationsAction');

export const listInvocationsAction = serverReadRequestId(_listInvocationsAction);
