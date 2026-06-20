#!/usr/bin/env npx tsx
/**
 * Recurrence detector for the "arena_only wipeout" failure mode
 * (fix_structured_judging_evolution_bugs_20260611, GH #1202).
 *
 * Symptom: an evolution run finishes looking healthy (status='completed',
 * run_summary.stopReason='arena_only') but produced ZERO variants at ZERO cost because every
 * generation LLM call failed (e.g. OpenRouter 402 credit exhaustion / no max_tokens cap). This
 * fired silently on 2026-05-02 and 2026-06-11 with no alert. After the D3 fix such runs are
 * marked status='failed' error_code='all_generations_failed' instead, so this detector matches
 * BOTH the legacy (completed+0-variants+0-cost) and the post-fix (all_generations_failed) shapes.
 *
 * Discriminator vs a LEGITIMATE arena-only run: a real arena-only run runs ZERO generation
 * invocations (it only re-ranks pre-seeded arena entries), so `generateInvocationCount > 0` is
 * the key signal that distinguishes a wipeout from an intentional arena-only run.
 *
 * Usage:
 *   npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts                 # staging, last 24h (default)
 *   npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts --prod          # production
 *   npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts --hours 168     # custom window
 *   npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts --json          # machine-readable output
 * Exit code: 0 = no wipeouts, 1 = wipeouts detected (so CI/cron can alert).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import * as dotenv from 'dotenv';
import * as path from 'path';

/** Aggregated per-run health signals consumed by the pure classifier. */
export interface RunHealthRow {
  runId: string;
  status: string;
  errorCode: string | null;
  stopReason: string | null;
  /** Number of `generate_from_previous_article` invocations for the run. */
  generateInvocationCount: number;
  /** Number of persisted `evolution_variants` rows for the run. */
  variantCount: number;
  /** Run-level `cost` metric value (0 when every LLM call 402'd before billing). */
  totalCostUsd: number;
}

/**
 * Pure classifier — true iff the run is an arena_only wipeout (all generations failed, nothing
 * produced). Matches both the legacy silent-completed shape and the post-D3 failed shape. A
 * legitimate arena-only run (0 generation invocations) is NOT flagged.
 */
export function isArenaOnlyWipeout(run: RunHealthRow): boolean {
  // Must have ATTEMPTED generation — this is the discriminator vs an intentional arena-only run.
  if (run.generateInvocationCount <= 0) return false;
  // ...yet produced no variants and spent nothing → every generation errored.
  if (run.variantCount !== 0 || run.totalCostUsd !== 0) return false;
  // Match the legacy silent shape (completed/arena_only) OR the post-D3 explicit failure.
  if (run.errorCode === 'all_generations_failed') return true;
  if (run.status === 'completed' && (run.stopReason === 'arena_only' || run.stopReason === null)) return true;
  return false;
}

/** Filters a batch of aggregated rows down to the wipeouts. */
export function detectWipeouts(rows: RunHealthRow[]): RunHealthRow[] {
  return rows.filter(isArenaOnlyWipeout);
}

/** Queries recent runs and returns the wipeouts. Read-only. */
export async function findRecentWipeouts(db: SupabaseClient, sinceHours: number): Promise<RunHealthRow[]> {
  const sinceIso = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const { data: runs, error } = await db
    .from('evolution_runs')
    .select('id, status, error_code, run_summary, completed_at')
    .gte('completed_at', sinceIso)
    .in('status', ['completed', 'failed']);
  if (error) throw new Error(`evolution_runs query failed: ${error.message}`);
  if (!runs || runs.length === 0) return [];

  const rows: RunHealthRow[] = [];
  for (const r of runs as Array<{ id: string; status: string; error_code: string | null; run_summary: { stopReason?: string } | null }>) {
    const [{ count: genCount }, { count: variantCount }, costRow] = await Promise.all([
      db.from('evolution_agent_invocations').select('id', { count: 'exact', head: true })
        .eq('run_id', r.id).eq('agent_name', 'generate_from_previous_article'),
      db.from('evolution_variants').select('id', { count: 'exact', head: true }).eq('run_id', r.id),
      db.from('evolution_metrics').select('value').eq('entity_type', 'run').eq('entity_id', r.id).eq('metric_name', 'cost').maybeSingle(),
    ]);
    rows.push({
      runId: r.id,
      status: r.status,
      errorCode: r.error_code,
      stopReason: r.run_summary?.stopReason ?? null,
      generateInvocationCount: genCount ?? 0,
      variantCount: variantCount ?? 0,
      totalCostUsd: Number((costRow.data as { value?: number } | null)?.value ?? 0),
    });
  }
  return detectWipeouts(rows);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const isProd = argv.includes('--prod');
  const asJson = argv.includes('--json');
  const hoursArg = argv.indexOf('--hours');
  const sinceHours = hoursArg >= 0 ? Number(argv[hoursArg + 1]) || 24 : 24;

  const envFile = isProd ? '.env.evolution-prod' : '.env.local';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${envFile}`);
    process.exit(2);
  }
  const db = createClient<Database>(url, key, { auth: { persistSession: false } });

  const wipeouts = await findRecentWipeouts(db, sinceHours);
  if (asJson) {
    console.log(JSON.stringify({ target: isProd ? 'prod' : 'staging', sinceHours, count: wipeouts.length, wipeouts }, null, 2));
  } else if (wipeouts.length === 0) {
    console.log(`✓ No arena_only wipeouts in the last ${sinceHours}h (${isProd ? 'prod' : 'staging'}).`);
  } else {
    console.error(`⚠ ${wipeouts.length} arena_only wipeout(s) in the last ${sinceHours}h (${isProd ? 'prod' : 'staging'}):`);
    for (const w of wipeouts) {
      console.error(`  run ${w.runId} — status=${w.status} stopReason=${w.stopReason} gen=${w.generateInvocationCount} variants=${w.variantCount} cost=${w.totalCostUsd}`);
    }
    console.error('Likely OpenRouter credit exhaustion. See evolution/docs/cost_optimization.md (402 / no-max_tokens failure mode).');
  }
  process.exit(wipeouts.length > 0 ? 1 : 0);
}

// Only run main() when invoked directly (not when imported by the test).
if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(2); });
}
