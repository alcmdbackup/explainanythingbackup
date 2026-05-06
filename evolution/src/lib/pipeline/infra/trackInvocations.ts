// DB invocation row helpers for V2 pipeline phase tracking.

import type { SupabaseClient } from '@supabase/supabase-js';
import { evolutionAgentInvocationInsertSchema } from '../../schemas';
import type { EntityLogger } from './createEntityLogger';

function warn(logger: EntityLogger | undefined, message: string, ctx: Record<string, unknown>): void {
  if (logger) logger.warn(message, ctx);
  else console.warn(`[V2] ${message}: ${ctx.error ?? JSON.stringify(ctx)}`);
}

/** Create an invocation row for a pipeline phase. Returns UUID on success, null on error. */
export async function createInvocation(
  db: SupabaseClient,
  runId: string,
  iteration: number,
  phaseName: string,
  executionOrder: number,
  logger?: EntityLogger,
  /** Tactic name for agents that use tactics (e.g. GenerateFromSeedArticleAgent). Nullable. */
  tactic?: string,
): Promise<string | null> {
  try {
    const payload = evolutionAgentInvocationInsertSchema.parse({
      run_id: runId,
      agent_name: phaseName,
      iteration,
      execution_order: executionOrder,
      success: false,
    });
    const { data, error } = await db
      .from('evolution_agent_invocations')
      .insert({ ...payload, skipped: false, ...(tactic != null && { tactic }) })
      .select('id')
      .single();

    if (error) {
      warn(logger, 'createInvocation error', { phaseName, error: error.message });
      return null;
    }
    if (!data?.id) {
      warn(logger, 'createInvocation returned no ID', { phaseName });
    }
    return data?.id ?? null;
  } catch (err) {
    warn(logger, 'createInvocation exception', { phaseName, error: String(err).slice(0, 500) });
    return null;
  }
}

/** Update an invocation row with results. No-op if id is null. */
export async function updateInvocation(
  db: SupabaseClient,
  id: string | null,
  updates: {
    cost_usd: number;
    success: boolean;
    execution_detail?: Record<string, unknown>;
    error_message?: string;
    duration_ms?: number;
    /** B048: true=agent surfaced a variant; false=locally discarded; undefined=not applicable. */
    variant_surfaced?: boolean;
  },
  logger?: EntityLogger,
): Promise<void> {
  if (!id) return;

  try {
    // Partial-update semantics: only include fields the caller explicitly provided.
    // execution_detail and error_message use conditional-spread (matching duration_ms /
    // variant_surfaced below) so omitting them preserves the previously-written value.
    // Load-bearing for ReflectAndGenerateFromPreviousArticleAgent's wrapper-error path —
    // the wrapper writes partial reflection detail BEFORE rethrowing, then Agent.run()'s
    // catch handler updates cost/success/error_message WITHOUT execution_detail. With this
    // partial-update fix, the wrapper's partial detail is preserved on the row.
    const { error } = await db
      .from('evolution_agent_invocations')
      .update({
        cost_usd: updates.cost_usd,
        success: updates.success,
        ...(updates.execution_detail !== undefined && { execution_detail: updates.execution_detail }),
        ...(updates.error_message !== undefined && { error_message: updates.error_message }),
        ...(updates.duration_ms != null && { duration_ms: updates.duration_ms }),
        ...(updates.variant_surfaced !== undefined && { variant_surfaced: updates.variant_surfaced }),
      })
      .eq('id', id);

    if (error) warn(logger, 'updateInvocation error', { invocationId: id, error: error.message });
  } catch (err) {
    warn(logger, 'updateInvocation exception', { invocationId: id, error: String(err).slice(0, 500) });
  }
}
