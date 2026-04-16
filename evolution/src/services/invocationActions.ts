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
  error_message: string | null;
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
  filterTestContent: z.boolean().optional(),
  successFilter: z.enum(['all', 'success', 'failed']).optional(),
  agentName: z.string().optional(),
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

    // Apply test-content filter via nested embedded !inner join:
    //   evolution_agent_invocations -> evolution_runs -> evolution_strategies (is_test_content=false)
    // Replaces the prior two-step round-trip (getTestStrategyIds then fetch run IDs then
    // .not.in) that silently failed when the IN list exceeded PostgREST URL limits.
    const wantsEmbed = !!parsed.filterTestContent;
    const baseFields = wantsEmbed
      ? 'id, run_id, agent_name, iteration, execution_order, success, cost_usd, duration_ms, error_message, created_at, evolution_runs!inner(evolution_strategies!inner(is_test_content))'
      : 'id, run_id, agent_name, iteration, execution_order, success, cost_usd, duration_ms, error_message, created_at';

    let query = supabase
      .from('evolution_agent_invocations')
      .select(baseFields, { count: 'exact' });

    if (parsed.runId) query = query.eq('run_id', parsed.runId);
    if (parsed.successFilter === 'success') query = query.eq('success', true);
    if (parsed.successFilter === 'failed') query = query.eq('success', false);
    if (parsed.agentName) {
      const escaped = parsed.agentName.replace(/[%_\\]/g, '\\$&');
      query = query.ilike('agent_name', `%${escaped}%`);
    }
    if (wantsEmbed) {
      query = query.eq('evolution_runs.evolution_strategies.is_test_content', false);
    }

    query = query.order('created_at', { ascending: false })
      .range(parsed.offset, parsed.offset + parsed.limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    // Cast via unknown — embedded-resource select doesn't parse cleanly into the generated types.
    return { items: (data ?? []) as unknown as InvocationListEntry[], total: count ?? 0 };
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
