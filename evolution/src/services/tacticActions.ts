// Server actions for the tactic entity — list and detail views.
// Tactic prompts come from the code registry (getTacticDef), not DB.

'use server';

import { adminAction, type AdminContext } from './adminAction';
import { getTacticDef } from '../lib/core/tactics';
import { TacticEntity, type EvolutionTacticRow } from '../lib/core/entities/TacticEntity';
import { getMetricsForEntities } from '../lib/metrics/readMetrics';
import type { MetricRow } from '../lib/metrics/types';

/** Tactic row enriched with code-defined prompt (for detail pages). */
export interface TacticDetailRow extends EvolutionTacticRow {
  preamble: string | null;
  instructions: string | null;
}

/** Tactic row with attached metric rows for leaderboard rendering (Phase 2). */
export interface TacticListRow extends EvolutionTacticRow {
  metrics: MetricRow[];
}

// Columns that can be sorted server-side via .order() on evolution_tactics.
const IDENTITY_SORT_KEYS = new Set(['name', 'label', 'category', 'created_at', 'status', 'agent_type']);

// listView metric names derived once from the entity registry so the leaderboard keeps
// in sync if Phase 1's TacticEntity.metrics listView flags change.
const LIST_VIEW_METRIC_NAMES: readonly string[] = new TacticEntity().metrics.atFinalization
  .filter((d) => d.listView)
  .map((d) => d.name);

function compareMetricValues(
  a: MetricRow | undefined,
  b: MetricRow | undefined,
  dir: 'asc' | 'desc',
): number {
  // Null / undefined values always sort last regardless of direction — signals "unproven tactic".
  const aNull = a == null;
  const bNull = b == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const sign = dir === 'asc' ? 1 : -1;
  return (a!.value - b!.value) * sign;
}

/** List all tactics with optional filters, search, sort, and attached listView metrics. */
export const listTacticsAction = adminAction(
  'listTactics',
  async (
    input: {
      status?: string;
      agentType?: string;
      search?: string;
      sortKey?: string;
      sortDir?: 'asc' | 'desc';
      limit?: number;
      offset?: number;
    },
    ctx: AdminContext,
  ) => {
    // Identity-column sort happens server-side; metric-key sort happens JS-side after
    // the batch metric fetch below.
    const identitySortKey = input.sortKey && IDENTITY_SORT_KEYS.has(input.sortKey)
      ? input.sortKey
      : 'created_at';
    const ascending = input.sortDir !== 'desc';

    let query = ctx.supabase
      .from('evolution_tactics')
      .select('*', { count: 'exact' });

    if (input.status) query = query.eq('status', input.status);
    if (input.agentType) query = query.eq('agent_type', input.agentType);
    if (input.search) {
      const escaped = input.search.replace(/[%_\\]/g, '\\$&');
      query = query.ilike('name', `%${escaped}%`);
    }

    query = query.order(identitySortKey, { ascending });

    const limit = Math.min(input.limit ?? 100, 200);
    const offset = input.offset ?? 0;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(`Failed to list tactics: ${error.message}`);

    const rows = (data ?? []) as EvolutionTacticRow[];

    // Batch-fetch listView metrics for the page's tactic IDs. Chunked internally to 100.
    const metricsMap = rows.length > 0
      ? await getMetricsForEntities(ctx.supabase, 'tactic', rows.map((r) => r.id), [...LIST_VIEW_METRIC_NAMES])
      : new Map<string, MetricRow[]>();

    let items: TacticListRow[] = rows.map((r) => ({
      ...r,
      metrics: metricsMap.get(r.id) ?? [],
    }));

    // Metric-key sort: applied JS-side on the already-attached metrics array since
    // evolution_metrics is a separate table and a JOIN-style query would be heavier
    // for the 24-tactic scale this page operates at.
    if (input.sortKey && !IDENTITY_SORT_KEYS.has(input.sortKey)) {
      const metricName = input.sortKey;
      const dir: 'asc' | 'desc' = input.sortDir ?? 'desc';
      items = [...items].sort((a, b) => compareMetricValues(
        a.metrics.find((m) => m.metric_name === metricName),
        b.metrics.find((m) => m.metric_name === metricName),
        dir,
      ));
    }

    return { items, total: count ?? 0 };
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
