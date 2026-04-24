// Pure helpers for the cost-backfill script. Extracted so the helpers are
// testable without triggering the script's top-level dotenv + process.exit on
// missing env vars.

import type { SupabaseClient } from '@supabase/supabase-js';

export async function findRunsMissingCostMetric(db: SupabaseClient, singleRunId?: string): Promise<string[]> {
  if (singleRunId) {
    const { data: run } = await db.from('evolution_runs').select('id, status').eq('id', singleRunId).single();
    if (!run || run.status !== 'completed') return [];
    const { data: existing } = await db
      .from('evolution_metrics')
      .select('entity_id')
      .eq('entity_type', 'run').eq('entity_id', singleRunId).eq('metric_name', 'cost').limit(1);
    return (existing?.length ?? 0) > 0 ? [] : [singleRunId];
  }

  const completedRunIds: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('evolution_runs')
      .select('id')
      .eq('status', 'completed')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    completedRunIds.push(...data.map((r) => r.id as string));
    if (data.length < PAGE) break;
  }

  const haveCost = new Set<string>();
  const CHUNK = 100;
  for (let i = 0; i < completedRunIds.length; i += CHUNK) {
    const chunk = completedRunIds.slice(i, i + CHUNK);
    const { data, error } = await db
      .from('evolution_metrics')
      .select('entity_id')
      .eq('entity_type', 'run').eq('metric_name', 'cost').in('entity_id', chunk);
    if (error) throw error;
    for (const row of data ?? []) haveCost.add(row.entity_id as string);
  }
  return completedRunIds.filter((id) => !haveCost.has(id));
}

export async function computeCostsForRuns(db: SupabaseClient, runIds: string[]): Promise<Array<{ runId: string; cost: number }>> {
  const out: Array<{ runId: string; cost: number }> = [];
  const CHUNK = 100;
  for (let i = 0; i < runIds.length; i += CHUNK) {
    const chunk = runIds.slice(i, i + CHUNK);
    const { data, error } = await db
      .from('evolution_run_costs')
      .select('run_id, total_cost_usd')
      .in('run_id', chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      const v = Number((row as { total_cost_usd: unknown }).total_cost_usd);
      if (Number.isFinite(v) && v > 0) out.push({ runId: row.run_id as string, cost: v });
    }
  }
  return out;
}
