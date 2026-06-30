// Analysis for design_elo_improvement_experiment_20260626: rebuilds canonical arena Elo
// in-memory from evolution_arena_comparisons (Decision F — immune to the sync race; NO DB
// writes), computes per-run max-Elo-lift over the seed anchor per arm, then reports
// P(best)/top-tier (bootstrap) + one-sided vs-baseline diff-of-medians with Holm correction.
// Staging-only (prod-refusal). Usage:
//   npx tsx evolution/scripts/experiments/analyzeEloAgentComparison_20260626.ts \
//     --experiment-id <uuid> --prompt-id <uuid> [--baseline generate] [--threshold 40]
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as dns from 'dns';
import type { Database } from '../../../src/lib/database.types';
import { replayArenaComparisons, replayToWrites, type ArenaComparisonRow } from '../../src/lib/metrics/recomputeArenaElo';
import { pBestAnalysis, vsBaselineHolm, median } from '../../src/lib/metrics/abComparison';

dns.setDefaultResultOrder('ipv4first');

const STAGING_PROJECT_REF = 'ifubinffdbyewoezcidz';
const PROD_PROJECT_REF = 'qbxhivoezkfbjbsctdzo';

function parseArg(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

function buildStagingDb(): SupabaseClient<Database> {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const result = dotenv.config({ path: envPath, override: true });
  if (result.error) throw new Error(`[FATAL] Failed to load ${envPath}: ${result.error.message}`);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) throw new Error('[FATAL] Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  if (url.includes(PROD_PROJECT_REF)) throw new Error('[FATAL] Refusing to run against PRODUCTION. Staging only.');
  if (!url.includes(STAGING_PROJECT_REF)) throw new Error(`[FATAL] Not the staging project (${STAGING_PROJECT_REF}).`);
  return createClient<Database>(url, key);
}

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

function armOf(config: unknown): string {
  const cfg = config as { iterationConfigs?: Array<{ agentType?: string }> } | null;
  return cfg?.iterationConfigs?.[0]?.agentType ?? 'unknown';
}

async function main(): Promise<void> {
  const experimentId = parseArg('--experiment-id');
  const promptId = parseArg('--prompt-id');
  const baseline = parseArg('--baseline', 'generate')!;
  const threshold = Number(parseArg('--threshold', '40'));
  if (!experimentId || !promptId) throw new Error('[FATAL] --experiment-id and --prompt-id are required.');

  const db = buildStagingDb();
  console.log(`✅ staging  experiment=${experimentId}  prompt=${promptId}  baseline=${baseline}  threshold=${threshold}`);

  // 1. Entrants (synced variants) + comparisons → in-memory canonical Elo.
  const entrants = await selectAll<{ id: string; run_id: string | null; generation_method: string | null }>(
    (from, to) => db.from('evolution_variants')
      .select('id, run_id, generation_method')
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
  const state = replayArenaComparisons(entrants.map((e) => e.id), comparisons);
  const eloById = new Map(replayToWrites(state).map((w) => [w.id, w.elo_score]));
  console.log(`Loaded ${entrants.length} entrants, ${comparisons.length} comparisons.`);

  // 2. Seed anchor: the competing seed row — run_id IS NULL (not an experiment-run variant)
  //    AND generation_method='pipeline' (the synced anchor that competes; the sibling
  //    generation_method='seed' row is the excluded, never-competing seed source). Every
  //    experiment-run VARIANT is also generation_method='pipeline', so the run_id=NULL
  //    discriminator is load-bearing.
  const anchor = entrants.find((e) => e.run_id === null && e.generation_method === 'pipeline');
  if (!anchor) throw new Error('[FATAL] No competing seed anchor (run_id NULL, generation_method=pipeline) found.');
  const seedElo = eloById.get(anchor.id) ?? 0;
  console.log(`Seed anchor ${anchor.id} Elo=${seedElo.toFixed(1)} (lift is measured vs this).`);

  // 3. Map experiment runs → arm. Failed/zero-variant runs are kept as 0-lift data points.
  const runs = await selectAll<{ id: string; strategy_id: string; status: string }>(
    (from, to) => db.from('evolution_runs').select('id, strategy_id, status')
      .eq('experiment_id', experimentId).range(from, to),
  );
  const stratIds = [...new Set(runs.map((r) => r.strategy_id))];
  const strategies = await selectAll<{ id: string; config: unknown }>(
    (from, to) => db.from('evolution_strategies').select('id, config').in('id', stratIds).range(from, to),
  );
  const armByStrat = new Map(strategies.map((s) => [s.id, armOf(s.config)]));

  // 4. Per-run max Elo over its synced variants → lift over seed.
  const eloByRun = new Map<string, number[]>();
  for (const e of entrants) {
    if (!e.run_id) continue;
    const elo = eloById.get(e.id);
    if (elo === undefined) continue;
    (eloByRun.get(e.run_id) ?? eloByRun.set(e.run_id, []).get(e.run_id)!).push(elo);
  }
  const arms: Record<string, number[]> = {};
  const failedByArm: Record<string, number> = {};
  for (const run of runs) {
    const arm = armByStrat.get(run.strategy_id) ?? 'unknown';
    const elos = eloByRun.get(run.id) ?? [];
    const lift = elos.length > 0 ? Math.max(...elos) - seedElo : 0; // 0-lift for zero-variant runs
    (arms[arm] ??= []).push(lift);
    if (elos.length === 0) failedByArm[arm] = (failedByArm[arm] ?? 0) + 1;
  }

  // 5. P(best)/top-tier + vs-baseline Holm.
  const pb = pBestAnalysis(arms, { threshold });
  const vs = vsBaselineHolm(arms, baseline);

  const rows = Object.keys(arms).map((arm) => ({
    arm,
    n: arms[arm]!.length,
    zeroLift: failedByArm[arm] ?? 0,
    medianLift: median(arms[arm]!),
    // PRAP secondary DV: % of runs improving the seed (lift>0) and % by >= threshold.
    pctImproving: arms[arm]!.length > 0 ? arms[arm]!.filter((l) => l > 0).length / arms[arm]!.length : 0,
    pctImproving40: arms[arm]!.length > 0 ? arms[arm]!.filter((l) => l >= threshold).length / arms[arm]!.length : 0,
    pBest: pb.pBest[arm] ?? 0,
    pTopTier: pb.pWithinThreshold[arm] ?? 0,
    vsEffect: vs[arm]?.effect,
    vsCi: vs[arm]?.ci,
    vsPHolm: vs[arm]?.pHolm,
    sig: vs[arm]?.significant,
  })).sort((a, b) => b.medianLift - a.medianLift);

  console.log(`\n=== Max-Elo-lift over seed (ceiling) per arm — n runs, ${comparisons.length} matches ===`);
  console.log('arm                                          n  0lift  medLift  %impr  %impr40  P(best)  P(top40)  vsGen(Δmed)        pHolm   sig');
  for (const r of rows) {
    const vsStr = r.vsEffect === undefined
      ? '   (baseline)    '
      : `${r.vsEffect >= 0 ? '+' : ''}${r.vsEffect.toFixed(1)} [${r.vsCi![0].toFixed(0)},${r.vsCi![1].toFixed(0)}]`;
    console.log(
      `${r.arm.padEnd(44)} ${String(r.n).padStart(2)}  ${String(r.zeroLift).padStart(4)}  ${r.medianLift.toFixed(1).padStart(7)}  ${(r.pctImproving * 100).toFixed(0).padStart(4)}%  ${(r.pctImproving40 * 100).toFixed(0).padStart(6)}%  ${(r.pBest * 100).toFixed(0).padStart(6)}%  ${(r.pTopTier * 100).toFixed(0).padStart(7)}%  ${vsStr.padEnd(18)} ${r.vsPHolm === undefined ? '   -  ' : r.vsPHolm.toFixed(3)}  ${r.sig === undefined ? '' : r.sig ? 'YES' : 'no'}`,
    );
  }
  console.log('\nP(best) = bootstrap prob arm has the single highest median lift. P(top40) = prob within 40 Elo of best.');
  console.log('%impr = % of runs with lift>0; %impr40 = % with lift>=40 (PRAP secondary DV).');
  console.log(`vsGen = one-sided bootstrap diff-of-medians vs "${baseline}", 95% CI; pHolm = Holm-adjusted; sig = pHolm<0.05.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
