#!/usr/bin/env npx tsx
// Seed script for rerun_paragraph_recombine_after_bug_fix_evolution_20260630.
//
// CONTEXT: PR #1323 (merged 2026-06-30 13:26 UTC) fixed cross-run paragraph-
// topic contamination in `ParagraphRecombineWithCoherencePassAgent`. Pre-fix,
// every slot in every run drew from globally-shared topics `[para] 0.P1`,
// `[para] 1.P2`, … — Federal Reserve admin-run variants polluted user-
// submission Elo signals. The fix uses `parentVariantId` for the slot topic
// key, isolating each submission's slot pool. All prior FR2 coherence-pass
// A/Bs had biased per-slot Elo signals. This experiment re-validates the
// recombine system on a clean post-fix signal AND sweeps three knobs the
// user wants tested.
//
// DESIGN: 4 arms × 8 runs/arm = 32 runs at $0.10/run = $3.20 total budget.
// All arms use prompt federal_reserve_2 (a546b7e9-…). Each arm changes ONE
// knob from a single reference baseline (Arm A) so the comparisons isolate
// each knob's effect.
//
//   Arm A — Coherence-Pass-Baseline
//     paragraph_recombine_with_coherence_pass, all defaults.
//     Config matches existing "Strategy 7a494f (lite, 2it)" (fe314a1e-…).
//     --reuse-existing picks it up via config_hash collision.
//
//   Arm B — Coherence-Pass-OFF
//     paragraph_recombine_with_coherence_pass + coherencePassEnabled=false
//     + perInvocationCapUsd=0.10 (per CoherencePassEnabled-A/B precedent so
//     control isn't budget-starved). Matches existing "Strategy 66f213
//     (lite, 2it)" (0cd27136-…). --reuse-existing picks it up.
//
//   Arm C — Sequential-Stronger-Coordinator
//     paragraph_recombine (the sequential sibling, NOT coherence-pass),
//     same generationModel + judgeModel as Arm A, with coordinatorModel
//     overridden to 'gpt-5-mini' (the "safe lift" upgrade documented in
//     evolution/src/lib/schemas.ts:1113). Tests whether stronger
//     coordinator-level planning lifts top_elo on the sibling agent.
//     NEW strategy — distinct config_hash.
//
//   Arm D — Coherence-Pass-Stronger-Phase-C
//     paragraph_recombine_with_coherence_pass, all defaults from Arm A,
//     with coherencePassProposerModel + coherencePassApproverModel
//     overridden to 'gpt-5-mini'. Tests whether stronger Phase C
//     (Mode B rewrite + judge) lifts top_elo on the bug-fixed agent.
//     NEW strategy — distinct config_hash.
//
// Cost tracking: goes through the production pipeline
// (upsertStrategy + createExperiment + addRunToExperiment) — queued runs
// flow through evolution-runner → createEvolutionLLMClient → recordSpend +
// llmCallTracking with FULL cost attribution per agent.
//
// Usage:
//   npx tsx evolution/scripts/experiments/seedRerunParagraphRecombineAfterBugFixExperiment_20260630.ts \
//     --target staging \
//     --runs-per-arm 8 \
//     --apply --reuse-existing
//
// Flags:
//   --target {staging|prod}   Required. Production GUARDED — federal_reserve_2
//                             is a staging-only prompt.
//   --runs-per-arm N          Number of runs per arm (default 8).
//   --apply                   Without this, the script dry-runs.
//   --append                  Add runs to the existing experiment row (looked
//                             up by name) instead of creating a new one.
//   --reuse-existing          Required — Arms A + B intentionally hash to
//                             existing strategy ids.
//   --i-know-this-is-prod     Confirmation required when --target prod.
//
// Output: prints experiment id + all four strategy ids for spot-checking
// + analysis.

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
const EXPERIMENT_NAME = 'RerunParagraphRecombineAfterBugFix A/B (federal_reserve_2)';
const BUDGET_USD_PER_RUN = 0.10;
const STRONGER_MODEL = 'gpt-5-mini';

type Arm = 'cp_baseline' | 'cp_off' | 'seq_stronger_coordinator' | 'cp_stronger_phase_c';

const ARM_LABELS: Record<Arm, string> = {
  cp_baseline: 'A-CP-Baseline',
  cp_off: 'B-CP-Off',
  seq_stronger_coordinator: 'C-Seq-Stronger-Coordinator',
  cp_stronger_phase_c: 'D-CP-Stronger-Phase-C',
};

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

// Shared baseline for all four arms (matches existing fe314a1e config except
// where overridden per arm):
const COMMON: Pick<StrategyConfig,
  | 'generationModel' | 'judgeModel' | 'budgetUsd'
  | 'generationTemperature' | 'maxComparisonsPerVariant'
  | 'minBudgetAfterParallelAgentMultiple'
> = {
  generationModel: 'google/gemini-2.5-flash-lite',
  judgeModel: 'google/gemini-2.5-flash-lite',
  budgetUsd: BUDGET_USD_PER_RUN,
  generationTemperature: 1,
  maxComparisonsPerVariant: 3,
  minBudgetAfterParallelAgentMultiple: 2,
};

// Shared per-iteration knobs for the coherence-pass recombine iteration
// (Arms A, B, D — all use paragraph_recombine_with_coherence_pass).
const CP_RECOMBINE_BASE = {
  agentType: 'paragraph_recombine_with_coherence_pass' as const,
  sourceMode: 'pool' as const,
  budgetPercent: 70,
  maxDispatches: 5,
  qualityCutoff: { mode: 'topN' as const, value: 3 },
  rewritesPerParagraph: 5,
  maxComparisonsPerParagraph: 8,
  maxParagraphsPerInvocation: 12,
  coherencePassLengthCapRatio: 1.10,
  coherencePassMaxCycles: 2,
};

function buildConfig(arm: Arm): StrategyConfig {
  if (arm === 'cp_baseline') {
    // Arm A: matches existing fe314a1e exactly.
    return {
      ...COMMON,
      iterationConfigs: [
        { agentType: 'generate', sourceMode: 'seed', budgetPercent: 30 },
        { ...CP_RECOMBINE_BASE },
      ],
    } as unknown as StrategyConfig;
  }
  if (arm === 'cp_off') {
    // Arm B: matches existing 0cd27136 exactly (cp off + pinned cap).
    return {
      ...COMMON,
      iterationConfigs: [
        { agentType: 'generate', sourceMode: 'seed', budgetPercent: 30 },
        {
          ...CP_RECOMBINE_BASE,
          coherencePassEnabled: false,
          perInvocationCapUsd: 0.10,
        },
      ],
    } as unknown as StrategyConfig;
  }
  if (arm === 'seq_stronger_coordinator') {
    // Arm C: sequential agent + stronger coordinator. Strategy-level
    // coordinatorModel field per schemas.ts:1114.
    return {
      ...COMMON,
      coordinatorModel: STRONGER_MODEL,
      iterationConfigs: [
        { agentType: 'generate', sourceMode: 'seed', budgetPercent: 30 },
        {
          agentType: 'paragraph_recombine',
          sourceMode: 'pool',
          budgetPercent: 70,
          maxDispatches: 5,
          qualityCutoff: { mode: 'topN', value: 3 },
          rewritesPerParagraph: 5,
          maxComparisonsPerParagraph: 8,
          maxParagraphsPerInvocation: 12,
        },
      ],
    } as unknown as StrategyConfig;
  }
  if (arm === 'cp_stronger_phase_c') {
    // Arm D: coherence-pass agent + stronger Phase C proposer + approver.
    return {
      ...COMMON,
      iterationConfigs: [
        { agentType: 'generate', sourceMode: 'seed', budgetPercent: 30 },
        {
          ...CP_RECOMBINE_BASE,
          coherencePassProposerModel: STRONGER_MODEL,
          coherencePassApproverModel: STRONGER_MODEL,
        },
      ],
    } as unknown as StrategyConfig;
  }
  throw new Error(`Unknown arm: ${arm satisfies never}`);
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
  arm: Arm,
  cfg: StrategyConfig,
  db: SupabaseClient,
  reuseExisting: boolean,
): Promise<string> {
  const label = ARM_LABELS[arm];
  const hash = hashStrategyConfig(cfg);
  const { data: existing } = await db
    .from('evolution_strategies')
    .select('id, name, created_at')
    .eq('config_hash', hash)
    .maybeSingle();
  if (existing) {
    const intentional = arm === 'cp_baseline' || arm === 'cp_off';
    if (!reuseExisting) {
      throw new Error(
        `Strategy config_hash collision for arm "${label}": hashes identically to ` +
        `existing strategy "${existing.name}" (id=${existing.id}, created ${existing.created_at}). ` +
        `${intentional
          ? `For this A/B that's INTENTIONAL (Arms A + B re-use existing fe314a1e/0cd27136 ` +
            `strategies so post-#1323 runs sit in the same strategy bucket as the pre-fix runs). `
          : `That's NOT intentional for Arms C + D — they should hash distinctly. Investigate. `}` +
        `Pass --reuse-existing to proceed.`,
      );
    }
    console.warn(`[seed] Reusing existing strategy ${existing.id} ("${existing.name}") for arm "${label}".`);
    return existing.id;
  }
  const id = await upsertStrategy(db, cfg);
  console.log(`[seed] Created strategy ${id} for arm "${label}" (hash=${hash.slice(0, 12)}…).`);
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
  console.log(
    `[seed] target=${args.target} runs-per-arm=${args.runsPerArm} apply=${args.apply} ` +
    `append=${args.append} reuse-existing=${args.reuseExisting}`,
  );

  const arms: Arm[] = ['cp_baseline', 'cp_off', 'seq_stronger_coordinator', 'cp_stronger_phase_c'];
  const configs = Object.fromEntries(arms.map((a) => [a, buildConfig(a)])) as Record<Arm, StrategyConfig>;

  if (!args.apply) {
    console.log('[seed] Dry-run mode (omit --apply). Planned writes:');
    arms.forEach((a, i) => {
      const hash = hashStrategyConfig(configs[a]).slice(0, 12);
      const tag = (a === 'cp_baseline' || a === 'cp_off')
        ? ' (expected to REUSE existing strategy)'
        : ' (expected to CREATE new strategy)';
      console.log(`[seed]   ${i + 1}. upsertStrategy(${ARM_LABELS[a]}) → hash ${hash}…${tag}`);
    });
    if (!args.append) {
      console.log(`[seed]   5. createExperiment("${EXPERIMENT_NAME}", promptId=${PROMPT_ID_FEDERAL_RESERVE_2})`);
    } else {
      console.log(`[seed]   5. lookup existing experiment "${EXPERIMENT_NAME}"`);
    }
    const totalRuns = args.runsPerArm * arms.length;
    console.log(
      `[seed]   6. addRunToExperiment × ${totalRuns} ` +
      `(${arms.length} arms × ${args.runsPerArm}, budget $${BUDGET_USD_PER_RUN}/run = ` +
      `$${(totalRuns * BUDGET_USD_PER_RUN).toFixed(2)} total)`,
    );
    console.log('[seed] Re-run with --apply --reuse-existing to write.');
    return;
  }

  const db = buildDb(args.target!);

  // Strategy upserts.
  const strategyIds: Record<Arm, string> = {} as Record<Arm, string>;
  for (const a of arms) {
    strategyIds[a] = await seedStrategy(a, configs[a], db, args.reuseExisting);
  }

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

  // Enqueue runs. Interleave arms round-robin to counterbalance temporal
  // effects (late-day model latency drift, runner-queue ordering).
  for (let i = 0; i < args.runsPerArm; i++) {
    for (const a of arms) {
      await addRunToExperiment(
        experimentId,
        { strategy_id: strategyIds[a], budget_cap_usd: BUDGET_USD_PER_RUN },
        db,
      );
    }
  }
  const totalRuns = args.runsPerArm * arms.length;
  console.log(
    `[seed] Enqueued ${totalRuns} runs (${arms.length} arms × ${args.runsPerArm}, ` +
    `budget $${BUDGET_USD_PER_RUN}/run = $${(totalRuns * BUDGET_USD_PER_RUN).toFixed(2)} total).`,
  );

  console.log('');
  console.log('[seed] Experiment + strategy ids:');
  console.log(`  experiment_id = ${experimentId}`);
  for (const a of arms) {
    console.log(`  ${ARM_LABELS[a].padEnd(28)} = ${strategyIds[a]}`);
  }
  console.log('');
  console.log('[seed] Cost tracking: queued runs flow through evolution-runner → createEvolutionLLMClient');
  console.log('[seed]                → recordSpend + llmCallTracking rows. Verify via:');
  console.log(`[seed]   SELECT SUM(cost_usd) FROM evolution_runs WHERE experiment_id='${experimentId}';`);
}

const isDirectExecution = require.main === module
  || process.argv[1]?.endsWith('experiments/seedRerunParagraphRecombineAfterBugFixExperiment_20260630.ts');
if (isDirectExecution) {
  main().catch((err) => {
    console.error('[FATAL]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
