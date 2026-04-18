// Server actions for tactic × prompt performance analysis.
// Queries evolution_variants joined to evolution_runs, grouped by (agent_name, prompt_id).

'use server';

import { adminAction, type AdminContext } from './adminAction';

export interface TacticPromptPerformanceRow {
  tacticName: string;
  promptId: string;
  promptName: string;
  runs: number;
  variants: number;
  avgElo: number;
  bestElo: number;
  totalCost: number;
  winnerCount: number;
}

/**
 * Get tactic × prompt performance data. Filter by tacticName (for tactic detail "By Prompt" tab)
 * or by promptId (for prompt detail "Tactics" tab).
 */
export const getTacticPromptPerformanceAction = adminAction(
  'getTacticPromptPerformance',
  async (input: { tacticName?: string; promptId?: string }, ctx: AdminContext) => {
    // Query variants with their run's prompt_id
    let query = ctx.supabase
      .from('evolution_variants')
      .select('agent_name, mu, sigma, elo_score, cost_usd, is_winner, run_id, evolution_runs!inner(id, status, prompt_id, evolution_prompts!inner(id, name))')
      .not('agent_name', 'is', null)
      .eq('evolution_runs.status', 'completed');

    if (input.tacticName) {
      query = query.eq('agent_name', input.tacticName);
    }
    if (input.promptId) {
      query = query.eq('evolution_runs.prompt_id', input.promptId);
    }

    const { data, error } = await query.limit(5000);
    if (error) throw new Error(`Failed to query tactic-prompt performance: ${error.message}`);
    if (!data || data.length === 0) return [];

    // Group by (agent_name, prompt_id) and compute stats
    const groups = new Map<string, {
      tacticName: string; promptId: string; promptName: string;
      elos: number[]; costs: number[]; winners: number; runIds: Set<string>;
    }>();

    for (const row of data) {
      const run = row.evolution_runs as unknown as { id: string; prompt_id: string; evolution_prompts: { id: string; name: string } };
      if (!run?.prompt_id) continue;

      const key = `${row.agent_name}|${run.prompt_id}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          tacticName: row.agent_name as string,
          promptId: run.prompt_id,
          promptName: (run.evolution_prompts as { name: string })?.name ?? '',
          elos: [], costs: [], winners: 0, runIds: new Set(),
        };
        groups.set(key, group);
      }

      group.elos.push(row.elo_score ?? 1200);
      group.costs.push(row.cost_usd ?? 0);
      if (row.is_winner) group.winners++;
      group.runIds.add(run.id);
    }

    const result: TacticPromptPerformanceRow[] = [];
    for (const g of groups.values()) {
      const avgElo = g.elos.reduce((s, e) => s + e, 0) / g.elos.length;
      const bestElo = Math.max(...g.elos);
      const totalCost = g.costs.reduce((s, c) => s + c, 0);

      result.push({
        tacticName: g.tacticName,
        promptId: g.promptId,
        promptName: g.promptName,
        runs: g.runIds.size,
        variants: g.elos.length,
        avgElo: Math.round(avgElo),
        bestElo: Math.round(bestElo),
        totalCost,
        winnerCount: g.winners,
      });
    }

    // Sort by avg Elo descending
    result.sort((a, b) => b.avgElo - a.avgElo);
    return result;
  },
);
