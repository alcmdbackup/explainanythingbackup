#!/usr/bin/env npx tsx
// Seed script for the post-merge staging A/B from
// rebuild_coherence_pass_agent_mode_ab_configurable_20260624 follow-up.
//
// HYPOTHESIS: The coherence pass is degrading Elo on top of the recombine step.
// Observational evidence (federal_reserve_2, last 30 days, matched models +
// matched parent Elos):
//   - paragraph_recombine (no coherence): n=23, avg Δ from parent = −19 Elo
//   - paragraph_recombine_with_coherence_pass: n=46, avg Δ = −79 Elo
// Apparent cost of coherence pass: ~60 Elo. But that's confounded by different
// agent implementations. This experiment isolates Phase C inside the SAME agent.
//
// SETUP: 2 arms, same agent (paragraph_recombine_with_coherence_pass), same
// models, same parents drawn from the same pool. The only meaningful runtime
// difference is whether Phase C (the coherence pass) runs.
//   - Treatment "CP-On": coherencePassEnabled=true (default), Mode B (default).
//     EXACTLY the existing staging strategy "Strategy 7a494f (lite, 2it)"
//     (fe314a1e-…). config_hash collides → --reuse-existing picks it up.
//   - Control "CP-Off": coherencePassEnabled=false. Skips Phase C; emits the
//     post-recombine article as-is. perInvocationCapUsd pinned to 0.10 so the
//     control isn't unfairly budget-starved (the agent's default cap is $0.05
//     when coherence is off).
//
// Phases A + B (per-slot rewrites + slot ranking + recombine) run identically
// on both arms. Phase A's paragraphRewriteModel, Phase B's slot ranker, and the
// $0.10 per-invocation budget cap are all matched. So a child Elo delta
// between arms is attributable to Phase C.
//
// Why this is cleaner than `paragraph_recombine` vs `…_with_coherence_pass`:
// the two are DIFFERENT AGENTS with potentially different budget allocation,
// slot ranking, and pool drawing. The within-agent control via
// coherencePassEnabled removes all of that.
//
// Goes through the production strategy/experiment/run infrastructure
// (upsertStrategy + createExperiment + addRunToExperiment), so queued runs flow
// through the real pipeline with FULL COST TRACKING via llmCallTracking when
// the minicomputer evolution-runner picks them up.
//
// Usage:
//   npx tsx evolution/scripts/experiments/seedCoherencePassEnabledExperiment_20260627.ts \
//     --target staging \
//     --runs-per-arm 8 \
//     --apply --reuse-existing
//
// Flags:
//   --target {staging|prod}   Required. Production is GUARDED — federal_reserve_2
//                             is a staging-only prompt.
//   --runs-per-arm N          Number of runs per arm (default 8).
//   --apply                   Without this, the script dry-runs.
//   --append                  Add runs to the existing experiment row (looked up
//                             by name) instead of creating a new one.
//   --reuse-existing          Required — the Treatment arm intentionally hashes
//                             identically to existing "Strategy 7a494f (lite, 2it)".
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

const PROMPT_ID_FEDERAL_RESERVE_2 = 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f';
const EXPERIMENT_NAME = 'CoherencePassEnabled A/B (federal_reserve_2)';
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

// Both arms share the EXACT same baseline as existing "Strategy 7a494f (lite,
// 2it)" (fe314a1e-…) — same models, same budget, same per-iteration knobs,
// same Mode B default. The ONLY differences:
//   - Control: coherencePassEnabled=false + perInvocationCapUsd=0.10 (explicit
//     override so the control isn't budget-starved vs the treatment).
//   - Treatment: omit both → runtime defaults to coherencePassEnabled=true and
//     perInvocationCapUsd=0.10 via the canonicalize fold. config_hash matches
//     fe314a1e-… → --reuse-existing picks up the existing row.
function buildConfig(arm: 'control' | 'treatment'): StrategyConfig {
  const coherenceKnob = arm === 'control'
    ? {
        coherencePassEnabled: false,
        // Pin the per-invocation cap so Phase A + B aren't budget-starved.
        // Without this, the canonicalize fold sets it to $0.05 when
        // coherencePassEnabled=false, which would give the control half the
        // budget of the treatment — confounding the comparison.
        perInvocationCapUsd: 0.10,
      }
    : {}; // treatment = omit; runtime defaults match the existing fe314a1e strategy
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
        ...coherenceKnob,
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
  armLabel: 'CP-Off-Ctrl' | 'CP-On-Trt',
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
        `Mode B-default strategy). Pass --reuse-existing to proceed.`,
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
    console.log(`[seed]   1. upsertStrategy(control)   → hash ${hashStrategyConfig(controlConfig).slice(0, 12)}…  (CP-Off: coherencePassEnabled=false, budget pinned $0.10)`);
    console.log(`[seed]   2. upsertStrategy(treatment) → hash ${hashStrategyConfig(treatmentConfig).slice(0, 12)}…  (CP-On: default Mode B; expected to re-use fe314a1e-…)`);
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
  const ctlStrategyId = await seedStrategy('CP-Off-Ctrl', controlConfig, db, args.reuseExisting);
  const trtStrategyId = await seedStrategy('CP-On-Trt', treatmentConfig, db, args.reuseExisting);

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
  console.log(`  control_strategy   = ${ctlStrategyId}  (CP-Off-Ctrl: Phase C skipped)`);
  console.log(`  treatment_strategy = ${trtStrategyId}  (CP-On-Trt:   Phase C runs in Mode B)`);
  console.log('');
  console.log('[seed] Cost tracking: queued runs flow through evolution-runner → createEvolutionLLMClient');
  console.log('[seed]                → recordSpend + llmCallTracking rows. Verify via:');
  console.log(`[seed]   SELECT SUM(cost_usd) FROM evolution_runs WHERE experiment_id='${experimentId}';`);
}

const isDirectExecution = require.main === module
  || process.argv[1]?.endsWith('experiments/seedCoherencePassEnabledExperiment_20260627.ts');
if (isDirectExecution) {
  main().catch((err) => {
    console.error('[FATAL]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
