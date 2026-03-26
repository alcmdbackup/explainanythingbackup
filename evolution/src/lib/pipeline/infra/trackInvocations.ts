// DB invocation row helpers for V2 pipeline phase tracking.

import type { SupabaseClient } from '@supabase/supabase-js';
import { evolutionAgentInvocationInsertSchema } from '../../schemas';
import type { EntityLogger } from './createEntityLogger';

/**
 * Create an invocation row for a pipeline phase. Returns UUID on success, null on error.
 */
export async function createInvocation(
  db: SupabaseClient,
  runId: string,
  iteration: number,
  phaseName: string,
  executionOrder: number,
  logger?: EntityLogger,
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
      .insert({ ...payload, skipped: false })
      .select('id')
      .single();

    if (error) {
      if (logger) { logger.warn('createInvocation error', { phaseName, error: error.message }); } else { console.warn(`[V2] createInvocation error: ${error.message}`); }
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    if (logger) { logger.warn('createInvocation exception', { phaseName, error: String(err).slice(0, 500) }); } else { console.warn(`[V2] createInvocation exception: ${err}`); }
    return null;
  }
}

/**
 * Update an invocation row with results. No-op if id is null.
 */
export async function updateInvocation(
  db: SupabaseClient,
  id: string | null,
  updates: {
    cost_usd: number;
    success: boolean;
    execution_detail?: Record<string, unknown>;
    error_message?: string;
    duration_ms?: number;
  },
  logger?: EntityLogger,
): Promise<void> {
  if (!id) return;

  try {
    const { error } = await db
      .from('evolution_agent_invocations')
      .update({
        cost_usd: updates.cost_usd,
        success: updates.success,
        execution_detail: updates.execution_detail ?? null,
        error_message: updates.error_message ?? null,
        ...(updates.duration_ms != null && { duration_ms: updates.duration_ms }),
      })
      .eq('id', id);

    if (error) {
      if (logger) { logger.warn('updateInvocation error', { invocationId: id, error: error.message }); } else { console.warn(`[V2] updateInvocation error: ${error.message}`); }
    }
  } catch (err) {
    if (logger) { logger.warn('updateInvocation exception', { invocationId: id, error: String(err).slice(0, 500) }); } else { console.warn(`[V2] updateInvocation exception: ${err}`); }
  }
}
