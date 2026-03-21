'use server';
// Server actions for evolution agent invocations: list and detail.
// Provides paginated listing and single-invocation fetch for the admin UI.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';
import { z } from 'zod';

// ─── Types ───────────────────────────────────────────────────────

export interface InvocationListEntry {
  id: string;
  run_id: string;
  agent_name: string;
  iteration: number | null;
  execution_order: number | null;
  success: boolean;
  cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface InvocationDetail {
  id: string;
  run_id: string;
  agent_name: string;
  iteration: number | null;
  execution_order: number | null;
  success: boolean;
  cost_usd: number | null;
  duration_ms: number | null;
  error_message: string | null;
  execution_detail: Record<string, unknown> | null;
  created_at: string;
}

const listInvocationsInputSchema = z.object({
  runId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export type ListInvocationsInput = z.input<typeof listInvocationsInputSchema>;

// ─── Actions ─────────────────────────────────────────────────────

export const listInvocationsAction = adminAction(
  'listInvocationsAction',
  async (
    input: ListInvocationsInput,
    ctx: AdminContext,
  ): Promise<{ items: InvocationListEntry[]; total: number }> => {
    const parsed = listInvocationsInputSchema.parse(input);
    const { supabase } = ctx;

    let query = supabase
      .from('evolution_agent_invocations')
      .select('id, run_id, agent_name, iteration, execution_order, success, cost_usd, duration_ms, created_at', { count: 'exact' });

    if (parsed.runId) query = query.eq('run_id', parsed.runId);

    query = query.order('created_at', { ascending: false })
      .range(parsed.offset, parsed.offset + parsed.limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return { items: (data ?? []) as InvocationListEntry[], total: count ?? 0 };
  },
);

export const getInvocationDetailAction = adminAction(
  'getInvocationDetailAction',
  async (invocationId: string, ctx: AdminContext): Promise<InvocationDetail> => {
    if (!validateUuid(invocationId)) throw new Error('Invalid invocationId');
    const { supabase } = ctx;

    const { data, error } = await supabase
      .from('evolution_agent_invocations')
      .select('id, run_id, agent_name, iteration, execution_order, success, cost_usd, duration_ms, error_message, execution_detail, created_at')
      .eq('id', invocationId)
      .single();

    if (error) throw error;
    return data as InvocationDetail;
  },
);
