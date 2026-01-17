'use server';
/**
 * Admin content management server actions.
 * Provides CRUD operations for managing explanations from the admin dashboard.
 */

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { logger } from '@/lib/server_utilities';
import { logAdminAction } from '@/lib/services/auditLog';

// Types for admin explanation data
export interface AdminExplanation {
  id: number;
  explanation_title: string;
  content: string;
  status: string;
  timestamp: string;
  primary_topic_id: number | null;
  secondary_topic_id: number | null;
  is_hidden: boolean;
  hidden_at: string | null;
  hidden_by: string | null;
  summary_teaser: string | null;
  meta_description: string | null;
}

export interface AdminExplanationFilters {
  search?: string;
  status?: string;
  showHidden?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'timestamp' | 'title' | 'id';
  sortOrder?: 'asc' | 'desc';
}

export interface AdminExplanationsResult {
  explanations: AdminExplanation[];
  total: number;
  hasMore: boolean;
}

/**
 * Get explanations for admin dashboard with filtering and pagination.
 * Admins can see all explanations including hidden ones.
 */
const _getAdminExplanationsAction = withLogging(async (
  filters: AdminExplanationFilters = {}
): Promise<{
  success: boolean;
  data: AdminExplanationsResult | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const {
      search = '',
      status,
      showHidden = true,
      limit = 50,
      offset = 0,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = filters;

    // Use service client to bypass RLS and see all content
    const supabase = await createSupabaseServiceClient();

    let query = supabase
      .from('explanations')
      .select('id, explanation_title, content, status, timestamp, primary_topic_id, secondary_topic_id, is_hidden, hidden_at, hidden_by, summary_teaser, meta_description', { count: 'exact' });

    // Apply filters
    if (search) {
      query = query.or(`explanation_title.ilike.%${search}%,content.ilike.%${search}%`);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (!showHidden) {
      query = query.or('is_hidden.eq.false,is_hidden.is.null');
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error('Error fetching admin explanations', { error: error.message });
      throw error;
    }

    return {
      success: true,
      data: {
        explanations: (data || []) as AdminExplanation[],
        total: count || 0,
        hasMore: (count || 0) > offset + limit
      },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getAdminExplanationsAction', { filters })
    };
  }
}, 'getAdminExplanationsAction');

export const getAdminExplanationsAction = serverReadRequestId(_getAdminExplanationsAction);

/**
 * Hide an explanation (soft delete).
 * Sets is_hidden=true rather than actually deleting.
 */
const _hideExplanationAction = withLogging(async (
  explanationId: number
): Promise<{
  success: boolean;
  error: ErrorResponse | null;
}> => {
  try {
    const adminUserId = await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    const { error } = await supabase
      .from('explanations')
      .update({
        is_hidden: true,
        hidden_at: new Date().toISOString(),
        hidden_by: adminUserId
      })
      .eq('id', explanationId);

    if (error) {
      logger.error('Error hiding explanation', { explanationId, error: error.message });
      throw error;
    }

    logger.info('Explanation hidden', { explanationId, adminUserId });

    // Log audit action
    await logAdminAction({
      adminUserId,
      action: 'hide_explanation',
      entityType: 'explanation',
      entityId: String(explanationId),
      details: {}
    });

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'hideExplanationAction', { explanationId })
    };
  }
}, 'hideExplanationAction');

export const hideExplanationAction = serverReadRequestId(_hideExplanationAction);

/**
 * Restore a hidden explanation.
 * Sets is_hidden=false to make it visible again.
 */
const _restoreExplanationAction = withLogging(async (
  explanationId: number
): Promise<{
  success: boolean;
  error: ErrorResponse | null;
}> => {
  try {
    const adminUserId = await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    const { error } = await supabase
      .from('explanations')
      .update({
        is_hidden: false,
        hidden_at: null,
        hidden_by: null
      })
      .eq('id', explanationId);

    if (error) {
      logger.error('Error restoring explanation', { explanationId, error: error.message });
      throw error;
    }

    logger.info('Explanation restored', { explanationId, adminUserId });

    // Log audit action
    await logAdminAction({
      adminUserId,
      action: 'restore_explanation',
      entityType: 'explanation',
      entityId: String(explanationId),
      details: {}
    });

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'restoreExplanationAction', { explanationId })
    };
  }
}, 'restoreExplanationAction');

export const restoreExplanationAction = serverReadRequestId(_restoreExplanationAction);

/**
 * Bulk hide multiple explanations.
 * Useful for handling spam or inappropriate content.
 */
const _bulkHideExplanationsAction = withLogging(async (
  explanationIds: number[]
): Promise<{
  success: boolean;
  data: { hiddenCount: number } | null;
  error: ErrorResponse | null;
}> => {
  try {
    const adminUserId = await requireAdmin();

    if (!explanationIds || explanationIds.length === 0) {
      return {
        success: false,
        data: null,
        error: { code: 'INVALID_INPUT', message: 'No explanation IDs provided' }
      };
    }

    // Limit bulk operations to prevent abuse
    if (explanationIds.length > 100) {
      return {
        success: false,
        data: null,
        error: { code: 'INVALID_INPUT', message: 'Cannot hide more than 100 explanations at once' }
      };
    }

    const supabase = await createSupabaseServiceClient();

    const { error, count } = await supabase
      .from('explanations')
      .update({
        is_hidden: true,
        hidden_at: new Date().toISOString(),
        hidden_by: adminUserId
      })
      .in('id', explanationIds);

    if (error) {
      logger.error('Error bulk hiding explanations', { count: explanationIds.length, error: error.message });
      throw error;
    }

    logger.info('Bulk hide completed', {
      explanationIds,
      hiddenCount: count || explanationIds.length,
      adminUserId
    });

    // Log audit action
    await logAdminAction({
      adminUserId,
      action: 'bulk_hide_explanations',
      entityType: 'explanation',
      entityId: 'bulk',
      details: { explanationIds, hiddenCount: count || explanationIds.length }
    });

    return {
      success: true,
      data: { hiddenCount: count || explanationIds.length },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'bulkHideExplanationsAction', { count: explanationIds.length })
    };
  }
}, 'bulkHideExplanationsAction');

export const bulkHideExplanationsAction = serverReadRequestId(_bulkHideExplanationsAction);

/**
 * Get a single explanation by ID for admin viewing.
 * Includes hidden explanations.
 */
const _getAdminExplanationByIdAction = withLogging(async (
  explanationId: number
): Promise<{
  success: boolean;
  data: AdminExplanation | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('explanations')
      .select('id, explanation_title, content, status, timestamp, primary_topic_id, secondary_topic_id, is_hidden, hidden_at, hidden_by, summary_teaser, meta_description')
      .eq('id', explanationId)
      .limit(1);

    if (error) {
      logger.error('Error fetching admin explanation', { explanationId, error: error.message });
      throw error;
    }

    if (!data || data.length === 0) {
      return {
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Explanation not found' }
      };
    }

    return {
      success: true,
      data: data[0] as AdminExplanation,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getAdminExplanationByIdAction', { explanationId })
    };
  }
}, 'getAdminExplanationByIdAction');

export const getAdminExplanationByIdAction = serverReadRequestId(_getAdminExplanationByIdAction);
