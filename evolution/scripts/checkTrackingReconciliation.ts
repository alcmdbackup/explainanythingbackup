// Tracking reconciliation check for evolution (llm_costs_too_low_in_dash_20260623, Layer 3).
//
// Compares evolution spend from the SOURCE OF TRUTH (evolution_agent_invocations.cost_usd) against
// the per-call audit total (llmCallTracking where call_source LIKE 'evolution_%') over a window.
// A large gap means evolution LLM calls are not writing joinable tracking rows — the exact
// "wired-but-not-writing" failure mode that a fail-closed throw and a static scan both miss.
//
// Scheduled (NOT a required PR check) — files a [release-health] issue on divergence so a RED
// reconciliation is visible without blocking merges. Staging-only.
//
// Args:
//   --days N        window in days (default 7)
//   --ratio N       divergence ratio: alarm when invocation_total > tracking_total * N (default 1.5)
//   --floor N       absolute floor USD: ignore windows with invocation_total below this (default 0.50)
//
// Emits stdout JSON + GITHUB_OUTPUT vars: invocation_usd, tracking_usd, ratio, days, floor,
// status ('ok' | 'divergent'). Exits 1 on divergence so the workflow files the issue.

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

interface Args { days: number; ratio: number; floor: number; }

function arg(name: string, fallback: number): number {
  const a = process.argv.find(x => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return fallback;
  if (a.includes('=')) return Number(a.split('=')[1]);
  const idx = process.argv.indexOf(a);
  return Number(process.argv[idx + 1] ?? fallback);
}

function parseArgs(): Args {
  const days = arg('days', 7);
  const ratio = arg('ratio', 1.5);
  const floor = arg('floor', 0.5);
  for (const [n, v] of [['days', days], ['ratio', ratio], ['floor', floor]] as const) {
    if (!Number.isFinite(v) || v <= 0) {
      console.error(`Invalid --${n}: ${v}`);
      process.exit(2);
    }
  }
  return { days, ratio, floor };
}

/** Sum a numeric column over a created_at window, paginated. */
async function sumColumn(
  db: ReturnType<typeof createClient<Database>>,
  table: 'evolution_agent_invocations' | 'llmCallTracking',
  column: 'cost_usd' | 'estimated_cost_usd',
  since: string,
  evolutionOnly: boolean,
): Promise<number> {
  const PAGE = 1000;
  let from = 0;
  let total = 0;
  for (;;) {
    let q = db.from(table).select(column).gte('created_at', since).range(from, from + PAGE - 1);
    if (evolutionOnly) q = q.like('call_source', 'evolution_%');
    const r = await q;
    if (r.error) {
      console.error(`${table} query failed:`, r.error.message);
      process.exit(1);
    }
    const rows = (r.data ?? []) as unknown as Array<Record<string, unknown>>;
    for (const row of rows) total += Number(row[column]) || 0;
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return total;
}

export interface DivergenceResult { divergent: boolean; ratio: number; }

/**
 * Pure divergence decision (exported for unit testing). Divergent when real evolution spend is
 * above the noise floor AND the source-of-truth total materially exceeds the tracked total.
 */
export function evaluateDivergence(
  invocationUsd: number,
  trackingUsd: number,
  ratioThreshold: number,
  floor: number,
): DivergenceResult {
  const divergent =
    invocationUsd > floor && (trackingUsd === 0 || invocationUsd > trackingUsd * ratioThreshold);
  const rawRatio = trackingUsd > 0 ? invocationUsd / trackingUsd : (invocationUsd > 0 ? Infinity : 0);
  return { divergent, ratio: Number.isFinite(rawRatio) ? Number(rawRatio.toFixed(2)) : 9999 };
}

interface Out { invocation_usd: number; tracking_usd: number; ratio: number; days: number; floor: number; status: 'ok' | 'divergent'; }

async function emit(o: Out): Promise<void> {
  console.log(JSON.stringify(o, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    const out = [
      `invocation_usd=${o.invocation_usd.toFixed(6)}`,
      `tracking_usd=${o.tracking_usd.toFixed(6)}`,
      `ratio=${o.ratio}`,
      `days=${o.days}`,
      `floor=${o.floor}`,
      `status=${o.status}`,
    ].join('\n');
    await import('fs').then(fs => fs.promises.appendFile(process.env.GITHUB_OUTPUT!, out + '\n'));
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }
  const db = createClient<Database>(url, key);
  const since = new Date(Date.now() - args.days * 86_400_000).toISOString();

  const invocationUsd = await sumColumn(db, 'evolution_agent_invocations', 'cost_usd', since, false);
  const trackingUsd = await sumColumn(db, 'llmCallTracking', 'estimated_cost_usd', since, true);

  const { divergent, ratio } = evaluateDivergence(invocationUsd, trackingUsd, args.ratio, args.floor);

  await emit({
    invocation_usd: invocationUsd,
    tracking_usd: trackingUsd,
    ratio,
    days: args.days,
    floor: args.floor,
    status: divergent ? 'divergent' : 'ok',
  });

  if (divergent) process.exit(1);
}

// Only run when executed directly (not when imported by the unit test).
if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
