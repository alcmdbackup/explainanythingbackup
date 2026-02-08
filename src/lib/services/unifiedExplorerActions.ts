'use server';
// Server actions powering the Unified Dimensional Explorer.
// Provides table (run/article/task), matrix, and trend views with multi-dimensional filtering.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import type { PipelineType } from '@/lib/evolution/types';

type ActionResult<T> = { success: boolean; data: T | null; error: ErrorResponse | null };

// ─── Shared Filter Types ─────────────────────────────────────────

export interface ExplorerFilters {
  promptIds?: string[];
  strategyIds?: string[];
  pipelineTypes?: PipelineType[];
  agentNames?: string[];
  runIds?: string[];
  variantIds?: string[];
  // Attribute filters (resolved server-side to entity IDs)
  difficultyTiers?: string[];
  domainTags?: string[];
  models?: string[];
  budgetRange?: { min?: number; max?: number };
  dateRange?: { from: string; to: string };
}

export type UnitOfAnalysis = 'run' | 'article' | 'task';
export type ExplorerMetric = 'avgElo' | 'totalCost' | 'runCount' | 'avgEloDollar' | 'successRate';
export type ExplorerDimension = 'prompt' | 'strategy' | 'pipelineType' | 'agent';
export type TimeBucket = 'day' | 'week' | 'month';

// ─── Result Types ────────────────────────────────────────────────

export interface ExplorerRunRow {
  id: string;
  prompt_id: string | null;
  prompt_text: string | null;
  strategy_config_id: string | null;
  strategy_label: string | null;
  pipeline_type: string | null;
  status: string;
  total_cost_usd: number;
  total_variants: number;
  current_iteration: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ExplorerArticleRow {
  id: string;
  run_id: string;
  variant_content_preview: string;
  elo_score: number;
  agent_name: string;
  generation: number;
  parent_variant_id: string | null;
  match_count: number;
  is_winner: boolean;
  prompt_text: string | null;
  hall_of_fame_rank: number | null;
  created_at: string;
}

export interface ExplorerTaskRow {
  id: string;
  run_id: string;
  agent_name: string;
  prompt_text: string | null;
  cost_usd: number;
  variants_generated: number;
  avg_elo: number | null;
  elo_gain: number | null;
  elo_per_dollar: number | null;
}

export interface ExplorerAggregation {
  totalCount: number;
  avgElo: number | null;
  totalCost: number;
  avgCostPerUnit: number | null;
  topStrategy: string | null;
  topAgent: string | null;
}

export interface ExplorerTableResult {
  runs?: ExplorerRunRow[];
  articles?: ExplorerArticleRow[];
  tasks?: ExplorerTaskRow[];
  aggregation: ExplorerAggregation;
  totalCount: number;
}

export interface MatrixCell {
  rowId: string;
  colId: string;
  value: number;
  runCount: number;
}

export interface ExplorerMatrixResult {
  rows: Array<{ id: string; label: string }>;
  cols: Array<{ id: string; label: string }>;
  cells: MatrixCell[];
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface TrendSeries {
  dimensionId: string;
  dimensionLabel: string;
  points: TrendPoint[];
}

export interface ExplorerTrendResult {
  series: TrendSeries[];
}

export interface ExplorerArticleDetail {
  variantId: string;
  content: string;
  parentContent: string | null;
  eloScore: number;
  agentName: string;
  generation: number;
  lineage: Array<{ id: string; agentName: string; generation: number; preview: string }>;
}

// ─── Attribute Filter Resolution ────────────────────────────────

/** Resolve attribute filters to entity IDs. Returns resolved prompt/strategy IDs. */
async function resolveAttributeFilters(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  filters: ExplorerFilters,
): Promise<{ resolvedPromptIds?: string[]; resolvedStrategyIds?: string[] }> {
  const result: { resolvedPromptIds?: string[]; resolvedStrategyIds?: string[] } = {};

  // Resolve prompt attributes → prompt IDs
  const hasPromptAttrs = (filters.difficultyTiers?.length ?? 0) > 0
    || (filters.domainTags?.length ?? 0) > 0;

  if (hasPromptAttrs) {
    let query = supabase.from('article_bank_topics').select('id').is('deleted_at', null);
    if (filters.difficultyTiers?.length) {
      query = query.in('difficulty_tier', filters.difficultyTiers);
    }
    if (filters.domainTags?.length) {
      query = query.overlaps('domain_tags', filters.domainTags);
    }
    const { data } = await query;
    result.resolvedPromptIds = (data ?? []).map((r: { id: string }) => r.id);
  }

  // Resolve strategy attributes → strategy IDs
  const hasStrategyAttrs = (filters.models?.length ?? 0) > 0
    || filters.budgetRange?.min !== undefined
    || filters.budgetRange?.max !== undefined;

  if (hasStrategyAttrs) {
    let query = supabase.from('strategy_configs').select('id');
    if (filters.models?.length) {
      query = query.in('config->>generationModel', filters.models);
    }
    if (filters.budgetRange?.min !== undefined) {
      query = query.gte('config->>budgetCapUsd', String(filters.budgetRange.min));
    }
    if (filters.budgetRange?.max !== undefined) {
      query = query.lte('config->>budgetCapUsd', String(filters.budgetRange.max));
    }
    const { data } = await query;
    result.resolvedStrategyIds = (data ?? []).map((s: { id: string }) => s.id);
  }

  return result;
}

/** Intersect explicit IDs with attribute-resolved IDs. */
function intersectIds(explicit?: string[], resolved?: string[]): string[] | undefined {
  if (!explicit && !resolved) return undefined;
  if (!explicit) return resolved;
  if (!resolved) return explicit;
  const resolvedSet = new Set(resolved);
  return explicit.filter(id => resolvedSet.has(id));
}

/** Apply standard filters to a content_evolution_runs query. Returns the filtered query builder. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyRunFilters<Q extends { in: any; gte: any; lte: any }>(
  query: Q,
  filters: ExplorerFilters,
  finalPromptIds?: string[],
  finalStrategyIds?: string[],
): Q {
  let q = query;
  if (finalPromptIds?.length) q = q.in('prompt_id', finalPromptIds);
  if (finalStrategyIds?.length) q = q.in('strategy_config_id', finalStrategyIds);
  if (filters.pipelineTypes?.length) q = q.in('pipeline_type', filters.pipelineTypes);
  if (filters.runIds?.length) q = q.in('id', filters.runIds);
  if (filters.dateRange?.from) q = q.gte('created_at', filters.dateRange.from);
  if (filters.dateRange?.to) q = q.lte('created_at', filters.dateRange.to);
  return q;
}

/** Resolve prompt IDs to their text. Returns a Map<promptId, promptText>. */
async function resolvePromptTexts(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  promptIds: string[],
): Promise<Map<string, string>> {
  if (promptIds.length === 0) return new Map();
  const { data } = await supabase.from('article_bank_topics').select('id, prompt').in('id', promptIds);
  return new Map((data ?? []).map((p: { id: string; prompt: string }) => [p.id, p.prompt]));
}

function emptyAggregation(): ExplorerAggregation {
  return { totalCount: 0, avgElo: null, totalCost: 0, avgCostPerUnit: null, topStrategy: null, topAgent: null };
}

// ─── Table Mode: getUnifiedExplorerAction ────────────────────────

const _getUnifiedExplorerAction = withLogging(async (
  filters: ExplorerFilters,
  unitOfAnalysis: UnitOfAnalysis,
  options?: { sortBy?: string; limit?: number; offset?: number },
): Promise<ActionResult<ExplorerTableResult>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Step 1: Resolve attribute filters
    const { resolvedPromptIds, resolvedStrategyIds } = await resolveAttributeFilters(supabase, filters);
    const finalPromptIds = intersectIds(filters.promptIds, resolvedPromptIds);
    const finalStrategyIds = intersectIds(filters.strategyIds, resolvedStrategyIds);

    // Step 2: Build base run query with all filters
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    if (unitOfAnalysis === 'run') {
      const query = applyRunFilters(
        supabase.from('content_evolution_runs')
          .select('id, prompt_id, strategy_config_id, pipeline_type, status, total_cost_usd, total_variants, current_iteration, started_at, completed_at, created_at')
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1),
        filters, finalPromptIds, finalStrategyIds,
      );

      const { data: runs, error } = await query;
      if (error) throw new Error(`Failed to query runs: ${error.message}`);

      // Enrich with prompt/strategy labels
      const runRows = runs ?? [];
      const promptIds = [...new Set(runRows.map(r => r.prompt_id).filter(Boolean))] as string[];
      const strategyIds = [...new Set(runRows.map(r => r.strategy_config_id).filter(Boolean))] as string[];

      const [promptMap, strategyMap] = await Promise.all([
        resolvePromptTexts(supabase, promptIds),
        strategyIds.length
          ? supabase.from('strategy_configs').select('id, label').in('id', strategyIds)
              .then(r => new Map((r.data ?? []).map((s: { id: string; label: string }) => [s.id, s.label])))
          : Promise.resolve(new Map<string, string>()),
      ]);

      const enriched: ExplorerRunRow[] = runRows.map(r => ({
        ...r,
        prompt_text: r.prompt_id ? (promptMap.get(r.prompt_id) ?? null) : null,
        strategy_label: r.strategy_config_id ? (strategyMap.get(r.strategy_config_id) ?? null) : null,
      }));

      const totalCost = enriched.reduce((s, r) => s + (r.total_cost_usd ?? 0), 0);

      return {
        success: true,
        data: {
          runs: enriched,
          aggregation: {
            totalCount: enriched.length,
            avgElo: null,
            totalCost,
            avgCostPerUnit: enriched.length > 0 ? totalCost / enriched.length : null,
            topStrategy: null,
            topAgent: null,
          },
          totalCount: enriched.length,
        },
        error: null,
      };
    }

    if (unitOfAnalysis === 'article') {
      const runQuery = applyRunFilters(
        supabase.from('content_evolution_runs').select('id, prompt_id'),
        filters, finalPromptIds, finalStrategyIds,
      );
      const { data: filteredRuns } = await runQuery;
      const runIdList = (filteredRuns ?? []).map((r: { id: string }) => r.id);
      if (runIdList.length === 0) {
        return { success: true, data: { articles: [], aggregation: emptyAggregation(), totalCount: 0 }, error: null };
      }

      // Build prompt map from run data
      const promptMap = new Map<string, string>();
      for (const r of (filteredRuns ?? []) as Array<{ id: string; prompt_id: string | null }>) {
        if (r.prompt_id) promptMap.set(r.id, r.prompt_id);
      }

      let variantQuery = supabase
        .from('content_evolution_variants')
        .select('id, run_id, variant_content, elo_score, agent_name, generation, parent_variant_id, match_count, is_winner, created_at')
        .in('run_id', runIdList);

      if (filters.agentNames?.length) variantQuery = variantQuery.in('agent_name', filters.agentNames);
      if (filters.variantIds?.length) variantQuery = variantQuery.in('id', filters.variantIds);

      variantQuery = variantQuery.order('elo_score', { ascending: false }).range(offset, offset + limit - 1);

      const { data: variants, error } = await variantQuery;
      if (error) throw new Error(`Failed to query variants: ${error.message}`);

      // Enrich with hall-of-fame rank and prompt text
      const variantIds = (variants ?? []).map((v: { id: string }) => v.id);
      const { data: bankEntries } = variantIds.length
        ? await supabase.from('article_bank_entries').select('evolution_variant_id, rank').in('evolution_variant_id', variantIds)
        : { data: [] };

      const rankMap = new Map<string, number>();
      for (const entry of (bankEntries ?? []) as Array<{ evolution_variant_id: string; rank: number }>) {
        if (entry.evolution_variant_id && entry.rank) {
          rankMap.set(entry.evolution_variant_id, entry.rank);
        }
      }

      const promptTextMap = await resolvePromptTexts(supabase, [...new Set(Array.from(promptMap.values()))]);

      const articles: ExplorerArticleRow[] = (variants ?? []).map((v: Record<string, unknown>) => {
        const runId = v.run_id as string;
        const variantId = v.id as string;
        const runPromptId = promptMap.get(runId);

        return {
          id: variantId,
          run_id: runId,
          variant_content_preview: ((v.variant_content as string) ?? '').slice(0, 200),
          elo_score: v.elo_score as number,
          agent_name: v.agent_name as string,
          generation: v.generation as number,
          parent_variant_id: v.parent_variant_id as string | null,
          match_count: v.match_count as number,
          is_winner: v.is_winner as boolean,
          prompt_text: runPromptId ? (promptTextMap.get(runPromptId) ?? null) : null,
          hall_of_fame_rank: rankMap.get(variantId) ?? null,
          created_at: v.created_at as string,
        };
      });

      const avgElo = articles.length > 0 ? articles.reduce((s, a) => s + a.elo_score, 0) / articles.length : null;

      return {
        success: true,
        data: {
          articles,
          aggregation: {
            totalCount: articles.length,
            avgElo,
            totalCost: 0,
            avgCostPerUnit: null,
            topStrategy: null,
            topAgent: null,
          },
          totalCount: articles.length,
        },
        error: null,
      };
    }

    if (unitOfAnalysis === 'task') {
      const runQuery = applyRunFilters(
        supabase.from('content_evolution_runs').select('id, prompt_id'),
        filters, finalPromptIds, finalStrategyIds,
      );
      const { data: filteredRuns } = await runQuery;
      const runIdList = (filteredRuns ?? []).map((r: { id: string }) => r.id);
      if (runIdList.length === 0) {
        return { success: true, data: { tasks: [], aggregation: emptyAggregation(), totalCount: 0 }, error: null };
      }

      // Prompt map for enrichment
      const promptIdMap = new Map<string, string | null>();
      for (const r of (filteredRuns ?? []) as Array<{ id: string; prompt_id: string | null }>) {
        promptIdMap.set(r.id, r.prompt_id);
      }

      let taskQuery = supabase
        .from('evolution_run_agent_metrics')
        .select('id, run_id, agent_name, cost_usd, variants_generated, avg_elo, elo_gain, elo_per_dollar')
        .in('run_id', runIdList);

      if (filters.agentNames?.length) taskQuery = taskQuery.in('agent_name', filters.agentNames);

      taskQuery = taskQuery.order('elo_per_dollar', { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);

      const { data: metrics, error } = await taskQuery;
      if (error) throw new Error(`Failed to query agent metrics: ${error.message}`);

      const allPromptIds = [...new Set(Array.from(promptIdMap.values()).filter(Boolean))] as string[];
      const promptTextMap = await resolvePromptTexts(supabase, allPromptIds);

      const tasks: ExplorerTaskRow[] = (metrics ?? []).map((m: Record<string, unknown>) => {
        const runPromptId = promptIdMap.get(m.run_id as string);
        return {
          id: m.id as string,
          run_id: m.run_id as string,
          agent_name: m.agent_name as string,
          prompt_text: runPromptId ? (promptTextMap.get(runPromptId) ?? null) : null,
          cost_usd: m.cost_usd as number,
          variants_generated: m.variants_generated as number,
          avg_elo: m.avg_elo as number | null,
          elo_gain: m.elo_gain as number | null,
          elo_per_dollar: m.elo_per_dollar as number | null,
        };
      });

      const totalCost = tasks.reduce((s, t) => s + (t.cost_usd ?? 0), 0);
      const tasksWithElo = tasks.filter(t => t.avg_elo !== null);
      const avgElo = tasksWithElo.length > 0
        ? tasksWithElo.reduce((s, t) => s + (t.avg_elo ?? 0), 0) / tasksWithElo.length
        : null;

      return {
        success: true,
        data: {
          tasks,
          aggregation: {
            totalCount: tasks.length,
            avgElo,
            totalCost,
            avgCostPerUnit: tasks.length > 0 ? totalCost / tasks.length : null,
            topStrategy: null,
            topAgent: tasks.length > 0 ? tasks[0].agent_name : null,
          },
          totalCount: tasks.length,
        },
        error: null,
      };
    }

    throw new Error(`Invalid unit of analysis: ${unitOfAnalysis}`);
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getUnifiedExplorerAction') };
  }
}, 'getUnifiedExplorerAction');

export const getUnifiedExplorerAction = serverReadRequestId(_getUnifiedExplorerAction);

// ─── Matrix Mode: getExplorerMatrixAction ────────────────────────

export interface ExplorerMatrixInput {
  rowDimension: ExplorerDimension;
  colDimension: ExplorerDimension;
  metric: ExplorerMetric;
  filters: ExplorerFilters;
}

const _getExplorerMatrixAction = withLogging(async (
  input: ExplorerMatrixInput,
): Promise<ActionResult<ExplorerMatrixResult>> => {
  try {
    await requireAdmin();
    const { rowDimension, colDimension, metric, filters } = input;
    if (rowDimension === colDimension) {
      throw new Error('Row and column dimensions must be different');
    }

    const supabase = await createSupabaseServiceClient();
    const { resolvedPromptIds, resolvedStrategyIds } = await resolveAttributeFilters(supabase, filters);
    const finalPromptIds = intersectIds(filters.promptIds, resolvedPromptIds);
    const finalStrategyIds = intersectIds(filters.strategyIds, resolvedStrategyIds);

    const query = applyRunFilters(
      supabase.from('content_evolution_runs')
        .select('id, prompt_id, strategy_config_id, pipeline_type, status, total_cost_usd')
        .eq('status', 'completed'),
      filters, finalPromptIds, finalStrategyIds,
    );

    const { data: runs, error } = await query;
    if (error) throw new Error(`Failed to query runs for matrix: ${error.message}`);
    if (!runs || runs.length === 0) {
      return { success: true, data: { rows: [], cols: [], cells: [] }, error: null };
    }

    // Get Elo data if needed
    const runEloMap = new Map<string, number>();
    if (metric === 'avgElo' || metric === 'avgEloDollar') {
      const runIds = runs.map(r => r.id);
      const { data: variants } = await supabase
        .from('content_evolution_variants')
        .select('run_id, elo_score, is_winner')
        .in('run_id', runIds)
        .eq('is_winner', true);

      for (const v of (variants ?? []) as Array<{ run_id: string; elo_score: number }>) {
        runEloMap.set(v.run_id, v.elo_score);
      }
    }

    // For agent dimension, get agent metrics
    const runAgentMap = new Map<string, string[]>();
    if (rowDimension === 'agent' || colDimension === 'agent') {
      const runIds = runs.map(r => r.id);
      const { data: agentMetrics } = await supabase
        .from('evolution_run_agent_metrics')
        .select('run_id, agent_name')
        .in('run_id', runIds);

      const agentFilter = filters.agentNames?.length ? new Set(filters.agentNames) : null;
      for (const m of (agentMetrics ?? []) as Array<{ run_id: string; agent_name: string }>) {
        if (agentFilter && !agentFilter.has(m.agent_name)) continue;
        const list = runAgentMap.get(m.run_id) ?? [];
        list.push(m.agent_name);
        runAgentMap.set(m.run_id, list);
      }
    }

    // Resolve dimension labels
    const dimLabels = await resolveDimensionLabels(supabase, runs as RunRow[], rowDimension, colDimension);

    // Group runs by (row, col) and compute metric
    const cellMap = new Map<string, { values: number[]; count: number }>();
    const rowSet = new Map<string, string>();
    const colSet = new Map<string, string>();

    for (const run of runs as RunRow[]) {
      const rowKeys = getDimensionValues(run, rowDimension, runAgentMap);
      const colKeys = getDimensionValues(run, colDimension, runAgentMap);

      for (const rowKey of rowKeys) {
        for (const colKey of colKeys) {
          rowSet.set(rowKey, dimLabels.get(rowKey) ?? rowKey);
          colSet.set(colKey, dimLabels.get(colKey) ?? colKey);

          const key = `${rowKey}::${colKey}`;
          const cell = cellMap.get(key) ?? { values: [], count: 0 };
          cell.count++;

          const metricValue = computeRunMetric(run, metric, runEloMap);
          if (metricValue !== null) cell.values.push(metricValue);
          cellMap.set(key, cell);
        }
      }
    }

    const rows = [...rowSet.entries()].map(([id, label]) => ({ id, label }));
    const cols = [...colSet.entries()].map(([id, label]) => ({ id, label }));
    const cells: MatrixCell[] = [];

    for (const [key, cell] of cellMap) {
      const [rowId, colId] = key.split('::');
      const value = cell.values.length > 0
        ? (metric === 'runCount' || metric === 'totalCost'
            ? cell.values.reduce((a, b) => a + b, 0)
            : cell.values.reduce((a, b) => a + b, 0) / cell.values.length)
        : 0;
      cells.push({ rowId, colId, value, runCount: cell.count });
    }

    return { success: true, data: { rows, cols, cells }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getExplorerMatrixAction') };
  }
}, 'getExplorerMatrixAction');

export const getExplorerMatrixAction = serverReadRequestId(_getExplorerMatrixAction);

// ─── Trend Mode: getExplorerTrendAction ──────────────────────────

export interface ExplorerTrendInput {
  groupByDimension: ExplorerDimension;
  metric: ExplorerMetric;
  timeBucket: TimeBucket;
  filters: ExplorerFilters;
}

const _getExplorerTrendAction = withLogging(async (
  input: ExplorerTrendInput,
): Promise<ActionResult<ExplorerTrendResult>> => {
  try {
    await requireAdmin();
    const { groupByDimension, metric, timeBucket, filters } = input;

    const supabase = await createSupabaseServiceClient();
    const { resolvedPromptIds, resolvedStrategyIds } = await resolveAttributeFilters(supabase, filters);
    const finalPromptIds = intersectIds(filters.promptIds, resolvedPromptIds);
    const finalStrategyIds = intersectIds(filters.strategyIds, resolvedStrategyIds);

    const query = applyRunFilters(
      supabase.from('content_evolution_runs')
        .select('id, prompt_id, strategy_config_id, pipeline_type, status, total_cost_usd, created_at')
        .eq('status', 'completed')
        .order('created_at', { ascending: true }),
      filters, finalPromptIds, finalStrategyIds,
    );

    const { data: runs, error } = await query;
    if (error) throw new Error(`Failed to query runs for trend: ${error.message}`);
    if (!runs || runs.length === 0) {
      return { success: true, data: { series: [] }, error: null };
    }

    // Get agent data if needed
    const runAgentMap = new Map<string, string[]>();
    if (groupByDimension === 'agent') {
      const runIds = runs.map(r => r.id);
      const { data: agentMetrics } = await supabase
        .from('evolution_run_agent_metrics')
        .select('run_id, agent_name')
        .in('run_id', runIds);

      for (const m of (agentMetrics ?? []) as Array<{ run_id: string; agent_name: string }>) {
        const list = runAgentMap.get(m.run_id) ?? [];
        list.push(m.agent_name);
        runAgentMap.set(m.run_id, list);
      }
    }

    // Get Elo data if needed
    const runEloMap = new Map<string, number>();
    if (metric === 'avgElo' || metric === 'avgEloDollar') {
      const runIds = runs.map(r => r.id);
      const { data: variants } = await supabase
        .from('content_evolution_variants')
        .select('run_id, elo_score, is_winner')
        .in('run_id', runIds)
        .eq('is_winner', true);

      for (const v of (variants ?? []) as Array<{ run_id: string; elo_score: number }>) {
        runEloMap.set(v.run_id, v.elo_score);
      }
    }

    // Resolve dimension labels
    const dimLabels = await resolveDimensionLabels(supabase, runs as RunRow[], groupByDimension, groupByDimension);

    // Group by dimension + time bucket
    const seriesMap = new Map<string, Map<string, number[]>>();
    const dimRunCounts = new Map<string, number>();

    for (const run of runs as RunRow[]) {
      const dimKeys = getDimensionValues(run, groupByDimension, runAgentMap);
      const bucket = truncateToTimeBucket(run.created_at, timeBucket);

      for (const dimKey of dimKeys) {
        dimRunCounts.set(dimKey, (dimRunCounts.get(dimKey) ?? 0) + 1);

        if (!seriesMap.has(dimKey)) seriesMap.set(dimKey, new Map());
        const bucketMap = seriesMap.get(dimKey)!;
        if (!bucketMap.has(bucket)) bucketMap.set(bucket, []);

        const metricValue = computeRunMetric(run, metric, runEloMap);
        if (metricValue !== null) bucketMap.get(bucket)!.push(metricValue);
      }
    }

    // Limit to top 10 by run count, aggregate rest as "Other"
    const sortedDims = [...dimRunCounts.entries()].sort((a, b) => b[1] - a[1]);
    const top10 = new Set(sortedDims.slice(0, 10).map(([k]) => k));

    const series: TrendSeries[] = [];
    const otherBuckets = new Map<string, number[]>();

    for (const [dimKey, bucketMap] of seriesMap) {
      if (top10.has(dimKey)) {
        const points: TrendPoint[] = [...bucketMap.entries()].map(([date, values]) => ({
          date,
          value: aggregateMetricValues(values, metric),
        }));
        points.sort((a, b) => a.date.localeCompare(b.date));
        series.push({
          dimensionId: dimKey,
          dimensionLabel: dimLabels.get(dimKey) ?? dimKey,
          points,
        });
      } else {
        // Aggregate into "Other"
        for (const [bucket, values] of bucketMap) {
          const existing = otherBuckets.get(bucket) ?? [];
          existing.push(...values);
          otherBuckets.set(bucket, existing);
        }
      }
    }

    if (otherBuckets.size > 0) {
      const otherPoints: TrendPoint[] = [...otherBuckets.entries()].map(([date, values]) => ({
        date,
        value: aggregateMetricValues(values, metric),
      }));
      otherPoints.sort((a, b) => a.date.localeCompare(b.date));
      series.push({ dimensionId: 'other', dimensionLabel: 'Other', points: otherPoints });
    }

    return { success: true, data: { series }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getExplorerTrendAction') };
  }
}, 'getExplorerTrendAction');

export const getExplorerTrendAction = serverReadRequestId(_getExplorerTrendAction);

// ─── Article Detail: getExplorerArticleDetailAction ──────────────

const _getExplorerArticleDetailAction = withLogging(async (
  input: { runId: string; variantId?: string; agentName?: string },
): Promise<ActionResult<ExplorerArticleDetail | null>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    let query = supabase
      .from('content_evolution_variants')
      .select('id, variant_content, elo_score, agent_name, generation, parent_variant_id')
      .eq('run_id', input.runId);

    if (input.variantId) query = query.eq('id', input.variantId);
    if (input.agentName) query = query.eq('agent_name', input.agentName);

    const { data: variant, error } = await query.order('elo_score', { ascending: false }).limit(1).single();
    if (error || !variant) {
      return { success: true, data: null, error: null };
    }

    // Fetch parent content if exists
    let parentContent: string | null = null;
    if (variant.parent_variant_id) {
      const { data: parent } = await supabase
        .from('content_evolution_variants')
        .select('variant_content')
        .eq('id', variant.parent_variant_id)
        .single();
      parentContent = parent?.variant_content ?? null;
    }

    // Build lineage chain (walk up parent chain)
    const lineage: ExplorerArticleDetail['lineage'] = [];
    let currentParentId = variant.parent_variant_id;
    const visited = new Set<string>();
    while (currentParentId && !visited.has(currentParentId) && lineage.length < 10) {
      visited.add(currentParentId);
      const { data: ancestor } = await supabase
        .from('content_evolution_variants')
        .select('id, agent_name, generation, variant_content, parent_variant_id')
        .eq('id', currentParentId)
        .single();

      if (!ancestor) break;
      lineage.push({
        id: ancestor.id,
        agentName: ancestor.agent_name,
        generation: ancestor.generation,
        preview: (ancestor.variant_content ?? '').slice(0, 200),
      });
      currentParentId = ancestor.parent_variant_id;
    }

    return {
      success: true,
      data: {
        variantId: variant.id,
        content: variant.variant_content,
        parentContent,
        eloScore: variant.elo_score,
        agentName: variant.agent_name,
        generation: variant.generation,
        lineage,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getExplorerArticleDetailAction') };
  }
}, 'getExplorerArticleDetailAction');

export const getExplorerArticleDetailAction = serverReadRequestId(_getExplorerArticleDetailAction);

// ─── Shared Helpers ──────────────────────────────────────────────

interface RunRow {
  id: string;
  prompt_id: string | null;
  strategy_config_id: string | null;
  pipeline_type: string | null;
  status: string;
  total_cost_usd: number;
  created_at: string;
}

function getDimensionValues(
  run: RunRow,
  dimension: ExplorerDimension,
  runAgentMap: Map<string, string[]>,
): string[] {
  switch (dimension) {
    case 'prompt': return run.prompt_id ? [run.prompt_id] : [];
    case 'strategy': return run.strategy_config_id ? [run.strategy_config_id] : [];
    case 'pipelineType': return run.pipeline_type ? [run.pipeline_type] : [];
    case 'agent': return runAgentMap.get(run.id) ?? [];
  }
}

function computeRunMetric(
  run: RunRow,
  metric: ExplorerMetric,
  runEloMap: Map<string, number>,
): number | null {
  switch (metric) {
    case 'avgElo': return runEloMap.get(run.id) ?? null;
    case 'totalCost': return run.total_cost_usd;
    case 'runCount': return 1;
    case 'avgEloDollar': {
      const elo = runEloMap.get(run.id);
      return elo && run.total_cost_usd > 0 ? elo / run.total_cost_usd : null;
    }
    case 'successRate': return run.status === 'completed' ? 1 : 0;
  }
}

function aggregateMetricValues(values: number[], metric: ExplorerMetric): number {
  if (values.length === 0) return 0;
  if (metric === 'runCount' || metric === 'totalCost') {
    return values.reduce((a, b) => a + b, 0);
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function resolveDimensionLabels(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  runs: RunRow[],
  ...dimensions: ExplorerDimension[]
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const needsPrompt = dimensions.includes('prompt');
  const needsStrategy = dimensions.includes('strategy');

  if (needsPrompt) {
    const ids = [...new Set(runs.map(r => r.prompt_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data } = await supabase.from('article_bank_topics').select('id, title, prompt').in('id', ids);
      for (const p of (data ?? []) as Array<{ id: string; title: string | null; prompt: string }>) {
        labels.set(p.id, p.title ?? p.prompt.slice(0, 80));
      }
    }
  }

  if (needsStrategy) {
    const ids = [...new Set(runs.map(r => r.strategy_config_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data } = await supabase.from('strategy_configs').select('id, label').in('id', ids);
      for (const s of (data ?? []) as Array<{ id: string; label: string }>) {
        labels.set(s.id, s.label);
      }
    }
  }

  // Pipeline type and agent labels are self-descriptive
  for (const dim of dimensions) {
    if (dim === 'pipelineType') {
      for (const run of runs) {
        if (run.pipeline_type) labels.set(run.pipeline_type, run.pipeline_type);
      }
    }
  }

  return labels;
}

function truncateToTimeBucket(dateStr: string, bucket: TimeBucket): string {
  const date = new Date(dateStr);
  switch (bucket) {
    case 'day':
      return date.toISOString().slice(0, 10);
    case 'week': {
      // ISO week: Monday-based
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(date);
      monday.setDate(diff);
      return monday.toISOString().slice(0, 10);
    }
    case 'month':
      return date.toISOString().slice(0, 7) + '-01';
  }
}
