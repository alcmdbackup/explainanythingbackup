#!/usr/bin/env npx tsx
// Seed script for analyze_performance_self_critique_agent_20260630: append the
// `self_critique_revise` arm × N runs to the existing sister experiment
// `bc10c2e0-a51c-41a8-a2c3-34577a1fa489` (the 9-agent Elo comparison — see
// docs/analysis/elo-agent-comparison-federal-reserve-2-20260628/). Reuses the
// same arena `6f5c85e5` + same source seed variant `538bfbc9` + same BASE
// config (gemini-2.5-flash-lite gen+judge, temperature 1, $0.10/run budget,
// maxComparisonsPerVariant=3, single seed iteration at 100% budget) so the new
// arm plugs directly into the 10-arm ranking via analyzeEloAgentComparison's
// auto-discovery.
//
// Usage:
//   npx tsx evolution/scripts/experiments/seedSelfCritiquePerfExperiment_20260630.ts \
//     --target staging --runs-per-arm 2 --apply       # smoke tranche
//   npx tsx evolution/scripts/experiments/seedSelfCritiquePerfExperiment_20260630.ts \
//     --target staging --runs-per-arm 8 --apply       # full tranche
//
// Flags: --target {staging} (prod GUARDED behind --i-know-this-is-prod),
//   --runs-per-arm N (smoke=2, full=8), --apply (else dry-run), --reuse-existing
//   (reuse a colliding strategy hash), --experiment-id UUID (override for
//   fallback fresh 2-arm experiment path).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as dns from 'dns';
import {
  upsertStrategy,
  hashStrategyConfig,
} from '../../src/lib/pipeline/setup/findOrCreateStrategy';
import { addRunToExperiment } from '../../src/lib/pipeline/manageExperiments';
import type { StrategyConfig } from '../../src/lib/pipeline/infra/types';
import type { Database } from '../../../src/lib/database.types';

dns.setDefaultResultOrder('ipv4first');

// ─── Constants ──────────────────────────────────────────────────
export const SISTER_EXPERIMENT_ID = 'bc10c2e0-a51c-41a8-a2c3-34577a1fa489';
export const SISTER_ARENA_PROMPT_ID = '6f5c85e5-0d6f-42f3-ba91-cbf2377f2317';
export const BUDGET_USD_PER_RUN = 0.10;
// Fail-closed hard cap on cumulative experiment spend (already-spent + planned).
// Sister ran ~$8.27 across 9 arms; our marginal tranche 1 = $1, tranche 2 = +$1.
// $5 cap over sister's actual ~$8.27 baseline gives ~$3+ headroom without
// letting a mis-scoped `--runs-per-arm 100` accidentally blow the budget.
export const HARD_CAP_USD = 8.27 + 5.0; // = 13.27 absolute experiment ceiling.
export const ARM = 'self_critique_revise' as const;

// ─── BASE config (matches sister `BASE` verbatim — enforced by unit test) ─
export const BASE = {
  generationModel: 'google/gemini-2.5-flash-lite',
  judgeModel: 'google/gemini-2.5-flash-lite',
  generationTemperature: 1,
  budgetUsd: BUDGET_USD_PER_RUN,
  maxComparisonsPerVariant: 3,
} as const;

export function buildConfig(): StrategyConfig {
  const iter = { agentType: ARM, sourceMode: 'seed', budgetPercent: 100 } as const;
  return { ...BASE, iterationConfigs: [iter] } as unknown as StrategyConfig;
}

// ─── Arg parsing ────────────────────────────────────────────────
function parseStringArg(flag: string, d?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 || i + 1 >= process.argv.length ? d : process.argv[i + 1];
}
function parseIntArg(flag: string, d: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i + 1 >= process.argv.length) return d;
  const v = parseInt(process.argv[i + 1]!, 10);
  return Number.isFinite(v) && v > 0 ? v : d;
}
const args = {
  target: parseStringArg('--target') as 'staging' | 'prod' | undefined,
  runsPerArm: parseIntArg('--runs-per-arm', 2),
  experimentId: parseStringArg('--experiment-id', SISTER_EXPERIMENT_ID),
  apply: process.argv.includes('--apply'),
  reuseExisting: process.argv.includes('--reuse-existing'),
  prodConfirmed: process.argv.includes('--i-know-this-is-prod'),
};

export function validateArgs(argv: string[] = process.argv): void {
  const target = (() => {
    const i = argv.indexOf('--target');
    return i === -1 || i + 1 >= argv.length ? undefined : argv[i + 1];
  })();
  const prodConfirmed = argv.includes('--i-know-this-is-prod');
  if (target !== 'staging' && target !== 'prod') {
    throw new Error('[FATAL] Missing/invalid --target (staging|prod)');
  }
  if (target === 'prod' && !prodConfirmed) {
    throw new Error(
      '[FATAL] --target prod requires --i-know-this-is-prod (this is a staging-first experiment).',
    );
  }
}

// ─── Env / DB ───────────────────────────────────────────────────
function envFileFor(t: 'staging' | 'prod'): string {
  return t === 'staging' ? '.env.local' : '.env.evolution-prod';
}
function buildDb(target: 'staging' | 'prod'): SupabaseClient {
  const envPath = path.resolve(process.cwd(), envFileFor(target));
  const result = dotenv.config({ path: envPath, override: true });
  if (result.error) throw new Error(`[FATAL] Failed to load env from ${envPath}: ${result.error.message}`);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('[FATAL] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient<Database>(url, key) as unknown as SupabaseClient;
}

// ─── Pre-flight: re-open experiment if auto-completed (fail-closed) ─
export async function reopenExperimentIfNeeded(
  db: SupabaseClient,
  experimentId: string,
): Promise<'was_running' | 'reopened' | 'raced_to_running'> {
  const { data: exp, error: expErr } = await db
    .from('evolution_experiments')
    .select('id, status')
    .eq('id', experimentId)
    .maybeSingle();
  if (expErr || !exp) throw new Error(`[FATAL] Experiment ${experimentId} not found: ${expErr?.message}`);
  if (exp.status === 'running' || exp.status === 'draft') return 'was_running';
  if (exp.status === 'cancelled') throw new Error(`[FATAL] Experiment ${experimentId} is cancelled; refusing to reopen.`);
  if (exp.status !== 'completed') throw new Error(`[FATAL] Experiment ${experimentId} is in unexpected status "${exp.status}".`);

  const { data: updated, error: updErr } = await db
    .from('evolution_experiments')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', experimentId)
    .eq('status', 'completed')
    .select('id');
  if (updErr) throw new Error(`[FATAL] Failed to reopen experiment: ${updErr.message}`);
  if (!updated || updated.length === 0) {
    // Someone else raced us. Re-read status; accept if now 'running'.
    const { data: re } = await db
      .from('evolution_experiments')
      .select('status')
      .eq('id', experimentId)
      .single();
    if (re?.status === 'running') return 'raced_to_running';
    throw new Error(`[FATAL] Reopen UPDATE returned 0 rows and post-read status = "${re?.status}"; aborting.`);
  }
  if (updated.length !== 1) throw new Error(`[FATAL] Reopen UPDATE returned ${updated.length} rows; expected 1.`);
  return 'reopened';
}

// ─── Pre-flight: hard cost cap (already-spent + planned ≤ HARD_CAP_USD) ─
export async function assertHardCostCap(
  db: SupabaseClient,
  experimentId: string,
  plannedUsd: number,
): Promise<void> {
  // Step 1: fetch all run IDs for the experiment (sister exp has ~90 rows).
  const { data: runIdRows, error: runErr } = await db
    .from('evolution_runs')
    .select('id')
    .eq('experiment_id', experimentId);
  if (runErr) throw new Error(`[FATAL] Failed to list experiment runs: ${runErr.message}`);
  const runIds = (runIdRows ?? []).map((r) => r.id as string);

  // Step 2: sum cost_usd across every invocation on those runs (~1000 rows expected).
  let spentUsd = 0;
  if (runIds.length > 0) {
    const { data: invRows, error: invErr } = await db
      .from('evolution_agent_invocations')
      .select('cost_usd')
      .in('run_id', runIds);
    if (invErr) throw new Error(`[FATAL] Failed to sum invocation cost: ${invErr.message}`);
    spentUsd = (invRows ?? []).reduce(
      (s: number, r) => s + Number((r as { cost_usd?: number | null }).cost_usd ?? 0),
      0,
    );
  }

  const total = spentUsd + plannedUsd;
  console.log(`[seed] Hard cost cap check: spent=$${spentUsd.toFixed(4)} + planned=$${plannedUsd.toFixed(4)} = $${total.toFixed(4)} (cap $${HARD_CAP_USD.toFixed(2)})`);
  if (total > HARD_CAP_USD) {
    throw new Error(
      `[FATAL] Experiment ${experimentId}: spent $${spentUsd.toFixed(2)} + planned $${plannedUsd.toFixed(2)} = $${total.toFixed(2)} exceeds HARD_CAP_USD $${HARD_CAP_USD.toFixed(2)}. Refusing to enqueue.`,
    );
  }
}

// ─── Strategy seed (collision guard) ────────────────────────────
export async function seedStrategy(db: SupabaseClient, reuseExisting: boolean): Promise<string> {
  const cfg = buildConfig();
  const hash = hashStrategyConfig(cfg);
  const { data: existing } = await db
    .from('evolution_strategies').select('id, name').eq('config_hash', hash).maybeSingle();
  if (existing) {
    if (!reuseExisting) {
      throw new Error(`[FATAL] Strategy config_hash collision for arm "${ARM}" (existing ${existing.id} "${existing.name}"). Pass --reuse-existing if intentional.`);
    }
    console.warn(`[seed] Reusing existing strategy ${existing.id} for arm "${ARM}".`);
    return existing.id;
  }
  const id = await upsertStrategy(db, cfg);
  console.log(`[seed] Created strategy ${id} for arm "${ARM}" (hash=${hash.slice(0, 12)}…).`);
  return id;
}

// ─── Main ───────────────────────────────────────────────────────
async function main(): Promise<void> {
  validateArgs();
  const totalRuns = args.runsPerArm;
  const plannedBudget = totalRuns * BUDGET_USD_PER_RUN;
  console.log(`[seed] target=${args.target} arm="${ARM}" runs-per-arm=${args.runsPerArm} planned=$${plannedBudget.toFixed(2)} apply=${args.apply}`);
  console.log(`[seed] Appending to experiment=${args.experimentId} arena=${SISTER_ARENA_PROMPT_ID}`);

  if (!args.apply) {
    const cfg = buildConfig();
    const hash = hashStrategyConfig(cfg);
    console.log(`[seed] Dry-run. Would:`);
    console.log(`[seed]   1. reopen experiment ${args.experimentId} if status=completed`);
    console.log(`[seed]   2. assert spent + $${plannedBudget.toFixed(2)} ≤ HARD_CAP_USD $${HARD_CAP_USD.toFixed(2)}`);
    console.log(`[seed]   3. upsert strategy with hash ${hash.slice(0, 12)}…`);
    console.log(`[seed]   4. enqueue ${totalRuns} runs with budget_cap_usd=$${BUDGET_USD_PER_RUN}`);
    console.log(`[seed] Re-run with --apply.`);
    return;
  }

  const db = buildDb(args.target!);
  const reopenResult = await reopenExperimentIfNeeded(db, args.experimentId!);
  console.log(`[seed] Reopen result: ${reopenResult}`);
  await assertHardCostCap(db, args.experimentId!, plannedBudget);

  const strategyId = await seedStrategy(db, args.reuseExisting);
  const runIds: string[] = [];
  for (let i = 0; i < totalRuns; i++) {
    const { runId } = await addRunToExperiment(
      args.experimentId!,
      { strategy_id: strategyId, budget_cap_usd: BUDGET_USD_PER_RUN },
      db,
    );
    runIds.push(runId);
  }

  // Post-insert verification: experiment must be running + our new pending runs
  // must all be present + count-matched.
  const { data: postExp } = await db
    .from('evolution_experiments').select('status').eq('id', args.experimentId!).single();
  const { data: postRuns } = await db
    .from('evolution_runs')
    .select('id, status')
    .eq('experiment_id', args.experimentId!)
    .eq('strategy_id', strategyId)
    .in('status', ['pending', 'claimed', 'running']);
  if (postExp?.status !== 'running') {
    throw new Error(`[FATAL] Post-insert: experiment status = "${postExp?.status}", expected "running".`);
  }
  const activeCount = (postRuns ?? []).length;
  console.log(`[seed] Post-insert verify: experiment=${postExp?.status}, active self_critique runs=${activeCount} (of ${totalRuns} just enqueued — other rows may already have been claimed by minicomputer).`);
  if (activeCount + 0 < 1) {
    throw new Error(`[FATAL] Post-insert verify: zero active runs found for strategy ${strategyId}.`);
  }

  console.log(`[seed] Enqueued ${totalRuns} runs (≤$${plannedBudget.toFixed(2)}).`);
  console.log(`  experiment_id = ${args.experimentId}`);
  console.log(`  prompt_id     = ${SISTER_ARENA_PROMPT_ID}`);
  console.log(`  strategy_id   = ${strategyId}`);
  console.log(`  new run ids   = ${runIds.join(', ')}`);
  console.log(`[seed] Verify spend later: SELECT SUM(cost_usd) FROM evolution_runs WHERE id IN ('${runIds.join("','")}');`);
}

const isDirectExecution = require.main === module
  || process.argv[1]?.endsWith('experiments/seedSelfCritiquePerfExperiment_20260630.ts');
if (isDirectExecution) {
  main().catch((err) => { console.error('[FATAL]', err instanceof Error ? err.message : err); process.exit(1); });
}
