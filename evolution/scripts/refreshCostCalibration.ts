#!/usr/bin/env npx tsx
// Nightly refresh of evolution_cost_calibration from the last N days of
// evolution_agent_invocations. Aggregates per-(strategy × generation_model × judge_model × phase)
// slice from execution_detail JSONB + evolution_strategies.config model fields.
//
// Usage:
//   npx tsx evolution/scripts/refreshCostCalibration.ts [--days=14] [--dry-run]
// Env:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required)
//   COST_CALIBRATION_SAMPLE_DAYS (default 14)

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as dns from 'dns';

dns.setDefaultResultOrder('ipv4first');
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const argDays = process.argv.find((a) => a.startsWith('--days='))?.split('=')[1];
const daysFromEnv = process.env.COST_CALIBRATION_SAMPLE_DAYS;
const days = Number(argDays ?? daysFromEnv ?? '14');

const SENTINEL = '__unspecified__';

type Phase =
  | 'generation'
  | 'ranking'
  | 'seed_title'
  | 'seed_article'
  | 'reflection'
  | 'iterative_edit_propose'
  | 'iterative_edit_review'
  | 'iterative_edit_drift_recovery';

interface Bucket {
  outputCharsSum: number;
  inputOverheadSum: number;
  costSum: number;
  n: number;
}

interface Invocation {
  agent_name: string | null;
  cost_usd: number | null;
  execution_detail: Record<string, unknown> | null;
  run_id: string;
  created_at: string;
}

interface Run {
  id: string;
  strategy_id: string | null;
}

interface Strategy {
  id: string;
  config: { generationModel?: string; judgeModel?: string } | null;
}

function keyOf(strategy: string, genModel: string, judgeModel: string, phase: Phase): string {
  return `${strategy}|${genModel}|${judgeModel}|${phase}`;
}

function asPhase(raw: unknown): Phase | null {
  if (typeof raw !== 'string') return null;
  switch (raw) {
    case 'generation':
    case 'ranking':
    case 'seed_title':
    case 'seed_article':
    case 'reflection':
    case 'iterative_edit_propose':
    case 'iterative_edit_review':
    case 'iterative_edit_drift_recovery':
      return raw;
    default:
      return null;
  }
}

async function main() {
  const started = Date.now();
  const db = createClient(SUPABASE_URL!, SERVICE_KEY!);

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  console.log(`[refreshCostCalibration] window=${days}d cutoff=${cutoff} dryRun=${dryRun}`);

  // 1. Pull invocations in window.
  const { data: invocationsRaw, error: invErr } = await db
    .from('evolution_agent_invocations')
    .select('agent_name, cost_usd, execution_detail, run_id, created_at')
    .gte('created_at', cutoff);
  if (invErr) {
    console.error('[refreshCostCalibration] query invocations failed', invErr);
    process.exit(1);
  }
  const invocations = (invocationsRaw ?? []) as Invocation[];
  console.log(`[refreshCostCalibration] invocations in window: ${invocations.length}`);

  const runIds = [...new Set(invocations.map((i) => i.run_id).filter(Boolean))];
  if (runIds.length === 0) {
    console.log('[refreshCostCalibration] no runs; nothing to refresh');
    return;
  }

  const { data: runsRaw } = await db
    .from('evolution_runs')
    .select('id, strategy_id')
    .in('id', runIds);
  const runs = (runsRaw ?? []) as Run[];
  const runStrategy = new Map(runs.map((r) => [r.id, r.strategy_id]));

  const strategyIds = [...new Set(runs.map((r) => r.strategy_id).filter((id): id is string => !!id))];
  let strategyConfigs = new Map<string, { generationModel: string; judgeModel: string }>();
  if (strategyIds.length > 0) {
    const { data: strategiesRaw } = await db
      .from('evolution_strategies')
      .select('id, config')
      .in('id', strategyIds);
    strategyConfigs = new Map(
      ((strategiesRaw ?? []) as Strategy[]).map((s) => [
        s.id,
        {
          generationModel: s.config?.generationModel ?? SENTINEL,
          judgeModel: s.config?.judgeModel ?? SENTINEL,
        },
      ]),
    );
  }

  // 2. Bucket invocations by slice.
  const buckets = new Map<string, Bucket>();

  for (const inv of invocations) {
    const detail = (inv.execution_detail ?? {}) as Record<string, unknown>;
    const strategyId = runStrategy.get(inv.run_id);
    const models = strategyId ? strategyConfigs.get(strategyId) : undefined;
    const generationModel = models?.generationModel ?? SENTINEL;
    const judgeModel = models?.judgeModel ?? SENTINEL;
    // B016-S4: GFPA-family agents (generate_from_previous_article,
    // reflect_and_generate_from_previous_article) put the dimension under
    // `detail.tactic`, not `detail.strategy`. Reading only `detail.strategy` bucketed
    // every new-agent invocation under the SENTINEL strategy, losing per-tactic
    // granularity. Prefer detail.tactic (current source of truth) and fall back to
    // detail.strategy (legacy invocations only).
    const strategyLabel = typeof detail.tactic === 'string' ? (detail.tactic as string)
      : typeof detail.strategy === 'string' ? (detail.strategy as string)
      : SENTINEL;

    // GFSA: extract generation + ranking phases.
    const gen = detail.generation as Record<string, unknown> | undefined;
    if (gen && typeof gen.cost === 'number' && Number.isFinite(gen.cost)) {
      const outputChars = typeof gen.outputChars === 'number' && Number.isFinite(gen.outputChars)
        ? (gen.outputChars as number) : 0;
      const key = keyOf(strategyLabel, generationModel, judgeModel, 'generation');
      const b = buckets.get(key) ?? { outputCharsSum: 0, inputOverheadSum: 0, costSum: 0, n: 0 };
      b.outputCharsSum += outputChars;
      b.costSum += gen.cost as number;
      b.n += 1;
      buckets.set(key, b);
    }
    const rank = detail.ranking as Record<string, unknown> | undefined;
    if (rank && typeof rank.cost === 'number' && Number.isFinite(rank.cost)) {
      const key = keyOf(strategyLabel, generationModel, judgeModel, 'ranking');
      const b = buckets.get(key) ?? { outputCharsSum: 0, inputOverheadSum: 0, costSum: 0, n: 0 };
      b.costSum += rank.cost as number;
      b.n += 1;
      buckets.set(key, b);
    }

    // B006-S6: createSeedArticleExecutionDetailSchema actually has fields
    // `generation` and `ranking` (NOT seedTitle/seedArticle as the prior code read).
    // Reading the wrong keys meant every seed bucket was always empty —
    // evolution_cost_calibration never got rows for seed phases. Now we read the
    // real fields and bucket as `seed_title` (using the generation phase data)
    // and `seed_article` (using the ranking phase data is wrong; both phases
    // are LLM calls but the schema only has generation+ranking, so we conflate
    // both into a single 'seed_article' bucket using the generation cost — the
    // ranking phase here is the local-elo binary-search ranking, not a separate
    // LLM call worth its own bucket).
    if (inv.agent_name === 'create_seed_article') {
      const generation = (detail as Record<string, unknown>).generation as Record<string, unknown> | undefined;
      if (generation) {
        const cost = generation.cost;
        if (typeof cost === 'number' && Number.isFinite(cost)) {
          const outputChars = typeof generation.outputChars === 'number' ? (generation.outputChars as number) : 0;
          const key = keyOf(SENTINEL, generationModel, SENTINEL, 'seed_article');
          const b = buckets.get(key) ?? { outputCharsSum: 0, inputOverheadSum: 0, costSum: 0, n: 0 };
          b.outputCharsSum += outputChars;
          b.costSum += cost;
          b.n += 1;
          buckets.set(key, b);
        }
      }
    }
  }

  console.log(`[refreshCostCalibration] buckets computed: ${buckets.size}`);

  // 3. Upsert. Skip empty / zero-sample buckets.
  const rows = [...buckets.entries()].flatMap(([key, b]) => {
    if (b.n <= 0) return [];
    const [strategy, generationModel, judgeModel, phase] = key.split('|');
    return [{
      strategy,
      generation_model: generationModel,
      judge_model: judgeModel,
      phase,
      avg_output_chars: b.outputCharsSum / b.n,
      avg_input_overhead_chars: b.inputOverheadSum / b.n,
      avg_cost_per_call: b.costSum / b.n,
      n_samples: b.n,
      last_refreshed_at: new Date().toISOString(),
    }];
  });

  if (dryRun) {
    console.log('[refreshCostCalibration] --dry-run; first 3 rows:', JSON.stringify(rows.slice(0, 3), null, 2));
    return;
  }

  // Upsert in a single statement (Supabase handles transactional semantics on conflict).
  if (rows.length > 0) {
    const { error: upsertErr } = await db
      .from('evolution_cost_calibration')
      .upsert(rows, { onConflict: 'strategy,generation_model,judge_model,phase' });
    if (upsertErr) {
      console.error('[refreshCostCalibration] upsert failed', upsertErr);
      process.exit(1);
    }
  }

  const durationMs = Date.now() - started;
  const summary = {
    rowsWritten: rows.length,
    bucketsSkipped: buckets.size - rows.length,
    invocationsProcessed: invocations.length,
    windowDays: days,
    durationMs,
  };
  console.log(`[refreshCostCalibration] COST_CALIBRATION_REFRESH_SUMMARY ${JSON.stringify(summary)}`);
}

main().catch((err) => {
  console.error('[refreshCostCalibration] fatal', err);
  process.exit(1);
});
