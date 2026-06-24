'use server';
/**
 * Cost analytics server actions for admin dashboard.
 * Provides LLM usage and cost data aggregations.
 */

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { logger } from '@/lib/server_utilities';
import { calculateLLMCost } from '@/config/llmPricing';
import { logAdminAction } from '@/lib/services/auditLog';
import { attributeCallSource, type CostCategory } from '@/lib/services/llmCostAttribution';

export type Granularity = 'hour' | 'day' | 'week';

export interface SpendBucket {
  bucket: string; // ISO timestamp of the date_trunc bucket
  evolutionCost: number;
  nonEvolutionCost: number;
  totalCost: number;
  callCount: number;
}

export interface EntityCost {
  entity: string;
  category: CostCategory;
  callCount: number;
  totalTokens: number;
  totalCost: number;
}

export interface EvolutionReconciliation {
  /** Evolution spend per llmCallTracking (known-incomplete since the 2026-02-23 audit gap). */
  trackingCost: number;
  /** Evolution spend per evolution_agent_invocations.cost_usd (source of truth for the gap). */
  invocationCost: number;
}

/** One row from the get_llm_spend_buckets RPC. */
interface SpendBucketRow {
  bucket: string;
  call_source: string;
  model: string;
  is_test: boolean;
  call_count: number;
  total_tokens: number;
  total_cost: number;
}

// Types
export interface CostSummary {
  totalCost: number;
  totalCalls: number;
  totalTokens: number;
  avgCostPerCall: number;
  periodStart: string;
  periodEnd: string;
  nullCostCount: number;  // Records with NULL estimated_cost_usd
  /** True when the total includes evolution spend from the invocation source of truth
   *  (COST_DASHBOARD_UNIFIED_EVOLUTION). The UI uses this to drop the "under-counted" banner. */
  evolutionMerged: boolean;
}

export interface DailyCost {
  date: string;
  callCount: number;
  totalTokens: number;
  totalCost: number;
}

export interface ModelCost {
  model: string;
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  totalCost: number;
}

export interface UserCost {
  userId: string;
  callCount: number;
  totalTokens: number;
  totalCost: number;
}

export interface CostFilters {
  startDate?: string;
  endDate?: string;
  model?: string;
  userId?: string;
  /** Time-bucket granularity for getSpendByGranularityAction. */
  granularity?: Granularity;
  /** When false, exclude is_test rows (default true = show everything). */
  includeTest?: boolean;
}

const VALID_GRANULARITIES: readonly Granularity[] = ['hour', 'day', 'week'];

/** Resolve a filter's [start, end) window to ISO timestamps (default: last 30 days). */
function resolveRange(filters: CostFilters): { start: string; end: string } {
  const now = new Date();
  const endRaw = filters.endDate || now.toISOString();
  const startRaw = filters.startDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    start: startRaw.includes('T') ? startRaw : `${startRaw}T00:00:00Z`,
    end: endRaw.includes('T') ? endRaw : `${endRaw}T23:59:59Z`,
  };
}

/** Fetch raw spend buckets via the RPC. Validates granularity at the app boundary
 *  (defense in depth — the SQL also whitelists it). */
async function fetchSpendBuckets(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  filters: CostFilters,
): Promise<SpendBucketRow[]> {
  const granularity: Granularity = filters.granularity ?? 'day';
  if (!VALID_GRANULARITIES.includes(granularity)) {
    throw new Error(`Invalid granularity: ${granularity}`);
  }
  const { start, end } = resolveRange(filters);
  const { data, error } = await supabase.rpc('get_llm_spend_buckets', {
    p_granularity: granularity,
    p_start: start,
    p_end: end,
    p_include_test: filters.includeTest ?? true,
  });
  if (error) {
    logger.error('Error fetching spend buckets', { error: error.message });
    throw error;
  }
  return (data ?? []) as SpendBucketRow[];
}

// ─── Canonical evolution-spend merge (llm_costs_too_low_in_dash_20260623) ───
// /admin/costs reads llmCallTracking, which is incomplete for evolution. Evolution spend is
// sourced at INVOCATION grain from evolution_agent_invocations (the source of truth every path
// populates) via the get_evolution_spend_buckets RPC, then merged app-side. Non-evolution rows
// stay in llmCallTracking; the dedup is a call_source filter (evolution rows are excluded from
// the non-evo side — equivalent to attributeCallSource(...).category !== 'evolution', since both
// reduce to a startsWith('evolution_') test). Gated by an env flag for safe, reversible rollout.

/** Single label used for evolution in the by-model / by-user tabs (no per-model/user grain). */
const EVOLUTION_PIPELINE_LABEL = 'evolution-pipeline';

/** Whether the canonical evolution merge is active. Unset/false ⇒ exact pre-merge behaviour. */
function unifiedEvolutionEnabled(): boolean {
  return process.env.COST_DASHBOARD_UNIFIED_EVOLUTION === 'true';
}

/** One row from the get_evolution_spend_buckets RPC. */
interface EvolutionSpendBucketRow {
  bucket: string;
  is_test: boolean;
  call_count: number;
  total_cost: number;
}

/** Fetch evolution spend buckets (invocation-grain) for the window/granularity. */
async function fetchEvolutionSpendBuckets(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  filters: CostFilters,
): Promise<EvolutionSpendBucketRow[]> {
  const granularity: Granularity = filters.granularity ?? 'day';
  const { start, end } = resolveRange(filters);
  const { data, error } = await supabase.rpc('get_evolution_spend_buckets', {
    p_granularity: granularity,
    p_start: start,
    p_end: end,
  });
  if (error) {
    logger.error('Error fetching evolution spend buckets', { error: error.message });
    throw error;
  }
  return (data ?? []) as EvolutionSpendBucketRow[];
}

/**
 * Total evolution spend (+ call count) in the window, honouring includeTest. Shared by the
 * summary headline and the reconciliation oracle so both compute identical invocation-grain math
 * (exact parity when includeTest matches). Granularity is irrelevant for a sum.
 */
async function evolutionSpendTotal(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  filters: CostFilters,
): Promise<{ cost: number; calls: number }> {
  const rows = await fetchEvolutionSpendBuckets(supabase, { ...filters, granularity: 'day' });
  const includeTest = filters.includeTest ?? true;
  let cost = 0;
  let calls = 0;
  for (const r of rows) {
    if (!includeTest && r.is_test) continue;
    cost += Number(r.total_cost) || 0;
    calls += Number(r.call_count) || 0;
  }
  return { cost, calls };
}

/**
 * Get cost summary for a time period.
 */
const _getCostSummaryAction = withLogging(async (
  filters: CostFilters = {}
): Promise<{
  success: boolean;
  data: CostSummary | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    // Default to last 30 days
    const now = new Date();
    const endDate = filters.endDate || now.toISOString();
    const startDate = filters.startDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Handle both date-only (YYYY-MM-DD) and full ISO timestamps
    const startTimestamp = startDate.includes('T') ? startDate : `${startDate}T00:00:00Z`;
    const endTimestamp = endDate.includes('T') ? endDate : `${endDate}T23:59:59Z`;

    let query = supabase
      .from('llmCallTracking')
      .select('estimated_cost_usd, total_tokens', { count: 'exact' })
      .gte('created_at', startTimestamp)
      .lte('created_at', endTimestamp);

    if (filters.model) {
      query = query.eq('model', filters.model);
    }
    if (filters.userId) {
      query = query.eq('userid', filters.userId);
    }
    // Respect the include-test toggle so the headline Total Cost reconciles with the provider bill
    // (excludes mock/$0 + test-runtime pollution when off). Default ON shows everything.
    if (filters.includeTest === false) {
      query = query.eq('is_test', false);
    }
    // Canonical merge: exclude evolution rows here — evolution spend is sourced from the
    // invocation source of truth below, so the llmCallTracking side is non-evolution only.
    if (unifiedEvolutionEnabled()) {
      query = query.not('call_source', 'like', 'evolution_%');
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error('Error fetching cost summary', { error: error.message });
      throw error;
    }

    // Count records with null cost in the same time range
    let nullCountQuery = supabase
      .from('llmCallTracking')
      .select('id', { count: 'exact', head: true })
      .is('estimated_cost_usd', null)
      .gte('created_at', startTimestamp)
      .lte('created_at', endTimestamp);

    if (filters.model) {
      nullCountQuery = nullCountQuery.eq('model', filters.model);
    }
    if (filters.userId) {
      nullCountQuery = nullCountQuery.eq('userid', filters.userId);
    }
    if (filters.includeTest === false) {
      nullCountQuery = nullCountQuery.eq('is_test', false);
    }
    if (unifiedEvolutionEnabled()) {
      nullCountQuery = nullCountQuery.not('call_source', 'like', 'evolution_%');
    }

    const { count: nullCount } = await nullCountQuery;

    let totalCalls = count || 0;
    let totalCost = data?.reduce((sum, row) => sum + (Number(row.estimated_cost_usd) || 0), 0) || 0;
    const totalTokens = data?.reduce((sum, row) => sum + (row.total_tokens || 0), 0) || 0;

    // Add evolution spend from the source of truth (evolution_agent_invocations), honouring
    // the same includeTest toggle. Skipped on model/user filters (evolution has no such grain).
    if (unifiedEvolutionEnabled() && !filters.model && !filters.userId) {
      const evo = await evolutionSpendTotal(supabase, filters);
      totalCost += evo.cost;
      totalCalls += evo.calls;
    }

    return {
      success: true,
      data: {
        totalCost,
        totalCalls,
        totalTokens,
        avgCostPerCall: totalCalls > 0 ? totalCost / totalCalls : 0,
        periodStart: startDate,
        periodEnd: endDate,
        nullCostCount: nullCount || 0,
        evolutionMerged: unifiedEvolutionEnabled(),
      },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getCostSummaryAction', { filters })
    };
  }
}, 'getCostSummaryAction');

export const getCostSummaryAction = serverReadRequestId(_getCostSummaryAction);

/**
 * Get daily cost breakdown for charting.
 */
const _getDailyCostsAction = withLogging(async (
  filters: CostFilters = {}
): Promise<{
  success: boolean;
  data: DailyCost[] | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    // Default to last 30 days - extract date part for daily view
    const now = new Date();
    const endDateRaw = filters.endDate || now.toISOString();
    const startDateRaw = filters.startDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    // Daily costs view uses date-only format
    const endDate = endDateRaw.includes('T') ? endDateRaw.split('T')[0] : endDateRaw;
    const startDate = startDateRaw.includes('T') ? startDateRaw.split('T')[0] : startDateRaw;

    // Use the daily_llm_costs view.
    // NOTE: this view does NOT project `is_test`, so the include-test toggle cannot be applied
    // app-side here (unlike Summary/ByModel/ByUser which query llmCallTracking directly). The
    // toggle-aware spend view is the Overview stacked chart (get_llm_spend_buckets RPC). Adding
    // `is_test` to the view (migration) to make this daily chart toggle-aware is a tracked follow-up.
    let query = supabase
      .from('daily_llm_costs')
      .select('date, call_count, total_tokens, total_cost_usd')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (filters.model) {
      query = query.eq('model', filters.model);
    }
    if (filters.userId) {
      query = query.eq('userid', filters.userId);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Error fetching daily costs', { error: error.message });
      throw error;
    }

    // Aggregate by date (view returns per-model per-user rows)
    const dateMap = new Map<string, DailyCost>();
    for (const row of data || []) {
      const dateStr = row.date as string;
      const existing = dateMap.get(dateStr);
      if (existing) {
        existing.callCount += Number(row.call_count) || 0;
        existing.totalTokens += Number(row.total_tokens) || 0;
        existing.totalCost += Number(row.total_cost_usd) || 0;
      } else {
        dateMap.set(dateStr, {
          date: dateStr,
          callCount: Number(row.call_count) || 0,
          totalTokens: Number(row.total_tokens) || 0,
          totalCost: Number(row.total_cost_usd) || 0
        });
      }
    }

    return {
      success: true,
      data: Array.from(dateMap.values()),
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getDailyCostsAction', { filters })
    };
  }
}, 'getDailyCostsAction');

export const getDailyCostsAction = serverReadRequestId(_getDailyCostsAction);

/**
 * Get cost breakdown by model.
 */
const _getCostByModelAction = withLogging(async (
  filters: CostFilters = {}
): Promise<{
  success: boolean;
  data: ModelCost[] | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    // Default to last 30 days
    const now = new Date();
    const endDate = filters.endDate || now.toISOString();
    const startDate = filters.startDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Handle both date-only (YYYY-MM-DD) and full ISO timestamps
    const startTimestamp = startDate.includes('T') ? startDate : `${startDate}T00:00:00Z`;
    const endTimestamp = endDate.includes('T') ? endDate : `${endDate}T23:59:59Z`;

    let query = supabase
      .from('llmCallTracking')
      .select('model, prompt_tokens, completion_tokens, reasoning_tokens, total_tokens, estimated_cost_usd')
      .gte('created_at', startTimestamp)
      .lte('created_at', endTimestamp);

    if (filters.userId) {
      query = query.eq('userid', filters.userId);
    }
    if (filters.includeTest === false) {
      query = query.eq('is_test', false);
    }
    if (unifiedEvolutionEnabled()) {
      query = query.not('call_source', 'like', 'evolution_%');
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Error fetching cost by model', { error: error.message });
      throw error;
    }

    // Aggregate by model
    const modelMap = new Map<string, ModelCost>();
    for (const row of data || []) {
      const model = row.model || 'unknown';
      const existing = modelMap.get(model);
      if (existing) {
        existing.callCount += 1;
        existing.promptTokens += row.prompt_tokens || 0;
        existing.completionTokens += row.completion_tokens || 0;
        existing.reasoningTokens += row.reasoning_tokens || 0;
        existing.totalTokens += row.total_tokens || 0;
        existing.totalCost += Number(row.estimated_cost_usd) || 0;
      } else {
        modelMap.set(model, {
          model,
          callCount: 1,
          promptTokens: row.prompt_tokens || 0,
          completionTokens: row.completion_tokens || 0,
          reasoningTokens: row.reasoning_tokens || 0,
          totalTokens: row.total_tokens || 0,
          totalCost: Number(row.estimated_cost_usd) || 0
        });
      }
    }

    if (unifiedEvolutionEnabled() && !filters.userId) {
      const evo = await evolutionSpendTotal(supabase, filters);
      if (evo.calls > 0 || evo.cost > 0) {
        // No per-model grain at invocation level → one rolled-up "evolution-pipeline" row.
        modelMap.set(EVOLUTION_PIPELINE_LABEL, {
          model: EVOLUTION_PIPELINE_LABEL,
          callCount: evo.calls,
          promptTokens: 0,
          completionTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          totalCost: evo.cost,
        });
      }
    }

    // Sort by total cost descending
    const result = Array.from(modelMap.values())
      .sort((a, b) => b.totalCost - a.totalCost);

    return {
      success: true,
      data: result,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getCostByModelAction', { filters })
    };
  }
}, 'getCostByModelAction');

export const getCostByModelAction = serverReadRequestId(_getCostByModelAction);

/**
 * Get cost breakdown by user (top spenders).
 */
const _getCostByUserAction = withLogging(async (
  filters: CostFilters & { limit?: number } = {}
): Promise<{
  success: boolean;
  data: UserCost[] | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const supabase = await createSupabaseServiceClient();
    const { limit = 20 } = filters;

    // Default to last 30 days
    const now = new Date();
    const endDate = filters.endDate || now.toISOString();
    const startDate = filters.startDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Handle both date-only (YYYY-MM-DD) and full ISO timestamps
    const startTimestamp = startDate.includes('T') ? startDate : `${startDate}T00:00:00Z`;
    const endTimestamp = endDate.includes('T') ? endDate : `${endDate}T23:59:59Z`;

    let query = supabase
      .from('llmCallTracking')
      .select('userid, total_tokens, estimated_cost_usd')
      .gte('created_at', startTimestamp)
      .lte('created_at', endTimestamp);

    if (filters.model) {
      query = query.eq('model', filters.model);
    }
    if (filters.includeTest === false) {
      query = query.eq('is_test', false);
    }
    if (unifiedEvolutionEnabled()) {
      query = query.not('call_source', 'like', 'evolution_%');
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Error fetching cost by user', { error: error.message });
      throw error;
    }

    // Aggregate by user
    const userMap = new Map<string, UserCost>();
    for (const row of data || []) {
      const userId = row.userid;
      if (!userId) continue;
      const existing = userMap.get(userId);
      if (existing) {
        existing.callCount += 1;
        existing.totalTokens += row.total_tokens || 0;
        existing.totalCost += Number(row.estimated_cost_usd) || 0;
      } else {
        userMap.set(userId, {
          userId,
          callCount: 1,
          totalTokens: row.total_tokens || 0,
          totalCost: Number(row.estimated_cost_usd) || 0
        });
      }
    }

    if (unifiedEvolutionEnabled() && !filters.model) {
      const evo = await evolutionSpendTotal(supabase, filters);
      if (evo.calls > 0 || evo.cost > 0) {
        userMap.set(EVOLUTION_PIPELINE_LABEL, {
          userId: EVOLUTION_PIPELINE_LABEL,
          callCount: evo.calls,
          totalTokens: 0,
          totalCost: evo.cost,
        });
      }
    }

    // Sort by total cost descending and limit
    const result = Array.from(userMap.values())
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, limit);

    return {
      success: true,
      data: result,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getCostByUserAction', { filters })
    };
  }
}, 'getCostByUserAction');

export const getCostByUserAction = serverReadRequestId(_getCostByUserAction);

/**
 * Backfill estimated costs for records that don't have them.
 * Processes all records with missing costs in batches for scalability.
 * Should be run once after migration, then costs are calculated on insert.
 */
const _backfillCostsAction = withLogging(async (
  options: { batchSize?: number; dryRun?: boolean } = {}
): Promise<{
  success: boolean;
  data: { processed: number; updated: number } | null;
  error: ErrorResponse | null;
}> => {
  try {
    const adminUserId = await requireAdmin();

    const supabase = await createSupabaseServiceClient();
    const { batchSize = 500, dryRun = false } = options;

    let totalProcessed = 0;
    let totalUpdated = 0;
    let hasMore = true;

    // Process all records in batches until none remain
    while (hasMore) {
      // Get next batch of records without cost
      const { data: records, error } = await supabase
        .from('llmCallTracking')
        .select('id, model, prompt_tokens, completion_tokens, reasoning_tokens')
        .is('estimated_cost_usd', null)
        .limit(batchSize);

      if (error) {
        logger.error('Error fetching records for backfill', { error: error.message });
        throw error;
      }

      if (!records || records.length === 0) {
        hasMore = false;
        break;
      }

      totalProcessed += records.length;

      if (!dryRun) {
        for (const record of records) {
          const cost = calculateLLMCost(
            record.model || '',
            record.prompt_tokens || 0,
            record.completion_tokens || 0,
            record.reasoning_tokens || 0
          );

          const { error: updateError } = await supabase
            .from('llmCallTracking')
            .update({ estimated_cost_usd: cost })
            .eq('id', record.id);

          if (updateError) {
            logger.warn('Cost backfill update failed', { recordId: record.id, error: updateError.message });
          } else {
            totalUpdated++;
          }
        }
      }

      // If we got fewer records than batch size, we're done
      if (records.length < batchSize) {
        hasMore = false;
      }

      logger.debug('Cost backfill batch completed', {
        batchSize: records.length,
        totalProcessed,
        totalUpdated
      });
    }

    logger.info('Cost backfill completed', {
      processed: totalProcessed,
      updated: totalUpdated,
      dryRun
    });

    // B062: always audit non-dry-runs, even when nothing got updated. A run that
    // processes rows but fails every UPDATE (`totalUpdated === 0`) is exactly the
    // case we most want a trail for — silently skipping the audit log let those
    // incidents vanish.
    if (!dryRun) {
      await logAdminAction({
        adminUserId,
        action: 'backfill_costs',
        entityType: 'system',
        entityId: 'llmCallTracking',
        details: { processed: totalProcessed, updated: totalUpdated }
      });
    }

    return {
      success: true,
      data: { processed: totalProcessed, updated: dryRun ? 0 : totalUpdated },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'backfillCostsAction', { options })
    };
  }
}, 'backfillCostsAction');

export const backfillCostsAction = serverReadRequestId(_backfillCostsAction);

/**
 * Spend over time at hour/day/week granularity, split by evolution vs non-evolution.
 * Powers the dashboard's stacked time chart.
 */
const _getSpendByGranularityAction = withLogging(async (
  filters: CostFilters = {}
): Promise<{ success: boolean; data: SpendBucket[] | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();
    const merge = unifiedEvolutionEnabled();
    const rows = await fetchSpendBuckets(supabase, filters);

    const byBucket = new Map<string, SpendBucket>();
    const emptyBucket = (bucket: string): SpendBucket => ({
      bucket, evolutionCost: 0, nonEvolutionCost: 0, totalCost: 0, callCount: 0,
    });
    for (const row of rows) {
      const { category } = attributeCallSource(row.call_source);
      // When merging, evolution comes from the invocation source of truth below; skip the
      // incomplete evolution rows in llmCallTracking so they aren't double-counted.
      if (merge && category === 'evolution') continue;
      const cost = Number(row.total_cost) || 0;
      const existing = byBucket.get(row.bucket) ?? emptyBucket(row.bucket);
      if (category === 'evolution') existing.evolutionCost += cost;
      else existing.nonEvolutionCost += cost;
      existing.totalCost += cost;
      existing.callCount += Number(row.call_count) || 0;
      byBucket.set(row.bucket, existing);
    }

    if (merge) {
      const includeTest = filters.includeTest ?? true;
      const evoRows = await fetchEvolutionSpendBuckets(supabase, filters);
      for (const row of evoRows) {
        if (!includeTest && row.is_test) continue;
        const cost = Number(row.total_cost) || 0;
        const existing = byBucket.get(row.bucket) ?? emptyBucket(row.bucket);
        existing.evolutionCost += cost;
        existing.totalCost += cost;
        existing.callCount += Number(row.call_count) || 0;
        byBucket.set(row.bucket, existing);
      }
    }

    return {
      success: true,
      data: Array.from(byBucket.values()).sort((a, b) => a.bucket.localeCompare(b.bucket)),
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getSpendByGranularityAction', { filters }) };
  }
}, 'getSpendByGranularityAction');

export const getSpendByGranularityAction = serverReadRequestId(_getSpendByGranularityAction);

/**
 * Spend grouped by the entity responsible for the call (folded from call_source via the
 * canonical attribution map). Powers the dashboard's "Spend by Entity" table.
 */
const _getCostByEntityAction = withLogging(async (
  filters: CostFilters = {}
): Promise<{ success: boolean; data: EntityCost[] | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();
    const merge = unifiedEvolutionEnabled();
    const rows = await fetchSpendBuckets(supabase, filters);

    const byEntity = new Map<string, EntityCost>();
    for (const row of rows) {
      const { entity, category } = attributeCallSource(row.call_source);
      // When merging, evolution is a single entity sourced from invocations below.
      if (merge && category === 'evolution') continue;
      const existing = byEntity.get(entity) ?? {
        entity,
        category,
        callCount: 0,
        totalTokens: 0,
        totalCost: 0,
      };
      existing.callCount += Number(row.call_count) || 0;
      existing.totalTokens += Number(row.total_tokens) || 0;
      existing.totalCost += Number(row.total_cost) || 0;
      byEntity.set(entity, existing);
    }

    if (merge) {
      const evo = await evolutionSpendTotal(supabase, filters);
      if (evo.calls > 0 || evo.cost > 0) {
        // Evolution has no per-model/token grain at invocation level → one rolled-up entity.
        byEntity.set(EVOLUTION_PIPELINE_LABEL, {
          entity: EVOLUTION_PIPELINE_LABEL,
          category: 'evolution',
          callCount: evo.calls,
          totalTokens: 0,
          totalCost: evo.cost,
        });
      }
    }

    return {
      success: true,
      data: Array.from(byEntity.values()).sort((a, b) => b.totalCost - a.totalCost),
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getCostByEntityAction', { filters }) };
  }
}, 'getCostByEntityAction');

export const getCostByEntityAction = serverReadRequestId(_getCostByEntityAction);

/**
 * Reconcile evolution spend: llmCallTracking-based total vs evolution_agent_invocations.cost_usd.
 * The tracking table under-counts evolution spend since the 2026-02-23 audit gap, so the
 * dashboard surfaces both and warns when the invocation total is materially higher.
 */
const _getEvolutionReconciliationAction = withLogging(async (
  filters: CostFilters = {}
): Promise<{ success: boolean; data: EvolutionReconciliation | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();
    const { start, end } = resolveRange(filters);

    // Tracking-based evolution spend (call_source prefix).
    const { data: trackRows, error: trackErr } = await supabase
      .from('llmCallTracking')
      .select('estimated_cost_usd')
      .like('call_source', 'evolution_%')
      .gte('created_at', start)
      .lte('created_at', end);
    if (trackErr) {
      logger.error('Error fetching evolution tracking cost', { error: trackErr.message });
      throw trackErr;
    }
    const trackingCost = (trackRows ?? []).reduce((s, r) => s + (Number(r.estimated_cost_usd) || 0), 0);

    // Invocation-based evolution spend (source of truth for the audit-gap window). Sourced via
    // the SAME shared helper the dashboard summary uses, so the two compute identical
    // invocation-grain math. includeTest:true ⇒ count all invocations (the oracle's all-up sum).
    const { cost: invocationCost } = await evolutionSpendTotal(supabase, { ...filters, includeTest: true });

    return { success: true, data: { trackingCost, invocationCost }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionReconciliationAction', { filters }) };
  }
}, 'getEvolutionReconciliationAction');

export const getEvolutionReconciliationAction = serverReadRequestId(_getEvolutionReconciliationAction);
