#!/usr/bin/env npx tsx
// Recompute an arena's per-variant Elo ratings from the durable evolution_arena_comparisons
// log (design_elo_improvement_experiment_20260626 Decision F). The match log is the source of
// truth; this rebuilds mu/sigma/elo_score/arena_match_count, immune to the concurrent-sync race.
//
// SAFETY: STAGING ONLY. Refuses to run against the production project ref so a fat-finger can't
// rewrite FR2 prod ratings. Dry-run by default — prints a before/after diff; pass --apply to write.
//
// Usage:
//   npx tsx scripts/recompute-arena-elo.ts --prompt-id <uuid>            # dry-run diff
//   npx tsx scripts/recompute-arena-elo.ts --prompt-id <uuid> --apply    # write

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as dns from 'dns';
import type { Database } from '../src/lib/database.types';
import {
  replayArenaComparisons,
  replayToWrites,
  type ArenaComparisonRow,
} from '../evolution/src/lib/metrics/recomputeArenaElo';

dns.setDefaultResultOrder('ipv4first');

const STAGING_PROJECT_REF = 'ifubinffdbyewoezcidz';
const PROD_PROJECT_REF = 'qbxhivoezkfbjbsctdzo';

function parseArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function buildStagingDb(): SupabaseClient<Database> {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const result = dotenv.config({ path: envPath, override: true });
  if (result.error) throw new Error(`[FATAL] Failed to load ${envPath}: ${result.error.message}`);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) throw new Error('[FATAL] Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  if (url.includes(PROD_PROJECT_REF)) {
    throw new Error('[FATAL] Refusing to run against the PRODUCTION project. Staging only.');
  }
  if (!url.includes(STAGING_PROJECT_REF)) {
    throw new Error(`[FATAL] Connection does not target the staging project (${STAGING_PROJECT_REF}). Aborting.`);
  }
  return createClient<Database>(url, key);
}

/** Page through a select so we don't silently cap at PostgREST's 1000-row default.
 *  `build` returns a Supabase query thenable; its projected row shape is cast to T. */
async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function main(): Promise<void> {
  const promptId = parseArg('--prompt-id');
  const apply = process.argv.includes('--apply');
  if (!promptId) throw new Error('[FATAL] --prompt-id <uuid> is required.');

  const db = buildStagingDb();
  console.log(`✅ Connected to staging. prompt_id=${promptId} mode=${apply ? 'APPLY' : 'dry-run'}`);

  // Entrant set: seed from the variant table so zero-match variants get a clean default.
  const entrants = await selectAll<{ id: string; mu: number; sigma: number; elo_score: number; arena_match_count: number }>(
    (from, to) => db.from('evolution_variants')
      .select('id, mu, sigma, elo_score, arena_match_count')
      .eq('prompt_id', promptId).eq('synced_to_arena', true).is('archived_at', null)
      .range(from, to),
  );
  const comparisons = await selectAll<ArenaComparisonRow & { created_at: string; id: string }>(
    (from, to) => db.from('evolution_arena_comparisons')
      .select('id, entry_a, entry_b, winner, confidence, created_at')
      .eq('prompt_id', promptId)
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(from, to),
  );
  console.log(`Loaded ${entrants.length} entrants, ${comparisons.length} comparisons.`);

  const state = replayArenaComparisons(entrants.map((e) => e.id), comparisons);
  const writes = replayToWrites(state);
  const current = new Map(entrants.map((e) => [e.id, e]));

  let maxEloDelta = 0;
  let changed = 0;
  for (const w of writes) {
    const cur = current.get(w.id);
    if (!cur) continue;
    const eloDelta = Math.abs(w.elo_score - Number(cur.elo_score));
    const countDelta = w.arena_match_count - Number(cur.arena_match_count);
    if (eloDelta > 0.5 || countDelta !== 0) {
      changed++;
      maxEloDelta = Math.max(maxEloDelta, eloDelta);
      if (changed <= 20) {
        console.log(`  ${w.id}  elo ${Number(cur.elo_score).toFixed(1)} → ${w.elo_score.toFixed(1)} (Δ${eloDelta.toFixed(1)})  matches ${cur.arena_match_count} → ${w.arena_match_count}`);
      }
    }
  }
  console.log(`Diff: ${changed} rows changed, max |Δelo| = ${maxEloDelta.toFixed(1)}.`);

  if (!apply) {
    console.log('Dry-run — no writes. Re-run with --apply to persist.');
    return;
  }
  let written = 0;
  for (const w of writes) {
    const { error } = await db.from('evolution_variants')
      .update({ mu: w.mu, sigma: w.sigma, elo_score: w.elo_score, arena_match_count: w.arena_match_count })
      .eq('id', w.id);
    if (error) throw new Error(`update ${w.id} failed: ${error.message}`);
    written++;
  }
  console.log(`✅ Applied ${written} rating writes.`);
}

const isDirect = require.main === module || process.argv[1]?.endsWith('recompute-arena-elo.ts');
if (isDirect) {
  main().catch((err) => { console.error('[FATAL]', err); process.exit(1); });
}
