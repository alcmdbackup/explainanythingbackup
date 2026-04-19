// Server actions for the tactic entity — list and detail views.
// Tactic prompts come from the code registry (getTacticDef), not DB.

'use server';

import { adminAction, type AdminContext } from './adminAction';
import { getTacticDef } from '../lib/core/tactics';
import type { EvolutionTacticRow } from '../lib/core/entities/TacticEntity';

/** Tactic row enriched with code-defined prompt (for detail pages). */
export interface TacticDetailRow extends EvolutionTacticRow {
  preamble: string | null;
  instructions: string | null;
}

/** List all tactics with optional status filter. */
export const listTacticsAction = adminAction(
  'listTactics',
  async (input: { status?: string; agentType?: string; limit?: number; offset?: number }, ctx: AdminContext) => {
    let query = ctx.supabase
      .from('evolution_tactics')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true });

    if (input.status) query = query.eq('status', input.status);
    if (input.agentType) query = query.eq('agent_type', input.agentType);

    const limit = Math.min(input.limit ?? 100, 200);
    const offset = input.offset ?? 0;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(`Failed to list tactics: ${error.message}`);

    return { items: (data ?? []) as EvolutionTacticRow[], total: count ?? 0 };
  },
);

/** Get a single tactic by ID, enriched with code-defined prompt text. */
export const getTacticDetailAction = adminAction(
  'getTacticDetail',
  async (input: { tacticId: string }, ctx: AdminContext) => {
    const { data, error } = await ctx.supabase
      .from('evolution_tactics')
      .select('*')
      .eq('id', input.tacticId)
      .single();

    if (error || !data) throw new Error(`Tactic not found: ${input.tacticId}`);

    const row = data as EvolutionTacticRow;
    const codeDef = getTacticDef(row.name);

    const detail: TacticDetailRow = {
      ...row,
      preamble: codeDef?.preamble ?? null,
      instructions: codeDef?.instructions ?? null,
    };

    return detail;
  },
);

/** List variants produced by a specific tactic (by agent_name). */
export const getTacticVariantsAction = adminAction(
  'getTacticVariants',
  async (input: { tacticName: string; limit?: number; offset?: number }, ctx: AdminContext) => {
    const limit = Math.min(input.limit ?? 50, 200);
    const offset = input.offset ?? 0;

    const { data, count, error } = await ctx.supabase
      .from('evolution_variants')
      .select('id, run_id, elo_score, mu, sigma, is_winner, agent_name, created_at', { count: 'exact' })
      .eq('agent_name', input.tacticName)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`Failed to list tactic variants: ${error.message}`);
    return { items: data ?? [], total: count ?? 0 };
  },
);

/** List runs that used a specific tactic (via invocations with matching tactic). */
export const getTacticRunsAction = adminAction(
  'getTacticRuns',
  async (input: { tacticName: string; limit?: number; offset?: number }, ctx: AdminContext) => {
    const limit = Math.min(input.limit ?? 50, 200);
    const offset = input.offset ?? 0;

    // Get distinct run IDs from invocations with this tactic
    const { data: invocations, error: invError } = await ctx.supabase
      .from('evolution_agent_invocations')
      .select('run_id')
      .eq('tactic', input.tacticName)
      .not('run_id', 'is', null);

    if (invError) throw new Error(`Failed to query invocations: ${invError.message}`);
    const runIds = [...new Set((invocations ?? []).map(i => i.run_id as string))];
    if (runIds.length === 0) return { items: [], total: 0 };

    const totalRuns = runIds.length;

    // Paginate over the deduped run ID list, then fetch those runs.
    const pageIds = runIds.slice(offset, offset + limit);
    if (pageIds.length === 0) return { items: [], total: totalRuns };

    const { data: runs, error: runError } = await ctx.supabase
      .from('evolution_runs')
      .select('id, status, strategy_id, budget_cap_usd, created_at, completed_at')
      .in('id', pageIds)
      .order('created_at', { ascending: false });

    if (runError) throw new Error(`Failed to list runs: ${runError.message}`);
    return { items: runs ?? [], total: totalRuns };
  },
);
