// Factory for unauthed public server actions (Phase 1 of build_website_for_evolutiOn_20260626).
// Mirrors `adminAction` minus `requireAdmin()`. Wraps a handler with withLogging +
// serverReadRequestId + a service-role Supabase client and returns the same
// {success, data, error} ActionResult envelope.
//
// Used by: submitPublicEditAction, getEditRunStatusAction, listPublicStrategiesAction.
//
// Security model: the absence of auth is by design — the public /edit surface is
// unauthed (research doc Q7). Cost / abuse protection is enforced by:
// - per-IP + per-region Upstash gate (perIpSpendingGate.ts)
// - per-user shared-guest-pool LLM cap (LLMSpendingGate.reserveForUser)
// - per-run evolution_runs.budget_cap_usd
// - Vercel BotID at the route layer
// Each public action MUST validate inputs and threading these layers itself; the
// factory is intentionally thin.

import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { isNextRouterError } from 'next/dist/client/components/is-next-router-error';
import type { ActionResult } from './shared';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────────

export interface PublicContext {
  supabase: SupabaseClient;
}

// ─── Factory ─────────────────────────────────────────────────────

/**
 * Create an unauthed public server action with logging + error handling +
 * service-role Supabase client.
 */
export function publicAction<T>(
  name: string,
  handler: (ctx: PublicContext) => Promise<T>,
): () => Promise<ActionResult<T>>;
export function publicAction<I, T>(
  name: string,
  handler: (input: I, ctx: PublicContext) => Promise<T>,
): (input?: I) => Promise<ActionResult<T>>;
export function publicAction<I = void, T = unknown>(
  name: string,
  handler: ((ctx: PublicContext) => Promise<T>) | ((input: I, ctx: PublicContext) => Promise<T>),
): ((...args: unknown[]) => Promise<ActionResult<T>>) {
  // Same arity detection as adminAction (B061 fix).
  const isZeroArg = handler.length === 1;

  const wrappedFn = withLogging(async (...args: unknown[]): Promise<ActionResult<T>> => {
    try {
      const supabase = await createSupabaseServiceClient();
      const ctx: PublicContext = { supabase };

      let result: T;
      if (isZeroArg) {
        result = await (handler as (ctx: PublicContext) => Promise<T>)(ctx);
      } else {
        result = await (handler as (input: I, ctx: PublicContext) => Promise<T>)(args[0] as I, ctx);
      }

      return { success: true, data: result, error: null };
    } catch (error) {
      // Re-throw Next.js router errors (redirect/notFound) so they propagate to the framework.
      if (isNextRouterError(error)) throw error;

      const errorResponse: ErrorResponse = handleError(error, `publicAction:${name}`);
      return { success: false, data: null, error: errorResponse };
    }
  }, name);

  return serverReadRequestId(wrappedFn);
}
