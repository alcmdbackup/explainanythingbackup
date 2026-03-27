'use server';
/**
 * Service for admin authentication and authorization.
 * Provides database-backed admin role checking for server-side enforcement.
 */

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';

/**
 * Check if the current authenticated user is an admin.
 * Uses the admin_users table for database-backed verification.
 *
 * @returns Promise<boolean> - true if user is authenticated and has admin role
 */
export async function isUserAdmin(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return false;
    }

    // Check admin_users table - RLS policy ensures we can only see our own record
    const { data: adminRecord, error } = await supabase
      .from('admin_users')
      .select('id')
      .eq('user_id', user.id)
      .limit(1);

    if (error) {
      logger.error('Error checking admin status', {
        userId: user.id,
        error: error.message
      });
      return false;
    }

    return adminRecord !== null && adminRecord.length > 0;
  } catch (error) {
    logger.error('Exception in isUserAdmin', { error });
    return false;
  }
}

/**
 * Require admin access for a server action.
 * Throws an error if the user is not authenticated or not an admin.
 * This should be called as the FIRST line of every admin server action.
 *
 * @returns Promise<string> - The admin user's ID if authorized
 * @throws Error - If user is not authenticated or not an admin
 *
 * @example
 * async function someAdminAction(params) {
 *   const adminUserId = await requireAdmin(); // FIRST LINE
 *   // ... rest of admin logic
 * }
 */
export async function requireAdmin(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized: Not authenticated');
  }

  // Check admin_users table - RLS policy ensures we can only see our own record
  const { data: adminRecord, error } = await supabase
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .limit(1);

  if (error) {
    logger.error('Error checking admin status in requireAdmin', {
      userId: user.id,
      error: error.message
    });
    throw new Error('Unauthorized: Failed to verify admin status');
  }

  if (!adminRecord || adminRecord.length === 0) {
    throw new Error('Unauthorized: Not an admin');
  }

  return user.id;
}

/**
 * Get admin user details for the current user.
 * Returns null if user is not an admin.
 *
 * @returns Promise<AdminUser | null> - Admin user record or null
 */
export interface AdminUser {
  id: number;
  user_id: string;
  role: string;
  created_at: string;
  created_by: string | null;
}

export async function getAdminUser(): Promise<AdminUser | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    const { data: adminRecord, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('user_id', user.id)
      .limit(1);

    if (error || !adminRecord || adminRecord.length === 0) {
      return null;
    }

    return adminRecord[0] as AdminUser;
  } catch (error) {
    logger.error('Exception in getAdminUser', { error });
    return null;
  }
}
