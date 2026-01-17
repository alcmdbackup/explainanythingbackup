'use server';
/**
 * User administration server actions.
 * Handles user listing, profile management, and account disable/enable.
 */

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { logger } from '@/lib/server_utilities';
import { logAdminAction } from '@/lib/services/auditLog';

// Types
export interface UserProfile {
  user_id: string;
  display_name: string | null;
  is_disabled: boolean;
  disabled_at: string | null;
  disabled_by: string | null;
  disabled_reason: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserWithStats {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  profile: UserProfile | null;
  stats: {
    explanationCount: number;
    llmCallCount: number;
    totalCost: number;
  };
}

export interface UserFilters {
  search?: string;
  showDisabled?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Get list of users with their profiles and usage stats.
 */
const _getAdminUsersAction = withLogging(async (
  filters: UserFilters = {}
): Promise<{
  success: boolean;
  data: { users: UserWithStats[]; total: number } | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const supabase = await createSupabaseServiceClient();
    const { search, showDisabled = true, limit = 50, offset = 0 } = filters;

    // Get users from auth.users via admin API
    // Note: This requires service role client
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers({
      page: Math.floor(offset / limit) + 1,
      perPage: limit
    });

    if (authError) {
      logger.error('Error fetching auth users', { error: authError.message });
      throw authError;
    }

    let users = authUsers.users || [];

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      users = users.filter(u =>
        u.email?.toLowerCase().includes(searchLower) ||
        u.id.toLowerCase().includes(searchLower)
      );
    }

    // Get profiles for these users
    const userIds = users.map(u => u.id);
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('*')
      .in('user_id', userIds);

    const profileMap = new Map<string, UserProfile>();
    for (const profile of profiles || []) {
      profileMap.set(profile.user_id, profile as UserProfile);
    }

    // Filter by disabled status if needed
    if (!showDisabled) {
      users = users.filter(u => {
        const profile = profileMap.get(u.id);
        return !profile?.is_disabled;
      });
    }

    // Get stats for each user (explanation count, LLM calls, cost)
    const usersWithStats: UserWithStats[] = await Promise.all(
      users.map(async (user) => {
        // Get explanation count
        const { count: explanationCount } = await supabase
          .from('explanations')
          .select('*', { count: 'exact', head: true })
          .eq('userid', user.id);

        // Get LLM call stats
        const { data: llmStats } = await supabase
          .from('llmCallTracking')
          .select('estimated_cost_usd')
          .eq('userid', user.id);

        const llmCallCount = llmStats?.length || 0;
        const totalCost = llmStats?.reduce((sum, row) => sum + (Number(row.estimated_cost_usd) || 0), 0) || 0;

        return {
          id: user.id,
          email: user.email || '',
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at || null,
          profile: profileMap.get(user.id) || null,
          stats: {
            explanationCount: explanationCount || 0,
            llmCallCount,
            totalCost
          }
        };
      })
    );

    return {
      success: true,
      data: {
        users: usersWithStats,
        total: authUsers.users.length
      },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getAdminUsersAction', { filters })
    };
  }
}, 'getAdminUsersAction');

export const getAdminUsersAction = serverReadRequestId(_getAdminUsersAction);

/**
 * Get a single user's detailed profile and activity.
 */
const _getAdminUserByIdAction = withLogging(async (
  userId: string
): Promise<{
  success: boolean;
  data: UserWithStats | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    // Get user from auth
    const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);

    if (authError || !authData.user) {
      return {
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'User not found' }
      };
    }

    const user = authData.user;

    // Get profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get stats
    const { count: explanationCount } = await supabase
      .from('explanations')
      .select('*', { count: 'exact', head: true })
      .eq('userid', userId);

    const { data: llmStats } = await supabase
      .from('llmCallTracking')
      .select('estimated_cost_usd')
      .eq('userid', userId);

    const llmCallCount = llmStats?.length || 0;
    const totalCost = llmStats?.reduce((sum, row) => sum + (Number(row.estimated_cost_usd) || 0), 0) || 0;

    return {
      success: true,
      data: {
        id: user.id,
        email: user.email || '',
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at || null,
        profile: profile as UserProfile || null,
        stats: {
          explanationCount: explanationCount || 0,
          llmCallCount,
          totalCost
        }
      },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getAdminUserByIdAction', { userId })
    };
  }
}, 'getAdminUserByIdAction');

export const getAdminUserByIdAction = serverReadRequestId(_getAdminUserByIdAction);

/**
 * Disable a user account.
 */
const _disableUserAction = withLogging(async (
  input: { userId: string; reason?: string }
): Promise<{
  success: boolean;
  error: ErrorResponse | null;
}> => {
  try {
    const adminUserId = await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    // Check if profile exists, create if not
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', input.userId)
      .single();

    const profileData = {
      is_disabled: true,
      disabled_at: new Date().toISOString(),
      disabled_by: adminUserId,
      disabled_reason: input.reason || null
    };

    if (existingProfile) {
      const { error } = await supabase
        .from('user_profiles')
        .update(profileData)
        .eq('user_id', input.userId);

      if (error) {
        logger.error('Error disabling user', { userId: input.userId, error: error.message });
        throw error;
      }
    } else {
      const { error } = await supabase
        .from('user_profiles')
        .insert({
          user_id: input.userId,
          ...profileData
        });

      if (error) {
        logger.error('Error creating disabled profile', { userId: input.userId, error: error.message });
        throw error;
      }
    }

    logger.info('User disabled', { userId: input.userId, adminUserId, reason: input.reason });

    // Log audit action
    await logAdminAction({
      adminUserId,
      action: 'disable_user',
      entityType: 'user',
      entityId: input.userId,
      details: { reason: input.reason || null }
    });

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'disableUserAction', { input })
    };
  }
}, 'disableUserAction');

export const disableUserAction = serverReadRequestId(_disableUserAction);

/**
 * Enable a previously disabled user account.
 */
const _enableUserAction = withLogging(async (
  userId: string
): Promise<{
  success: boolean;
  error: ErrorResponse | null;
}> => {
  try {
    const adminUserId = await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    const { error } = await supabase
      .from('user_profiles')
      .update({
        is_disabled: false,
        disabled_at: null,
        disabled_by: null,
        disabled_reason: null
      })
      .eq('user_id', userId);

    if (error) {
      logger.error('Error enabling user', { userId, error: error.message });
      throw error;
    }

    logger.info('User enabled', { userId, adminUserId });

    // Log audit action
    await logAdminAction({
      adminUserId,
      action: 'enable_user',
      entityType: 'user',
      entityId: userId,
      details: {}
    });

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'enableUserAction', { userId })
    };
  }
}, 'enableUserAction');

export const enableUserAction = serverReadRequestId(_enableUserAction);

/**
 * Update admin notes for a user.
 */
const _updateUserNotesAction = withLogging(async (
  input: { userId: string; notes: string }
): Promise<{
  success: boolean;
  error: ErrorResponse | null;
}> => {
  try {
    const adminUserId = await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    // Check if profile exists, create if not
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', input.userId)
      .single();

    if (existingProfile) {
      const { error } = await supabase
        .from('user_profiles')
        .update({ admin_notes: input.notes })
        .eq('user_id', input.userId);

      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('user_profiles')
        .insert({
          user_id: input.userId,
          admin_notes: input.notes
        });

      if (error) throw error;
    }

    // Log audit action
    await logAdminAction({
      adminUserId,
      action: 'update_user_notes',
      entityType: 'user',
      entityId: input.userId,
      details: { notesLength: input.notes.length }
    });

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'updateUserNotesAction', { input })
    };
  }
}, 'updateUserNotesAction');

export const updateUserNotesAction = serverReadRequestId(_updateUserNotesAction);

/**
 * Check if a user is disabled (for middleware use).
 * Returns true if the user is disabled, false otherwise.
 */
const _isUserDisabledAction = withLogging(async (
  userId: string
): Promise<{
  success: boolean;
  data: { isDisabled: boolean; reason: string | null } | null;
  error: ErrorResponse | null;
}> => {
  try {
    const supabase = await createSupabaseServiceClient();

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('is_disabled, disabled_reason')
      .eq('user_id', userId)
      .single();

    return {
      success: true,
      data: {
        isDisabled: profile?.is_disabled || false,
        reason: profile?.disabled_reason || null
      },
      error: null
    };
  } catch {
    // If no profile exists, user is not disabled
    return {
      success: true,
      data: { isDisabled: false, reason: null },
      error: null
    };
  }
}, 'isUserDisabledAction');

export const isUserDisabledAction = serverReadRequestId(_isUserDisabledAction);
