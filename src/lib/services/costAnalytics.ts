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

// Types
export interface CostSummary {
  totalCost: number;
  totalCalls: number;
  totalTokens: number;
  avgCostPerCall: number;
  periodStart: string;
  periodEnd: string;
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
    const endDate = filters.endDate || new Date().toISOString().split('T')[0];
    const startDate = filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let query = supabase
      .from('llmCallTracking')
      .select('estimated_cost_usd, total_tokens', { count: 'exact' })
      .gte('created_at', `${startDate}T00:00:00Z`)
      .lte('created_at', `${endDate}T23:59:59Z`);

    if (filters.model) {
      query = query.eq('model', filters.model);
    }
    if (filters.userId) {
      query = query.eq('userid', filters.userId);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error('Error fetching cost summary', { error: error.message });
      throw error;
    }

    const totalCalls = count || 0;
    const totalCost = data?.reduce((sum, row) => sum + (Number(row.estimated_cost_usd) || 0), 0) || 0;
    const totalTokens = data?.reduce((sum, row) => sum + (row.total_tokens || 0), 0) || 0;

    return {
      success: true,
      data: {
        totalCost,
        totalCalls,
        totalTokens,
        avgCostPerCall: totalCalls > 0 ? totalCost / totalCalls : 0,
        periodStart: startDate,
        periodEnd: endDate
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

    // Default to last 30 days
    const endDate = filters.endDate || new Date().toISOString().split('T')[0];
    const startDate = filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Use the daily_llm_costs view
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
    const endDate = filters.endDate || new Date().toISOString().split('T')[0];
    const startDate = filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let query = supabase
      .from('llmCallTracking')
      .select('model, prompt_tokens, completion_tokens, reasoning_tokens, total_tokens, estimated_cost_usd')
      .gte('created_at', `${startDate}T00:00:00Z`)
      .lte('created_at', `${endDate}T23:59:59Z`);

    if (filters.userId) {
      query = query.eq('userid', filters.userId);
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
    const endDate = filters.endDate || new Date().toISOString().split('T')[0];
    const startDate = filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let query = supabase
      .from('llmCallTracking')
      .select('userid, total_tokens, estimated_cost_usd')
      .gte('created_at', `${startDate}T00:00:00Z`)
      .lte('created_at', `${endDate}T23:59:59Z`);

    if (filters.model) {
      query = query.eq('model', filters.model);
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
    const { batchSize = 1000, dryRun = false } = options;

    // Get records without cost
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
      return {
        success: true,
        data: { processed: 0, updated: 0 },
        error: null
      };
    }

    let updated = 0;

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

        if (!updateError) {
          updated++;
        }
      }
    }

    logger.info('Cost backfill completed', {
      processed: records.length,
      updated,
      dryRun
    });

    // Log audit action (only for non-dry-run)
    if (!dryRun && updated > 0) {
      await logAdminAction({
        adminUserId,
        action: 'backfill_costs',
        entityType: 'system',
        entityId: 'llmCallTracking',
        details: { processed: records.length, updated }
      });
    }

    return {
      success: true,
      data: { processed: records.length, updated: dryRun ? 0 : updated },
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
