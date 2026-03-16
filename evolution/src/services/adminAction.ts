// Factory for admin-only server actions with auth, logging, error handling, and Supabase client.
// Must NOT have 'use server' at top — it only exports the factory, not client-callable actions.

import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { requireAdmin } from '@/lib/services/adminAuth';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { isNextRouterError } from 'next/dist/client/components/is-next-router-error';
import type { ActionResult } from './shared';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────────

export interface AdminContext {
  supabase: SupabaseClient;
  adminUserId: string;
}

// ─── Factory ─────────────────────────────────────────────────────

/**
 * Create an admin-only server action with auth, logging, error handling.
 * Supports zero-argument and single-argument handlers via function arity detection.
 */
export function adminAction<T>(
  name: string,
  handler: (ctx: AdminContext) => Promise<T>,
): () => Promise<ActionResult<T>>;
export function adminAction<I, T>(
  name: string,
  handler: (input: I, ctx: AdminContext) => Promise<T>,
): (input: I) => Promise<ActionResult<T>>;
export function adminAction<I = void, T = unknown>(
  name: string,
  handler: ((ctx: AdminContext) => Promise<T>) | ((input: I, ctx: AdminContext) => Promise<T>),
): ((...args: unknown[]) => Promise<ActionResult<T>>) {
  // Detect arity: handler.length === 1 means zero-arg (ctx only)
  const isZeroArg = handler.length <= 1;

  const wrappedFn = withLogging(async (...args: unknown[]): Promise<ActionResult<T>> => {
    try {
      const adminUserId = await requireAdmin();
      const supabase = await createSupabaseServiceClient();
      const ctx: AdminContext = { supabase, adminUserId };

      let result: T;
      if (isZeroArg) {
        result = await (handler as (ctx: AdminContext) => Promise<T>)(ctx);
      } else {
        result = await (handler as (input: I, ctx: AdminContext) => Promise<T>)(args[0] as I, ctx);
      }

      return { success: true, data: result, error: null };
    } catch (error) {
      // Re-throw Next.js router errors (redirect/notFound)
      if (isNextRouterError(error)) throw error;

      const errorResponse: ErrorResponse = handleError(error, `adminAction:${name}`);
      return { success: false, data: null, error: errorResponse };
    }
  }, name);

  return serverReadRequestId(wrappedFn);
}
