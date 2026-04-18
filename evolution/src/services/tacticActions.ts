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
