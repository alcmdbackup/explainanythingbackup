'use server';
// Read-only server actions for evolution pipeline visualization pages.
// Provides aggregated data for dashboard, timeline, Elo, lineage, budget, and comparison views.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, createInputError, type ErrorResponse } from '@/lib/errorHandling';
import type {
  PipelinePhase,
  EvolutionRunStatus,
  GenerationStepName,
  AgentExecutionDetail,
  DiffMetrics,
} from '@evolution/lib/types';
import type { AgentCostBreakdown, EvolutionVariant } from '@evolution/services/evolutionActions';
import { z } from 'zod';

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
      actionSummaries?: unknown[]; // ActionSummary[] from pipeline action dispatch
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
    actionSummaries: unknown[] | null; // ActionSummary[] from pipeline action dispatch
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

const _getEvolutionRunTimelineAction = withLogging(async (
  runId: string
): Promise<ActionResult<TimelineData>> => {
  try {
    await requireAdmin();
    validateUuid(runId, 'run ID');
    const supabase = await createSupabaseServiceClient();

    const { data: invocations, error: invError } = await supabase
      .from('evolution_agent_invocations')
      .select('id, iteration, agent_name, cost_usd, execution_detail, execution_order')
      .eq('run_id', runId)
      .order('iteration', { ascending: true })
      .order('execution_order', { ascending: true });

    if (invError) throw invError;

    const SYNTHETIC_AGENTS = new Set(['iteration_complete', 'continuation_yield']);
    const EMPTY_DIFF: DiffMetrics = {
      variantsAdded: 0, matchesPlayed: 0, newVariantIds: [],
      eloChanges: {}, critiquesAdded: 0, debatesAdded: 0,
      diversityScoreAfter: 0, metaFeedbackPopulated: false,
    };

    // Group invocations by iteration
    const iterationGroups = new Map<number, typeof invocations>();
    for (const inv of invocations ?? []) {
      const iter = inv.iteration as number;
      const group = iterationGroups.get(iter) ?? [];
      group.push(inv);
      iterationGroups.set(iter, group);
    }

    const sortedIterations = Array.from(iterationGroups.entries()).sort((a, b) => a[0] - b[0]);
    const iterations: TimelineData['iterations'] = [];

    // Track phase from execution_detail if available, else default
    let lastPhase: PipelinePhase = 'EXPANSION';

    for (const [iteration, iterInvocations] of sortedIterations) {
      const agents: TimelineData['iterations'][number]['agents'] = [];
      const sorted = iterInvocations.sort(
        (a, b) => ((a.execution_order as number) ?? 0) - ((b.execution_order as number) ?? 0)
      );

      for (let i = 0; i < sorted.length; i++) {
        const inv = sorted[i];
        const agent = inv.agent_name as string;
        if (SYNTHETIC_AGENTS.has(agent)) continue;

        const detail = inv.execution_detail as Record<string, unknown> | null;
        const diff = (detail?._diffMetrics as DiffMetrics) ?? EMPTY_DIFF;

        // Extract phase from execution_detail if present
        if (detail?._phase) lastPhase = detail._phase as PipelinePhase;

        agents.push({
          name: agent,
          costUsd: Number(inv.cost_usd) || 0,
          variantsAdded: diff.variantsAdded,
          matchesPlayed: diff.matchesPlayed,
          newVariantIds: diff.newVariantIds,
          eloChanges: Object.keys(diff.eloChanges).length > 0 ? diff.eloChanges : undefined,
          critiquesAdded: diff.critiquesAdded > 0 ? diff.critiquesAdded : undefined,
          debatesAdded: (diff.debatesAdded ?? 0) > 0 ? diff.debatesAdded : undefined,
          diversityScoreAfter: diff.diversityScoreAfter,
          metaFeedbackPopulated: diff.metaFeedbackPopulated || undefined,
          executionOrder: i,
          hasExecutionDetail: true,
          invocationId: inv.id as string,
          actionSummaries: detail?._actions && Array.isArray(detail._actions)
            ? detail._actions as unknown[]
            : undefined,
        });
      }

      iterations.push({
        iteration,
        phase: lastPhase,
        agents,
        totalCostUsd: agents.reduce((sum, a) => sum + a.costUsd, 0),
        totalVariantsAdded: agents.reduce((sum, a) => sum + a.variantsAdded, 0),
        totalMatchesPlayed: agents.reduce((sum, a) => sum + a.matchesPlayed, 0),
      });
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

    const { data: dbVariants, error: varError } = await supabase
      .from('evolution_variants')
      .select('id, elo_score, generation, agent_name, created_at')
      .eq('run_id', runId)
      .order('generation', { ascending: true });

    if (varError) throw varError;

    const variants: EloHistoryData['variants'] = (dbVariants ?? []).map(v => ({
      id: v.id as string,
      shortId: (v.id as string).substring(0, 8),
      strategy: (v.agent_name as string) ?? 'unknown',
      iterationBorn: (v.generation as number) ?? 0,
    }));

    // Build one history entry per generation with current Elo scores of variants alive at that point
    const genMap = new Map<number, Record<string, number>>();
    for (const v of dbVariants ?? []) {
      const gen = (v.generation as number) ?? 0;
      const ratings = genMap.get(gen) ?? {};
      ratings[v.id as string] = Number(v.elo_score) || 1200;
      genMap.set(gen, ratings);
    }

    // Accumulate: later generations include all prior variants' latest scores
    const allRatings: Record<string, number> = {};
    const history: EloHistoryData['history'] = [];
    for (const [gen, ratings] of Array.from(genMap.entries()).sort((a, b) => a[0] - b[0])) {
      Object.assign(allRatings, ratings);
      history.push({ iteration: gen, ratings: { ...allRatings } });
    }

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

    const { data: dbVariants, error: varError } = await supabase
      .from('evolution_variants')
      .select('id, elo_score, generation, agent_name, parent_variant_id, is_winner')
      .eq('run_id', runId)
      .order('generation', { ascending: true });

    if (varError) throw varError;

    const nodes: LineageData['nodes'] = (dbVariants ?? []).map(v => ({
      id: v.id as string,
      shortId: (v.id as string).substring(0, 8),
      strategy: (v.agent_name as string) ?? 'unknown',
      elo: Number(v.elo_score) || 1200,
      iterationBorn: (v.generation as number) ?? 0,
      isWinner: (v.is_winner as boolean) ?? false,
      treeDepth: null,
      revisionAction: null,
    }));

    const edges: LineageData['edges'] = (dbVariants ?? [])
      .filter(v => v.parent_variant_id != null)
      .map(v => ({
        source: v.parent_variant_id as string,
        target: v.id as string,
      }));

    return {
      success: true,
      data: { nodes, edges },
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
      .select('explanation_id, total_cost_usd, current_iteration, budget_cap_usd, run_summary')
      .eq('id', runId)
      .single();

    if (runError || !run) throw new Error(`Run ${runId} not found`);

    const { data: dbVariants, error: varError } = await supabase
      .from('evolution_variants')
      .select('id, variant_content, elo_score, generation, agent_name, is_winner')
      .eq('run_id', runId)
      .order('elo_score', { ascending: false });

    if (varError) throw varError;

    const variants = dbVariants ?? [];
    const dbWinner = variants.find(v => v.is_winner) ?? null;

    // Original text: try run_summary, else use the lowest-generation variant
    const runSummary = run.run_summary as Record<string, unknown> | null;
    const originalText = (runSummary?.originalText as string) ?? '';

    const winnerElo = dbWinner ? Number(dbWinner.elo_score) || null : null;
    const eloImprovement = winnerElo !== null ? winnerElo - 1200 : null;

    // Quality scores no longer available without checkpoints (critiques were stored in checkpoint state)
    const qualityScores: ComparisonData['qualityScores'] = null;

    const generationDepth = variants.reduce((max, v) => Math.max(max, (v.generation as number) ?? 0), 0);

    return {
      success: true,
      data: {
        originalText,
        winnerText: dbWinner ? (dbWinner.variant_content as string) ?? null : null,
        winnerStrategy: dbWinner ? (dbWinner.agent_name as string) ?? null : null,
        winnerElo,
        eloImprovement,
        qualityScores,
        totalIterations: run.current_iteration ?? 0,
        totalCost: run.total_cost_usd ?? 0,
        variantsExplored: variants.length,
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
    // V2: step scores were stored in checkpoints — not available in V2 schema.
    return { success: true, data: [], error: null };
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
    // V2: tree search state was stored in checkpoints — not available in V2 schema.
    return { success: true, data: { trees: [] }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionRunTreeSearchAction', { runId }) };
  }
}, 'getEvolutionRunTreeSearchAction');

export const getEvolutionRunTreeSearchAction = serverReadRequestId(_getEvolutionRunTreeSearchAction);

// ─── 9. Variant fallback from DB ─────────────────────────────────

/**
 * Query EvolutionVariant[] directly from the evolution_variants table.
 * Not a server action — called from getEvolutionVariantsAction which handles auth/logging.
 */
export async function buildVariantsFromCheckpoint(
  runId: string
): Promise<ActionResult<EvolutionVariant[]>> {
  try {
    validateUuid(runId, 'run ID');
    const supabase = await createSupabaseServiceClient();

    const [varResult, runResult] = await Promise.all([
      supabase
        .from('evolution_variants')
        .select('id, run_id, explanation_id, variant_content, elo_score, generation, agent_name, match_count, is_winner, created_at')
        .eq('run_id', runId)
        .order('elo_score', { ascending: false }),
      supabase
        .from('evolution_runs')
        .select('explanation_id')
        .eq('id', runId)
        .single(),
    ]);

    if (varResult.error) throw varResult.error;
    if (runResult.error) throw runResult.error;

    const explanationId = (runResult.data?.explanation_id as number) ?? null;

    const variants: EvolutionVariant[] = (varResult.data ?? []).map(v => ({
      id: v.id as string,
      run_id: runId,
      explanation_id: (v.explanation_id as number) ?? explanationId,
      variant_content: v.variant_content as string,
      elo_score: Number(v.elo_score) || 1200,
      generation: (v.generation as number) ?? 0,
      agent_name: (v.agent_name as string) ?? 'unknown',
      match_count: (v.match_count as number) ?? 0,
      is_winner: (v.is_winner as boolean) ?? false,
      created_at: v.created_at as string,
    }));

    return { success: true, data: variants, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'buildVariantsFromCheckpoint', { runId }) };
  }
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

    const { data: dbVariant, error: varError } = await supabase
      .from('evolution_variants')
      .select('id, variant_content, elo_score, generation, agent_name, parent_variant_id, is_winner')
      .eq('run_id', runId)
      .eq('id', variantId)
      .maybeSingle();

    if (varError) throw varError;
    if (!dbVariant) return { success: true, data: null, error: null };

    // Fetch parent variant text if exists
    const parentId = (dbVariant.parent_variant_id as string) ?? null;
    const parentTexts: Record<string, string> = {};
    const parentIds: string[] = [];
    if (parentId) {
      parentIds.push(parentId);
      const { data: parentData } = await supabase
        .from('evolution_variants')
        .select('id, variant_content')
        .eq('id', parentId)
        .maybeSingle();
      if (parentData) {
        parentTexts[parentData.id as string] = parentData.variant_content as string;
      }
    }

    // Match history is no longer stored per-checkpoint in V2 — return empty
    return {
      success: true,
      data: {
        id: dbVariant.id as string,
        text: (dbVariant.variant_content as string) ?? '',
        elo: Number(dbVariant.elo_score) || 1200,
        strategy: (dbVariant.agent_name as string) ?? 'unknown',
        iterationBorn: (dbVariant.generation as number) ?? 0,
        costUsd: null,
        parentIds,
        parentTexts,
        matches: [],
        dimensionScores: null,
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
      .select('id, run_id, iteration, agent_name, execution_order, success, cost_usd, skipped, error_message, execution_detail, created_at')
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

    // 3. Extract diffMetrics from execution_detail if available
    const execDetail = inv.execution_detail as Record<string, unknown> | null;
    const diffMetrics: DiffMetrics | null = execDetail?._diffMetrics
      ? execDetail._diffMetrics as DiffMetrics
      : null;

    // 4. Build variant diffs from DB if newVariantIds are known
    const variantDiffs: VariantBeforeAfter[] = [];
    if (diffMetrics?.newVariantIds && diffMetrics.newVariantIds.length > 0) {
      const { data: newVariants } = await supabase
        .from('evolution_variants')
        .select('id, variant_content, elo_score, agent_name, parent_variant_id')
        .in('id', diffMetrics.newVariantIds);

      for (const v of newVariants ?? []) {
        const parentId = (v.parent_variant_id as string) ?? null;
        let parentText = '';
        if (parentId) {
          const { data: parentData } = await supabase
            .from('evolution_variants')
            .select('variant_content')
            .eq('id', parentId)
            .maybeSingle();
          parentText = (parentData?.variant_content as string) ?? '';
        }

        const elo = Number(v.elo_score) || 1200;
        variantDiffs.push({
          variantId: v.id as string,
          strategy: (v.agent_name as string) ?? 'unknown',
          parentId,
          beforeText: parentText,
          afterText: (v.variant_content as string) ?? '',
          textMissing: !v.variant_content,
          eloDelta: elo - 1200,
          eloAfter: elo,
          sigmaAfter: null,
        });
      }
    }

    // 5. Build input variant (highest-rated variant from before this invocation)
    let inputVariant: InvocationFullDetail['inputVariant'] = null;
    {
      const { data: topVariant } = await supabase
        .from('evolution_variants')
        .select('id, variant_content, elo_score, agent_name')
        .eq('run_id', runId)
        .lte('generation', iteration)
        .order('elo_score', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (topVariant) {
        inputVariant = {
          variantId: topVariant.id as string,
          strategy: (topVariant.agent_name as string) ?? 'unknown',
          text: (topVariant.variant_content as string) ?? '',
          textMissing: !topVariant.variant_content,
          elo: Number(topVariant.elo_score) || 1200,
          sigma: null,
        };
      }
    }

    // 6. Build Elo history for new variants (single snapshot per variant in V2)
    const eloHistory: Record<string, { iteration: number; elo: number }[]> = {};
    for (const vd of variantDiffs) {
      eloHistory[vd.variantId] = [{ iteration, elo: vd.eloAfter ?? 1200 }];
    }

    // 7. Extract execution detail
    const executionDetail = execDetail && 'detailType' in execDetail
      ? execDetail as unknown as AgentExecutionDetail
      : null;

    // 8. Extract action summaries
    const actionSummaries = execDetail?._actions && Array.isArray(execDetail._actions)
      ? execDetail._actions as unknown[]
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
          actionSummaries,
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
        const runEntry = runMap.get(item.run_id);
        item.experiment_name = runEntry?.experiment_id ? experimentMap.get(runEntry.experiment_id) ?? null : null;
        item.strategy_name = runEntry?.strategy_config_id ? strategyMap.get(runEntry.strategy_config_id) ?? null : null;
      }
    }

    return { success: true, data: { items, total: count ?? 0 }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'listInvocationsAction', { input }) };
  }
}, 'listInvocationsAction');

export const listInvocationsAction = serverReadRequestId(_listInvocationsAction);
