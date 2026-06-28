#!/usr/bin/env npx tsx
// Seed script for design_elo_improvement_experiment_20260626: compare 9 evolution
// agent types on improving a single ~1325-Elo seed article, in a NEW isolated arena.
//
// Each arm = a SINGLE round of ONE agent type applied to the seed, repeated to budget
// (Decisions B/D), differing only in agentType (+ each family's minimal required knobs).
// Idempotently sets up the arena: a new evolution_prompts row + TWO seed rows
// (Decision A) — a generation_method='seed' source row (pins the rewrite source) and a
// generation_method='pipeline' anchor row with pinned mu/sigma (the competitor every
// variant is measured against). Goes through upsertStrategy + createExperiment +
// addRunToExperiment so queued runs flow through the real pipeline with FULL COST TRACKING.
//
// Usage:
//   npx tsx evolution/scripts/experiments/seedEloAgentComparisonExperiment_20260626.ts \
//     --target staging --runs-per-arm 2 --apply
//
// Flags: --target {staging} (prod GUARDED, staging-only experiment), --runs-per-arm N
// (default 2 for the ~$5 validation batch), --apply (else dry-run), --append (add to
// existing experiment), --reuse-existing (reuse a colliding strategy hash).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
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
const EXPERIMENT_NAME = 'ELOEXP agent comparison fed reserve 20260626';
const ARENA_PROMPT_NAME = 'ELOEXP Federal Reserve seed 20260626';
// Source variant to copy as the seed (FR2, ~1325 Elo, most-settled — Decision A / KF7).
const SOURCE_SEED_VARIANT_ID = '538bfbc9-5c17-458e-bfde-c4ce6c76dab3';
const BUDGET_USD_PER_RUN = 0.10;

// Shared generic criteria (KF7) for criteria arms — clarity / structure / engagement.
const CRITERIA_IDS = [
  '55a7ba56-9eed-4974-bbfd-7fd89f791058', // clarity
  '7e646847-11b4-49ff-8fed-3580d54f691b', // structure
  'd18c3316-9a36-424e-b0d3-e17655b06c9a', // engagement
];

type Arm =
  | 'generate'
  | 'reflect_and_generate'
  | 'criteria_and_generate'
  | 'single_pass_evaluate_criteria_and_generate'
  | 'proposer_approver_criteria_generate'
  | 'iterative_editing'
  | 'iterative_editing_rewrite'
  | 'paragraph_recombine'
  | 'paragraph_recombine_with_coherence_pass';

const ARMS: Arm[] = [
  'generate',
  'reflect_and_generate',
  'criteria_and_generate',
  'single_pass_evaluate_criteria_and_generate',
  'proposer_approver_criteria_generate',
  'iterative_editing',
  'iterative_editing_rewrite',
  'paragraph_recombine',
  'paragraph_recombine_with_coherence_pass',
];

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
  apply: process.argv.includes('--apply'),
  append: process.argv.includes('--append'),
  reuseExisting: process.argv.includes('--reuse-existing'),
  prodConfirmed: process.argv.includes('--i-know-this-is-prod'),
};
function validateArgs(): void {
  if (args.target !== 'staging' && args.target !== 'prod') {
    console.error('[FATAL] Missing/invalid --target (staging|prod)'); process.exit(2);
  }
  if (args.target === 'prod' && !args.prodConfirmed) {
    console.error('[FATAL] --target prod requires --i-know-this-is-prod (this is a staging-only experiment).');
    process.exit(2);
  }
}

// ─── Strategy configs: 9 arms, each single-round off-seed (Decisions B/D) ─────
const BASE = {
  generationModel: 'google/gemini-2.5-flash-lite',
  judgeModel: 'google/gemini-2.5-flash-lite',
  generationTemperature: 1, // >0 required for editing budget-fill diversity (Phase 1b)
  budgetUsd: BUDGET_USD_PER_RUN,
  maxComparisonsPerVariant: 3,
} as const;

export function buildConfig(arm: Arm): StrategyConfig {
  const iter: Record<string, unknown> = { agentType: arm, sourceMode: 'seed', budgetPercent: 100 };
  const extra: Record<string, unknown> = {};
  if (
    arm === 'criteria_and_generate' ||
    arm === 'single_pass_evaluate_criteria_and_generate' ||
    arm === 'proposer_approver_criteria_generate'
  ) {
    iter.criteriaIds = CRITERIA_IDS;
    iter.weakestK = 2;
  }
  if (arm === 'paragraph_recombine' || arm === 'paragraph_recombine_with_coherence_pass') {
    iter.maxDispatches = 10; // fill budget (paragraph family lever)
    iter.rewritesPerParagraph = 3;
    iter.maxComparisonsPerParagraph = 6;
    iter.maxParagraphsPerInvocation = 12;
    // #3: the sequential paragraph coordinator must emit a structured JSON plan;
    // gemini-2.5-flash-lite produces malformed JSON. Use a reliable JSON model
    // (gpt-4.1-nano, OpenAI-direct) just for the coordinator. One call/invocation.
    extra.coordinatorModel = 'gpt-4.1-nano';
  }
  return { ...BASE, ...extra, iterationConfigs: [iter] } as unknown as StrategyConfig;
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
  return createClient(url, key);
}

// ─── Arena setup: new prompt + two seed rows (idempotent, Decision A) ─────────
export async function setupArena(db: SupabaseClient): Promise<{ promptId: string }> {
  // Idempotent: reuse the arena prompt if it already exists (by name).
  const { data: existingPrompt } = await db
    .from('evolution_prompts').select('id').eq('name', ARENA_PROMPT_NAME).maybeSingle();
  if (existingPrompt) {
    console.log(`[seed] Reusing arena prompt ${existingPrompt.id} ("${ARENA_PROMPT_NAME}").`);
    return { promptId: existingPrompt.id };
  }

  // Fetch the source seed variant (content + pinned rating).
  const { data: src, error: srcErr } = await db
    .from('evolution_variants')
    .select('variant_content, mu, sigma, elo_score')
    .eq('id', SOURCE_SEED_VARIANT_ID).single();
  if (srcErr || !src) throw new Error(`[FATAL] Could not load source seed variant ${SOURCE_SEED_VARIANT_ID}: ${srcErr?.message}`);

  // Create the new arena prompt. The prompt text must be UNIQUE (uq_arena_topic_prompt);
  // it's cosmetic here — seed generation is skipped because we insert a seed-source row —
  // so we use an experiment-tagged string rather than reusing FR2's text (which collides).
  const { data: prompt, error: pErr } = await db
    .from('evolution_prompts')
    .insert({
      prompt: 'Explain the Federal Reserve — what it is, how it works, and why it matters. (arena: design_elo_improvement_experiment_20260626)',
      name: ARENA_PROMPT_NAME,
      status: 'active',
      prompt_kind: 'article',
    })
    .select('id').single();
  if (pErr || !prompt) throw new Error(`[FATAL] Failed to create arena prompt: ${pErr?.message}`);
  const promptId = prompt.id;

  // Two seed rows (Decision A): seed-source (pins rewrite source) + anchor competitor.
  const seedSourceId = randomUUID();
  const anchorId = randomUUID();
  const common = {
    prompt_id: promptId,
    synced_to_arena: true,
    variant_content: src.variant_content,
    variant_kind: 'article' as const,
  };
  const { error: srErr } = await db.from('evolution_variants').insert([
    {
      ...common, id: seedSourceId, generation_method: 'seed',
      mu: src.mu, sigma: src.sigma, elo_score: src.elo_score, arena_match_count: 0,
    },
    {
      ...common, id: anchorId, generation_method: 'pipeline',
      mu: src.mu, sigma: src.sigma, elo_score: src.elo_score, arena_match_count: 0,
    },
  ]);
  if (srErr) throw new Error(`[FATAL] Failed to insert seed rows: ${srErr.message}`);
  console.log(`[seed] Created arena prompt ${promptId} + seed-source ${seedSourceId} + anchor ${anchorId} (mu=${src.mu}, sigma=${src.sigma}).`);
  return { promptId };
}

// ─── Strategy seed (collision guard) ────────────────────────────
export async function seedStrategy(arm: Arm, db: SupabaseClient, reuseExisting: boolean): Promise<string> {
  const cfg = buildConfig(arm);
  const hash = hashStrategyConfig(cfg);
  const { data: existing } = await db
    .from('evolution_strategies').select('id, name').eq('config_hash', hash).maybeSingle();
  if (existing) {
    if (!reuseExisting) {
      throw new Error(`Strategy config_hash collision for arm "${arm}" (existing ${existing.id} "${existing.name}"). Pass --reuse-existing if intentional.`);
    }
    console.warn(`[seed] Reusing existing strategy ${existing.id} for arm "${arm}".`);
    return existing.id;
  }
  const id = await upsertStrategy(db, cfg);
  console.log(`[seed] Created strategy ${id} for arm "${arm}" (hash=${hash.slice(0, 12)}…).`);
  return id;
}

async function findExperimentByName(name: string, db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from('evolution_experiments').select('id').eq('name', name).maybeSingle();
  return data?.id ?? null;
}

// ─── Main ───────────────────────────────────────────────────────
async function main(): Promise<void> {
  validateArgs();
  const totalRuns = ARMS.length * args.runsPerArm;
  const totalBudget = totalRuns * BUDGET_USD_PER_RUN;
  console.log(`[seed] target=${args.target} arms=${ARMS.length} runs-per-arm=${args.runsPerArm} → ${totalRuns} runs, ≤$${totalBudget.toFixed(2)} apply=${args.apply}`);

  if (!args.apply) {
    console.log('[seed] Dry-run. Arms + config hashes:');
    for (const arm of ARMS) console.log(`[seed]   ${arm.padEnd(46)} hash ${hashStrategyConfig(buildConfig(arm)).slice(0, 12)}…`);
    console.log(`[seed] Would set up arena "${ARENA_PROMPT_NAME}" (+2 seed rows), create experiment, queue ${totalRuns} runs. Re-run with --apply.`);
    return;
  }

  const db = buildDb(args.target!);
  const { promptId } = await setupArena(db);

  // ENFORCED budget ceiling: refuse if this batch + already-spent would exceed $40 (Decision E).
  // (Cap is on the full experiment; for the validation batch totalBudget is well under it.)
  const HARD_CAP_USD = 40;
  if (totalBudget > HARD_CAP_USD) {
    throw new Error(`[FATAL] Planned batch budget $${totalBudget.toFixed(2)} exceeds the $${HARD_CAP_USD} experiment cap.`);
  }

  const strategyIds: Record<string, string> = {};
  for (const arm of ARMS) strategyIds[arm] = await seedStrategy(arm, db, args.reuseExisting);

  let experimentId: string;
  if (args.append) {
    const existing = await findExperimentByName(EXPERIMENT_NAME, db);
    if (!existing) throw new Error(`--append requires existing experiment "${EXPERIMENT_NAME}"; none found.`);
    experimentId = existing;
    console.log(`[seed] Reusing experiment ${experimentId} (--append).`);
  } else {
    const created = await createExperiment(EXPERIMENT_NAME, promptId, db);
    experimentId = created.id;
    console.log(`[seed] Created experiment ${experimentId}.`);
  }

  // Interleave arms so the runner picks them round-robin.
  for (let i = 0; i < args.runsPerArm; i++) {
    for (const arm of ARMS) {
      await addRunToExperiment(experimentId, { strategy_id: strategyIds[arm]!, budget_cap_usd: BUDGET_USD_PER_RUN }, db);
    }
  }
  console.log(`[seed] Enqueued ${totalRuns} runs (≤$${totalBudget.toFixed(2)}).`);
  console.log(`  experiment_id = ${experimentId}`);
  console.log(`  prompt_id     = ${promptId}`);
  for (const arm of ARMS) console.log(`  ${arm.padEnd(46)} = ${strategyIds[arm]}`);
  console.log(`[seed] Verify spend: SELECT SUM(cost_usd) FROM evolution_runs WHERE experiment_id='${experimentId}';`);
}

const isDirectExecution = require.main === module
  || process.argv[1]?.endsWith('experiments/seedEloAgentComparisonExperiment_20260626.ts');
if (isDirectExecution) {
  main().catch((err) => { console.error('[FATAL]', err instanceof Error ? err.message : err); process.exit(1); });
}
