#!/usr/bin/env npx tsx
// Seed script for the post-merge staging A/B from
// investigate_paragraph_recombine_coherence_pass_performance_20260623.
//
// Creates two paragraph_recombine_with_coherence_pass strategies (Control = legacy
// pinned defaults, Treatment = new aggressive defaults) against the federal_reserve_2
// staging prompt and enqueues N runs/arm under one evolution_experiments row.
//
// Goes through the production strategy/experiment/run infrastructure (upsertStrategy +
// createExperiment + addRunToExperiment), so the queued runs flow through the
// real pipeline with FULL COST TRACKING via llmCallTracking when the
// minicomputer evolution-runner picks them up.
//
// Usage:
//   npx tsx evolution/scripts/experiments/seedCoherencePassPerformanceExperiment_20260624.ts \
//     --target staging \
//     --runs-per-arm 8 \
//     --apply
//
// Flags:
//   --target {staging|prod}   Required. Production is GUARDED because the prompt
//                             federal_reserve_2 is staging-only.
//   --runs-per-arm N          Number of runs per arm (default 8 per plan §Phase 5
//                             pre-registration; research σ ≈ 3.6 mu makes 5 too few).
//   --apply                   Without this, the script dry-runs and prints planned writes.
//   --append                  Add runs to the existing experiment row (looked up by
//                             name) instead of creating a new one. Required after
//                             the first --apply.
//   --reuse-existing          Opt-in to reuse a strategy whose config_hash matches an
//                             already-existing strategy. Default: throw to avoid
//                             contaminating this experiment with prior runs/variants.
//
// Output: prints experiment id + both strategy ids for spot-checking + analysis.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as dns from 'dns';
import {
  upsertStrategy,
  hashStrategyConfig,
} from '../../src/lib/pipeline/setup/findOrCreateStrategy';
import {
  createExperiment,
  addRunToExperiment,
} from '../../src/lib/pipeline/manageExperiments';
import type { StrategyConfig } from '../../src/lib/pipeline/infra/types';

dns.setDefaultResultOrder('ipv4first');

// ─── Constants ──────────────────────────────────────────────────

// federal_reserve_2 — the same staging prompt used by 2 of the 4 original failing
// runs (the other 2 used federal_reserve_3). Picking one prompt keeps the comparison
// clean; federal_reserve_2 is the established A/B baseline (also used by
// seedBundleSplitExperiment.ts).
const PROMPT_ID_FEDERAL_RESERVE_2 = 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f';
const EXPERIMENT_NAME = 'CoherencePassPerf A/B (federal_reserve_2)';

// Match the failing baseline strategy's budget: $0.10 per run.
// (Strategy 244e9767-…, the one that produced the −2.94 to −11.60 mu deltas.)
const BUDGET_USD_PER_RUN = 0.10;

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
  runsPerArm: parseIntArg('--runs-per-arm', 8),
  apply: process.argv.includes('--apply'),
  append: process.argv.includes('--append'),
  reuseExisting: process.argv.includes('--reuse-existing'),
  prodConfirmed: process.argv.includes('--i-know-this-is-prod'),
};

function validateArgs(): void {
  if (!args.target || (args.target !== 'staging' && args.target !== 'prod')) {
    console.error('[FATAL] Missing or invalid --target (must be staging or prod)');
    process.exit(2);
  }
  if (args.target === 'prod' && !args.prodConfirmed) {
    console.error(
      '[FATAL] --target prod requires --i-know-this-is-prod confirmation. ' +
      'federal_reserve_2 is a staging-only prompt; production seeding is almost ' +
      'certainly a mistake.',
    );
    process.exit(2);
  }
}

// ─── Strategy configs ───────────────────────────────────────────

// Both arms mirror the failing baseline strategy (244e9767-…) with ONE deviation:
// the coherence-pass length cap and max cycles are explicitly set. Control =
// legacy (the implicit defaults the failing runs hit); Treatment = new defaults
// shipped by investigate_paragraph_recombine_coherence_pass_performance_20260623.
//
// Setting fields explicitly on BOTH arms achieves two things:
//   1. config_hash is distinct from the failing baseline strategy (which omits
//      both fields — its hash already exists).
//   2. The agent's resolveCoherencePassDefaults() kill switch (env var) only flips
//      runtime DEFAULTS; explicit input always overrides. Explicit pins make the
//      comparison robust to anyone toggling EVOLUTION_COHERENCE_PASS_DEFAULTS_V2.
function buildConfig(arm: 'control' | 'treatment'): StrategyConfig {
  const coherenceKnobs = arm === 'control'
    ? { coherencePassLengthCapRatio: 1.02, coherencePassMaxCycles: 1 }
    : { coherencePassLengthCapRatio: 1.10, coherencePassMaxCycles: 2 };
  return {
    generationModel: 'google/gemini-2.5-flash-lite',
    judgeModel: 'google/gemini-2.5-flash-lite',
    budgetUsd: BUDGET_USD_PER_RUN,
    generationTemperature: 1,
    maxComparisonsPerVariant: 3,
    minBudgetAfterParallelAgentMultiple: 2,
    iterationConfigs: [
      { agentType: 'generate', sourceMode: 'seed', budgetPercent: 30 },
      {
        agentType: 'paragraph_recombine_with_coherence_pass',
        sourceMode: 'pool',
        budgetPercent: 70,
        maxDispatches: 5,
        qualityCutoff: { mode: 'topN', value: 3 },
        rewritesPerParagraph: 5,
        maxComparisonsPerParagraph: 8,
        maxParagraphsPerInvocation: 12,
        ...coherenceKnobs,
      },
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
  armLabel: 'CP-Ctrl' | 'CP-Trt',
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
        `and arena variants. Pass --reuse-existing if intentional, or tweak the config to break the collision.`,
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
    console.log(`[seed]   1. upsertStrategy(control)   → hash ${hashStrategyConfig(controlConfig).slice(0, 12)}…  (lengthCap=1.02, maxCycles=1)`);
    console.log(`[seed]   2. upsertStrategy(treatment) → hash ${hashStrategyConfig(treatmentConfig).slice(0, 12)}…  (lengthCap=1.10, maxCycles=2)`);
    if (!args.append) {
      console.log(`[seed]   3. createExperiment("${EXPERIMENT_NAME}", promptId=${PROMPT_ID_FEDERAL_RESERVE_2})`);
    } else {
      console.log(`[seed]   3. lookup existing experiment "${EXPERIMENT_NAME}"`);
    }
    console.log(`[seed]   4. addRunToExperiment × ${args.runsPerArm * 2} (2 arms × ${args.runsPerArm}, budget $${BUDGET_USD_PER_RUN}/run)`);
    console.log('[seed] Re-run with --apply to write.');
    return;
  }

  const db = buildDb(args.target!);

  // Strategy upserts (with collision guard).
  const ctlStrategyId = await seedStrategy('CP-Ctrl', controlConfig, db, args.reuseExisting);
  const trtStrategyId = await seedStrategy('CP-Trt', treatmentConfig, db, args.reuseExisting);

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

  // Enqueue runs. Interleave arms so the runner picks them up round-robin
  // (counterbalances temporal effects like late-day model latency drift).
  for (let i = 0; i < args.runsPerArm; i++) {
    await addRunToExperiment(experimentId, { strategy_id: ctlStrategyId, budget_cap_usd: BUDGET_USD_PER_RUN }, db);
    await addRunToExperiment(experimentId, { strategy_id: trtStrategyId, budget_cap_usd: BUDGET_USD_PER_RUN }, db);
  }
  console.log(`[seed] Enqueued ${args.runsPerArm * 2} runs (2 arms × ${args.runsPerArm}, budget $${BUDGET_USD_PER_RUN}/run).`);

  console.log('');
  console.log('[seed] Experiment + strategy ids:');
  console.log(`  experiment_id      = ${experimentId}`);
  console.log(`  control_strategy   = ${ctlStrategyId}  (CP-Ctrl: lengthCap=1.02, maxCycles=1)`);
  console.log(`  treatment_strategy = ${trtStrategyId}  (CP-Trt: lengthCap=1.10, maxCycles=2)`);
  console.log('');
  console.log('[seed] Cost tracking: queued runs flow through evolution-runner → createEvolutionLLMClient');
  console.log('[seed]                → recordSpend + llmCallTracking rows. Verify via:');
  console.log(`[seed]   SELECT SUM(cost_usd) FROM evolution_runs WHERE experiment_id='${experimentId}';`);
}

const isDirectExecution = require.main === module
  || process.argv[1]?.endsWith('experiments/seedCoherencePassPerformanceExperiment_20260624.ts');
if (isDirectExecution) {
  main().catch((err) => {
    console.error('[FATAL]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
