#!/usr/bin/env npx tsx
// Phase 6 seed script for meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616:
// the Mode B "bundle-split" A/B experiment. Creates two strategies (Control =
// production-default Mode B, Treatment = same + disableApproverFiltering:true)
// against federal_reserve_2 and enqueues N runs/arm under one evolution_experiments row.
//
// Usage:
//   npx tsx evolution/scripts/seedBundleSplitExperiment.ts \
//     --target staging \
//     --runs-per-arm 5 \
//     --apply
//
// Flags:
//   --target {staging|prod}   Required; selects which Supabase project to write to.
//                             prod requires --i-know-this-is-prod (explicit confirmation).
//   --runs-per-arm N          Number of runs per arm (default 5; Stage 1 smoke).
//   --apply                   Without this, the script dry-runs and prints planned writes.
//   --append                  Add runs to existing experiment (looked up by name)
//                             instead of creating a new one. Required after first --apply.
//   --reuse-existing          Opt-in to reuse a strategy whose config_hash matches an
//                             already-existing strategy. Default behaviour: throw to avoid
//                             contaminating this experiment with the existing strategy's
//                             prior runs and arena variants.
//
// Output: prints --experiment-id, --control-strategy, and --treatment-strategy values
// for paste into verifyBundleSplitStage1.ts.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as dns from 'dns';
import {
  upsertStrategy,
  hashStrategyConfig,
} from '../src/lib/pipeline/setup/findOrCreateStrategy';
import {
  createExperiment,
  addRunToExperiment,
} from '../src/lib/pipeline/manageExperiments';
import type { StrategyConfig } from '../src/lib/pipeline/infra/types';

dns.setDefaultResultOrder('ipv4first');

// ─── Constants ──────────────────────────────────────────────────

// federal_reserve_2 — staging only. Verified via /research findings + analysis docs.
const PROMPT_ID_FEDERAL_RESERVE_2 = 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f';
const EXPERIMENT_NAME = 'BundleSplit A/B (federal_reserve_2)';

// ─── Arg parsing ────────────────────────────────────────────────

function parseStringArg(flag: string, defaultVal?: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return defaultVal;
  return process.argv[idx + 1];
}

function parseIntArg(flag: string, defaultVal: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return defaultVal;
  const val = parseInt(process.argv[idx + 1]!, 10);
  return Number.isFinite(val) && val > 0 ? val : defaultVal;
}

const args = {
  target: parseStringArg('--target') as 'staging' | 'prod' | undefined,
  runsPerArm: parseIntArg('--runs-per-arm', 5),
  apply: process.argv.includes('--apply'),
  append: process.argv.includes('--append'),
  reuseExisting: process.argv.includes('--reuse-existing'),
  prodConfirmed: process.argv.includes('--i-know-this-is-prod'),
};

// ─── Validation (deferred to main() so test-imports don't trigger exit) ─────

function validateArgs(): void {
  if (!args.target || (args.target !== 'staging' && args.target !== 'prod')) {
    console.error('[FATAL] Missing or invalid --target (must be staging or prod)');
    process.exit(2);
  }
  if (args.target === 'prod' && !args.prodConfirmed) {
    console.error('[FATAL] --target prod requires --i-know-this-is-prod confirmation. ' +
                  'federal_reserve_2 is a staging-only prompt; production seeding is almost ' +
                  'certainly a mistake.');
    process.exit(2);
  }
}

// ─── Strategy configs ───────────────────────────────────────────

// Both arms mirror the historical "Iterative editing - whole article" strategy
// (evolution_strategies.id=4900ff14-a11f-4653-9854-85af3cd1480c) with three deviations
// documented in the planning doc:
//   1. judgeModel switched to gemini-2.5-flash-lite (was qwen-2.5-7b-instruct)
//   2. editingProposerSoftCap raised to 8 in BOTH arms (was historical 3) per design A3
//   3. Treatment arm adds disableApproverFiltering: true on editing iterations
function buildConfig(arm: 'control' | 'treatment'): StrategyConfig {
  const editingIter = (budgetPct: number) => ({
    agentType: 'iterative_editing_rewrite' as const,
    budgetPercent: budgetPct,
    editingProposerSoftCap: 8,
    ...(arm === 'treatment' ? { disableApproverFiltering: true } : {}),
  });
  return {
    generationModel: 'google/gemini-2.5-flash-lite',
    judgeModel: 'google/gemini-2.5-flash-lite',
    budgetUsd: 0.05,
    generationTemperature: 1,
    maxComparisonsPerVariant: 3,
    minBudgetAfterParallelAgentMultiple: 1,
    iterationConfigs: [
      { agentType: 'generate', sourceMode: 'seed', budgetPercent: 34 },
      editingIter(33),
      editingIter(33),
    ],
  } as unknown as StrategyConfig;
}

// ─── Env / DB ───────────────────────────────────────────────────

function envFileFor(target: 'staging' | 'prod'): string {
  return target === 'staging' ? '.env.local' : '.env.evolution-prod';
}

function buildDb(target: 'staging' | 'prod'): SupabaseClient {
  const envPath = path.resolve(process.cwd(), envFileFor(target));
  const result = dotenv.config({ path: envPath, override: true });
  if (result.error) {
    throw new Error(`[FATAL] Failed to load env from ${envPath}: ${result.error.message}`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('[FATAL] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key);
}

// ─── Strategy seed (with collision guard) ───────────────────────

export async function seedStrategy(
  armLabel: 'AF-Ctrl' | 'AF-Off',
  cfg: StrategyConfig,
  db: SupabaseClient,
  reuseExisting: boolean,
): Promise<string> {
  const hash = hashStrategyConfig(cfg);
  const { data: existing } = await db
    .from('evolution_strategies')
    .select('id, name, created_at')
    .eq('config_hash', hash)
    .maybeSingle();
  if (existing) {
    if (!reuseExisting) {
      throw new Error(
        `Strategy config_hash collision for arm "${armLabel}": hashes identically to ` +
        `existing strategy "${existing.name}" (id=${existing.id}, created ${existing.created_at}). ` +
        `Re-using it would contaminate this experiment with the existing strategy's prior runs ` +
        `and arena variants. Pass --reuse-existing if this is intentional, or tweak the config to ` +
        `break the collision.`,
      );
    }
    console.warn(`[seed] Reusing existing strategy ${existing.id} for arm "${armLabel}" (--reuse-existing).`);
    return existing.id;
  }
  const id = await upsertStrategy(db, cfg);
  console.log(`[seed] Created strategy ${id} for arm "${armLabel}" (hash=${hash.slice(0, 12)}…).`);
  return id;
}

// ─── Experiment lookup for --append ─────────────────────────────

async function findExperimentByName(name: string, db: SupabaseClient): Promise<string | null> {
  const { data } = await db
    .from('evolution_experiments')
    .select('id')
    .eq('name', name)
    .maybeSingle();
  return data?.id ?? null;
}

// ─── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  validateArgs();
  console.log(`[seed] target=${args.target} runs-per-arm=${args.runsPerArm} apply=${args.apply} append=${args.append}`);

  const controlConfig = buildConfig('control');
  const treatmentConfig = buildConfig('treatment');

  if (!args.apply) {
    console.log('[seed] Dry-run mode (omit --apply). Planned writes:');
    console.log(`[seed]   1. upsertStrategy(control) → hash ${hashStrategyConfig(controlConfig).slice(0, 12)}…`);
    console.log(`[seed]   2. upsertStrategy(treatment) → hash ${hashStrategyConfig(treatmentConfig).slice(0, 12)}…`);
    if (!args.append) {
      console.log(`[seed]   3. createExperiment("${EXPERIMENT_NAME}", promptId=${PROMPT_ID_FEDERAL_RESERVE_2})`);
    } else {
      console.log(`[seed]   3. lookup existing experiment "${EXPERIMENT_NAME}"`);
    }
    console.log(`[seed]   4. addRunToExperiment × ${args.runsPerArm * 2} (2 arms × ${args.runsPerArm})`);
    console.log('[seed] Re-run with --apply to write.');
    return;
  }

  const db = buildDb(args.target!);

  // Strategy upserts (with collision guard).
  const ctlStrategyId = await seedStrategy('AF-Ctrl', controlConfig, db, args.reuseExisting);
  const trtStrategyId = await seedStrategy('AF-Off', treatmentConfig, db, args.reuseExisting);

  // Experiment create or look up.
  let experimentId: string;
  if (args.append) {
    const existing = await findExperimentByName(EXPERIMENT_NAME, db);
    if (!existing) {
      throw new Error(
        `--append requires existing experiment "${EXPERIMENT_NAME}"; none found. ` +
        `Run without --append to create one.`,
      );
    }
    experimentId = existing;
    console.log(`[seed] Reusing existing experiment ${experimentId} (--append).`);
  } else {
    const created = await createExperiment(EXPERIMENT_NAME, PROMPT_ID_FEDERAL_RESERVE_2, db);
    experimentId = created.id;
    console.log(`[seed] Created experiment ${experimentId} ("${EXPERIMENT_NAME}").`);
  }

  // Enqueue runs.
  for (let i = 0; i < args.runsPerArm; i++) {
    await addRunToExperiment(experimentId, { strategy_id: ctlStrategyId, budget_cap_usd: 0.05 }, db);
    await addRunToExperiment(experimentId, { strategy_id: trtStrategyId, budget_cap_usd: 0.05 }, db);
  }
  console.log(`[seed] Enqueued ${args.runsPerArm * 2} runs (2 arms × ${args.runsPerArm}).`);

  // Output the IDs in a format easy to paste into verifyBundleSplitStage1.ts.
  console.log('');
  console.log('[seed] Pass these to verifyBundleSplitStage1.ts:');
  console.log(`  --experiment-id ${experimentId}`);
  console.log(`  --control-strategy ${ctlStrategyId}`);
  console.log(`  --treatment-strategy ${trtStrategyId}`);
}

const isDirectExecution = require.main === module
  || process.argv[1]?.endsWith('seedBundleSplitExperiment.ts');
if (isDirectExecution) {
  main().catch((err) => {
    console.error('[FATAL]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
