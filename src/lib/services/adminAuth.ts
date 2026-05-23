'use server';
/**
 * Service for admin authentication and authorization.
 * Provides database-backed admin role checking for server-side enforcement,
 * plus a hostname-tier assertion that locks admin functionality to the
 * evolution hostname (split_evolution_explainanythig_into_separate_websites_20260522).
 */

import { headers } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { classifyHost } from '@/config/hostnames';

/**
 * Defense-in-depth: refuse admin access from the public hostname.
 *
 * Tiers that pass: `evolution`, `local`, `preview`.
 * Tiers that fail: `public`, `unknown` (fail-closed).
 *
 * When called outside a request context (e.g. background jobs, the
 * minicomputer batch runner, build-time static generation), `headers()`
 * throws — we treat that as "no hostname to check" and pass through,
 * since those callers never have a Host header to begin with. The
 * middleware is the perimeter; this assertion is the second wall.
 *
 * @returns `true` if the host is acceptable for admin access, `false` if not.
 */
async function isHostAcceptableForAdmin(): Promise<boolean> {
  try {
    const h = await headers();
    const host = h.get('host');
    const tier = classifyHost(host);
    if (tier === 'public' || tier === 'unknown') {
      logger.warn('Admin access attempted from non-evolution host', { host, tier });
      return false;
    }
    return true;
  } catch {
    // Outside a request context (e.g. background job, build-time): no Host header to check.
    return true;
  }
}

/**
 * Check if the current authenticated user is an admin.
 * Uses the admin_users table for database-backed verification.
 *
 * Also runs the hostname assertion — admin status is only true when both
 * (a) the user is in `admin_users` AND (b) the request is on the evolution
 * hostname (or local/preview/non-request-context).
 *
 * @returns Promise<boolean> - true if user is authenticated and has admin role
 */
export async function isUserAdmin(): Promise<boolean> {
  try {
    if (!(await isHostAcceptableForAdmin())) {
      return false;
    }

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
 * Throws an error if the user is not authenticated, not an admin, or the
 * request is on the public hostname.
 * This should be called as the FIRST line of every admin server action.
 *
 * @returns Promise<string> - The admin user's ID if authorized
 * @throws Error - If user is not authenticated, not an admin, or host is wrong
 *
 * @example
 * async function someAdminAction(params) {
 *   const adminUserId = await requireAdmin(); // FIRST LINE
 *   // ... rest of admin logic
 * }
 */
export async function requireAdmin(): Promise<string> {
  if (!(await isHostAcceptableForAdmin())) {
    throw new Error('Unauthorized: Admin actions are not available from this hostname');
  }

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
 * Returns null if user is not an admin or host is not acceptable.
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
    if (!(await isHostAcceptableForAdmin())) {
      return null;
    }

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
