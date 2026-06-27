#!/usr/bin/env npx tsx
// Seed script for the post-merge staging A/B from
// rebuild_coherence_pass_agent_mode_ab_configurable_20260624 (PR #1292).
//
// Compares the new Mode B (rewrite-then-diff, default) against legacy Mode A
// (CriticMarkup-in) at the same aggressive lengthCap/maxCycles settings shipped
// by the prior project. Two paragraph_recombine_with_coherence_pass strategies:
//   - Control = Mode A pinned (explicit coherencePassEditingMode: 'mode_a',
//               lengthCapRatio=1.10, maxCycles=2). Isolates the editing-path
//               change from the lengthCap/maxCycles changes that #1282 shipped.
//   - Treatment = Mode B (default — no coherencePassEditingMode set; runs
//                 auto-upgrade post-merge). config_hash matches the existing
//                 staging strategy "Strategy 7a494f (lite, 2it)"
//                 (fe314a1e-4894-4765-9162-8bf51c827dbc, created 2026-06-24)
//                 so --reuse-existing picks it up — no new strategy row.
//
// Goes through the production strategy/experiment/run infrastructure
// (upsertStrategy + createExperiment + addRunToExperiment), so queued runs flow
// through the real pipeline with FULL COST TRACKING via llmCallTracking when
// the minicomputer evolution-runner picks them up.
//
// Usage:
//   npx tsx evolution/scripts/experiments/seedCoherencePassModeABExperiment_20260626.ts \
//     --target staging \
//     --runs-per-arm 8 \
//     --apply --reuse-existing
//
// Flags:
//   --target {staging|prod}   Required. Production is GUARDED — federal_reserve_2
//                             is a staging-only prompt.
//   --runs-per-arm N          Number of runs per arm (default 8 per Phase 7
//                             pre-registration in the planning doc).
//   --apply                   Without this, the script dry-runs and prints planned writes.
//   --append                  Add runs to the existing experiment row (looked up by
//                             name) instead of creating a new one.
//   --reuse-existing          Required for this script — the Treatment arm
//                             intentionally hashes identically to the existing
//                             "Strategy 7a494f (lite, 2it)" row.
//   --i-know-this-is-prod     Confirmation required when --target prod.
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

// federal_reserve_2 — same staging prompt used by the prior CoherencePassPerf
// A/B (PR #1286). Keeps the comparison anchored to the same workload.
const PROMPT_ID_FEDERAL_RESERVE_2 = 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f';
// v2 (2026-06-27): the v1 experiment ran on a stale minicomputer checkout that
// predated PR #1292, so both arms transparently fell back to Mode A code and the
// `coherencePassEditingMode: 'mode_a'` field on the Control strategy was silently
// dropped by Zod strip-unknown. Minicomputer pulled origin/main at 2026-06-27
// 01:40 UTC; this v2 re-runs the comparison on the live #1292 binary.
const EXPERIMENT_NAME = 'CoherencePassMode A/B v2 (federal_reserve_2)';

// Match the prior A/B's per-run budget for comparability.
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

// Both arms share the EXACT same baseline as the prior CoherencePassPerf
// Treatment arm (Strategy 7a494f / fe314a1e-…) — same models, same budget, same
// per-iteration knobs, same lengthCap=1.10 / maxCycles=2. The ONLY difference is
// the editing mode:
//   - Control: coherencePassEditingMode = 'mode_a' explicitly pinned. Stays on
//     the legacy CriticMarkup-in path even though the runtime default is now
//     'mode_b' post-#1292.
//   - Treatment: coherencePassEditingMode OMITTED so the runtime resolves the
//     default ('mode_b'). config_hash matches "Strategy 7a494f (lite, 2it)"
//     (fe314a1e-…) and --reuse-existing picks up the existing row.
//
// A/B isolation note: prompt also changed in #1292 (Mode B uses the new
// voice-restoration prompt; Mode A uses the original CriticMarkup-targeting
// prompt). This A/B measures the combined effect of (editing path + prompt),
// matching what we're shipping operationally. Per-aspect isolation would
// require a separate A/B.
function buildConfig(arm: 'control' | 'treatment'): StrategyConfig {
  const editingModeKnob = arm === 'control'
    ? { coherencePassEditingMode: 'mode_a' as const }
    : {}; // treatment = omit; runtime default = 'mode_b'
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
        coherencePassLengthCapRatio: 1.10,
        coherencePassMaxCycles: 2,
        ...editingModeKnob,
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
  armLabel: 'Mode-A-Ctrl' | 'Mode-B-Trt',
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
        `For this A/B that's INTENTIONAL on the Treatment arm (re-uses the existing ` +
        `Mode B-equivalent strategy). Pass --reuse-existing to proceed.`,
      );
    }
    console.warn(`[seed] Reusing existing strategy ${existing.id} ("${existing.name}") for arm "${armLabel}".`);
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
  console.log(`[seed] target=${args.target} runs-per-arm=${args.runsPerArm} apply=${args.apply} append=${args.append} reuse-existing=${args.reuseExisting}`);

  const controlConfig = buildConfig('control');
  const treatmentConfig = buildConfig('treatment');

  if (!args.apply) {
    console.log('[seed] Dry-run mode (omit --apply). Planned writes:');
    console.log(`[seed]   1. upsertStrategy(control)   → hash ${hashStrategyConfig(controlConfig).slice(0, 12)}…  (Mode A pinned)`);
    console.log(`[seed]   2. upsertStrategy(treatment) → hash ${hashStrategyConfig(treatmentConfig).slice(0, 12)}…  (Mode B default; expected to re-use fe314a1e-…)`);
    if (!args.append) {
      console.log(`[seed]   3. createExperiment("${EXPERIMENT_NAME}", promptId=${PROMPT_ID_FEDERAL_RESERVE_2})`);
    } else {
      console.log(`[seed]   3. lookup existing experiment "${EXPERIMENT_NAME}"`);
    }
    console.log(`[seed]   4. addRunToExperiment × ${args.runsPerArm * 2} (2 arms × ${args.runsPerArm}, budget $${BUDGET_USD_PER_RUN}/run)`);
    console.log('[seed] Re-run with --apply --reuse-existing to write.');
    return;
  }

  const db = buildDb(args.target!);

  // Strategy upserts (with collision guard).
  const ctlStrategyId = await seedStrategy('Mode-A-Ctrl', controlConfig, db, args.reuseExisting);
  const trtStrategyId = await seedStrategy('Mode-B-Trt', treatmentConfig, db, args.reuseExisting);

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
  console.log(`  control_strategy   = ${ctlStrategyId}  (Mode-A-Ctrl: editingMode='mode_a' pinned)`);
  console.log(`  treatment_strategy = ${trtStrategyId}  (Mode-B-Trt: editingMode default 'mode_b')`);
  console.log('');
  console.log('[seed] Cost tracking: queued runs flow through evolution-runner → createEvolutionLLMClient');
  console.log('[seed]                → recordSpend + llmCallTracking rows. Verify via:');
  console.log(`[seed]   SELECT SUM(cost_usd) FROM evolution_runs WHERE experiment_id='${experimentId}';`);
}

const isDirectExecution = require.main === module
  || process.argv[1]?.endsWith('experiments/seedCoherencePassModeABExperiment_20260626.ts');
if (isDirectExecution) {
  main().catch((err) => {
    console.error('[FATAL]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
