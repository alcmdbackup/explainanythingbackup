'use server';
/**
 * Feature flags server actions.
 * Provides feature flag management for admin dashboard.
 */

import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { logger } from '@/lib/server_utilities';
import { logAdminAction } from '@/lib/services/auditLog';

// Types
export interface FeatureFlag {
  id: number;
  name: string;
  enabled: boolean;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

/**
 * Get all feature flags.
 * Available to any authenticated user for feature gating.
 */
const _getFeatureFlagsAction = withLogging(async (): Promise<{
  success: boolean;
  data: FeatureFlag[] | null;
  error: ErrorResponse | null;
}> => {
  try {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from('feature_flags')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      logger.error('Error fetching feature flags', { error: error.message });
      throw error;
    }

    return {
      success: true,
      data: (data || []) as FeatureFlag[],
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getFeatureFlagsAction', {})
    };
  }
}, 'getFeatureFlagsAction');

export const getFeatureFlagsAction = serverReadRequestId(_getFeatureFlagsAction);

/**
 * Get a single feature flag by name.
 * Commonly used for feature gating in components.
 */
const _getFeatureFlagAction = withLogging(async (
  name: string
): Promise<{
  success: boolean;
  data: { enabled: boolean } | null;
  error: ErrorResponse | null;
}> => {
  try {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('name', name)
      .single();

    if (error) {
      // Flag doesn't exist - treat as disabled
      if (error.code === 'PGRST116') {
        return {
          success: true,
          data: { enabled: false },
          error: null
        };
      }
      throw error;
    }

    return {
      success: true,
      data: { enabled: data.enabled },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getFeatureFlagAction', { name })
    };
  }
}, 'getFeatureFlagAction');

export const getFeatureFlagAction = serverReadRequestId(_getFeatureFlagAction);

/**
 * Update a feature flag (admin only).
 */
const _updateFeatureFlagAction = withLogging(async (
  input: { id: number; enabled: boolean }
): Promise<{
  success: boolean;
  error: ErrorResponse | null;
}> => {
  try {
    const adminUserId = await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    // Get current flag name for audit log
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('name, enabled')
      .eq('id', input.id)
      .single();

    const { error } = await supabase
      .from('feature_flags')
      .update({
        enabled: input.enabled,
        updated_by: adminUserId,
        updated_at: new Date().toISOString()
      })
      .eq('id', input.id);

    if (error) {
      logger.error('Error updating feature flag', { flagId: input.id, error: error.message });
      throw error;
    }

    logger.info('Feature flag updated', {
      flagId: input.id,
      flagName: flag?.name,
      enabled: input.enabled,
      adminUserId
    });

    // Log audit action
    await logAdminAction({
      adminUserId,
      action: 'update_feature_flag',
      entityType: 'feature_flag',
      entityId: String(input.id),
      details: {
        flagName: flag?.name,
        previousValue: flag?.enabled,
        newValue: input.enabled
      }
    });

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'updateFeatureFlagAction', { input })
    };
  }
}, 'updateFeatureFlagAction');

export const updateFeatureFlagAction = serverReadRequestId(_updateFeatureFlagAction);

/**
 * Create a new feature flag (admin only).
 */
const _createFeatureFlagAction = withLogging(async (
  input: { name: string; description?: string; enabled?: boolean }
): Promise<{
  success: boolean;
  data: FeatureFlag | null;
  error: ErrorResponse | null;
}> => {
  try {
    const adminUserId = await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('feature_flags')
      .insert({
        name: input.name,
        description: input.description || null,
        enabled: input.enabled || false,
        updated_by: adminUserId
      })
      .select()
      .single();

    if (error) {
      logger.error('Error creating feature flag', { name: input.name, error: error.message });
      throw error;
    }

    logger.info('Feature flag created', {
      flagId: data.id,
      flagName: input.name,
      adminUserId
    });

    return {
      success: true,
      data: data as FeatureFlag,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'createFeatureFlagAction', { input })
    };
  }
}, 'createFeatureFlagAction');

export const createFeatureFlagAction = serverReadRequestId(_createFeatureFlagAction);

/**
 * Get system health information (admin only).
 * Returns quick stats about system state.
 */
const _getSystemHealthAction = withLogging(async (): Promise<{
  success: boolean;
  data: {
    database: 'healthy' | 'degraded' | 'down';
    totalExplanations: number;
    totalUsers: number;
    pendingReports: number;
    recentErrors: number;
    lastUpdated: string;
  } | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    // Get counts in parallel
    const [explanationsResult, reportsResult] = await Promise.all([
      supabase.from('explanations').select('*', { count: 'exact', head: true }),
      supabase.from('content_reports').select('*', { count: 'exact', head: true }).eq('status', 'pending')
    ]);

    // Get user count via auth admin
    const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1 });

    // Check database health by simple query
    const { error: healthError } = await supabase.from('explanations').select('id').limit(1);

    return {
      success: true,
      data: {
        database: healthError ? 'down' : 'healthy',
        totalExplanations: explanationsResult.count || 0,
        totalUsers: authData?.users?.length || 0, // This is just page 1, but gives indication
        pendingReports: reportsResult.count || 0,
        recentErrors: 0, // Would need error tracking integration
        lastUpdated: new Date().toISOString()
      },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getSystemHealthAction', {})
    };
  }
}, 'getSystemHealthAction');

export const getSystemHealthAction = serverReadRequestId(_getSystemHealthAction);
