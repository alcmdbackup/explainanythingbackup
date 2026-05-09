/**
 * Detailed single-pass criteria-driven runs analysis. Pulls all variants from
 * the recent single-pass runs and reports:
 *   - Elo Δ histogram by bucket
 *   - Top 5 winners + bottom 5 losers (with text excerpts)
 *   - Per-run winner Elo
 *   - lengthCapHit + redundancy + flow guardrail telemetry
 *   - Per-iteration breakdown (which iter performed worse)
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

function loadEnv(): { url: string; serviceRoleKey: string } {
  for (const candidate of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing supabase env');
  return { url, serviceRoleKey: key };
}

function fmt(n: number | null | undefined, d = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(d);
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

async function main() {
  const { url, serviceRoleKey } = loadEnv();
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  // Find the 5 single-pass runs.
  const { data: runs } = await db
    .from('evolution_runs')
    .select('id, created_at, evolution_strategies!inner(config, is_test_content)')
    .eq('status', 'completed')
    .eq('evolution_strategies.is_test_content', false)
    .order('created_at', { ascending: false })
    .limit(50);

  const singlePassRuns = (runs ?? []).filter((r) => {
    const cfg = (r.evolution_strategies as unknown as { config: { iterationConfigs?: Array<{ agentType: string }> } } | null)?.config;
    return cfg?.iterationConfigs?.some((ic) => ic.agentType === 'single_pass_evaluate_criteria_and_generate');
  }).slice(0, 5);

  if (singlePassRuns.length === 0) {
    console.log('No single-pass runs found.');
    return;
  }

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`  Single-Pass Detailed Analysis (${singlePassRuns.length} runs)`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);

  const runIds = singlePassRuns.map((r) => r.id);

  // Fetch all variants in these runs.
  const { data: allVariants } = await db
    .from('evolution_variants')
    .select('id, run_id, parent_variant_id, agent_name, elo_score, sentence_verbatim_ratio, variant_content, agent_invocation_id')
    .in('run_id', runIds);

  // Fetch invocations for execution_detail (lengthCapHit + guardrail counts).
  const { data: invocations } = await db
    .from('evolution_agent_invocations')
    .select('id, run_id, agent_name, execution_detail')
    .in('run_id', runIds)
    .eq('agent_name', 'single_pass_evaluate_criteria_and_generate');

  // Build lookup
  const variantsById = new Map((allVariants ?? []).map((v) => [v.id, v]));
  const invocationsById = new Map((invocations ?? []).map((i) => [i.id, i]));

  // Single-pass variants: those tagged with the marker tactic.
  const singlePassVariants = (allVariants ?? []).filter(
    (v) => v.agent_name === 'criteria_driven_single_pass',
  );

  console.log(`Single-pass variants: ${singlePassVariants.length}`);
  console.log(`Single-pass invocations: ${invocations?.length ?? 0}`);
  console.log();

  // Compute Elo Δ per variant.
  interface VariantWithDelta {
    id: string;
    runId: string;
    elo: number | null;
    parentElo: number | null;
    delta: number | null;
    contentExcerpt: string;
    invocationId: string | null;
  }
  const enriched: VariantWithDelta[] = singlePassVariants.map((v) => {
    const parent = v.parent_variant_id ? variantsById.get(v.parent_variant_id) : null;
    const delta = v.elo_score != null && parent?.elo_score != null ? v.elo_score - parent.elo_score : null;
    return {
      id: v.id,
      runId: v.run_id,
      elo: v.elo_score,
      parentElo: parent?.elo_score ?? null,
      delta,
      contentExcerpt: typeof v.variant_content === 'string' ? v.variant_content.slice(0, 120).replace(/\s+/g, ' ') : '—',
      invocationId: v.agent_invocation_id ?? null,
    };
  });

  const withDelta = enriched.filter((v) => v.delta != null);

  // ── Distribution histogram ─────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`  Elo Δ distribution (n=${withDelta.length})`);
  console.log('────────────────────────────────────────────────────────────────');
  const deltas = withDelta.map((v) => v.delta!);
  console.log(`  mean: ${fmt(mean(deltas))}   median: ${fmt(median(deltas))}`);
  console.log();

  const buckets: Array<[number, number, string]> = [
    [-Infinity, -100, '< -100   (catastrophic)'],
    [-100, -50, '-100 to -50  (rewrite disaster)'],
    [-50, -20, '-50 to -20    (poor)'],
    [-20, 0, '-20 to 0      (slight loss)'],
    [0, 20, '0 to +20      (slight gain)'],
    [20, 50, '+20 to +50    (good)'],
    [50, 100, '+50 to +100   (great)'],
    [100, Infinity, '> +100        (winner)'],
  ];
  for (const [lo, hi, label] of buckets) {
    const n = deltas.filter((d) => d >= lo && d < hi).length;
    if (n === 0) continue;
    const bar = '█'.repeat(Math.round((n / deltas.length) * 40));
    console.log(`  ${label.padEnd(36)} ${String(n).padStart(3)}  ${bar}`);
  }
  console.log();

  // ── Top winners + bottom losers ────────────────────────────────
  const sortedByDelta = [...withDelta].sort((a, b) => b.delta! - a.delta!);
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`  Top 5 winners`);
  console.log('────────────────────────────────────────────────────────────────');
  for (const v of sortedByDelta.slice(0, 5)) {
    console.log(`  Δ ${fmt(v.delta).padStart(6)}  Elo ${fmt(v.elo, 0)} (parent ${fmt(v.parentElo, 0)})  run ${v.runId.slice(0, 8)}`);
    console.log(`    ${v.contentExcerpt}…`);
  }
  console.log();
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`  Bottom 5 losers`);
  console.log('────────────────────────────────────────────────────────────────');
  for (const v of sortedByDelta.slice(-5).reverse()) {
    console.log(`  Δ ${fmt(v.delta).padStart(6)}  Elo ${fmt(v.elo, 0)} (parent ${fmt(v.parentElo, 0)})  run ${v.runId.slice(0, 8)}`);
    console.log(`    ${v.contentExcerpt}…`);
  }
  console.log();

  // ── Per-run winner Elo ─────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`  Per-run winner Elo (best variant in each run)`);
  console.log('────────────────────────────────────────────────────────────────');
  for (const runId of runIds) {
    const runVariants = (allVariants ?? []).filter((v) => v.run_id === runId);
    const eloed = runVariants.filter((v) => v.elo_score != null);
    if (eloed.length === 0) {
      console.log(`  ${runId.slice(0, 8)}: no Elo data`);
      continue;
    }
    const max = Math.max(...eloed.map((v) => v.elo_score!));
    const winner = eloed.find((v) => v.elo_score === max)!;
    const winnerKind = winner.agent_name;
    console.log(`  ${runId.slice(0, 8)}: winner Elo ${fmt(max, 0)}  agent_name=${winnerKind}  variants=${runVariants.length}`);
  }
  console.log();

  // ── Length-cap + guardrail telemetry from execution_detail ──────
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`  Single-pass guardrail telemetry (from execution_detail.guardrails)`);
  console.log('────────────────────────────────────────────────────────────────');
  let lengthCapHits = 0;
  let lengthCapTotal = 0;
  let redundancyDrops = 0;
  let flowDrops = 0;
  for (const inv of invocations ?? []) {
    const detail = inv.execution_detail as Record<string, unknown> | null;
    const guardrails = detail?.guardrails as { lengthCapHit?: boolean; redundancyDropCount?: number; flowDropCount?: number } | undefined;
    if (guardrails) {
      if (typeof guardrails.lengthCapHit === 'boolean') {
        lengthCapTotal++;
        if (guardrails.lengthCapHit) lengthCapHits++;
      }
      if (typeof guardrails.redundancyDropCount === 'number') redundancyDrops += guardrails.redundancyDropCount;
      if (typeof guardrails.flowDropCount === 'number') flowDrops += guardrails.flowDropCount;
    }
  }
  console.log(`  invocations with guardrails block: ${lengthCapTotal}`);
  console.log(`  lengthCapHit (output > 1.10× parent): ${lengthCapHits} (${lengthCapTotal > 0 ? ((lengthCapHits / lengthCapTotal) * 100).toFixed(1) : 0}%)`);
  console.log(`  redundancy drops (always 0 for single-pass — no edit groups): ${redundancyDrops}`);
  console.log(`  flow drops (always 0 for single-pass — no edit groups):       ${flowDrops}`);
  console.log();

  // ── Iteration-level breakdown ──────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`  Performance by iteration (which iter is the bottleneck?)`);
  console.log('────────────────────────────────────────────────────────────────');
  const byIteration = new Map<number, number[]>();
  for (const inv of invocations ?? []) {
    const detail = inv.execution_detail as Record<string, unknown> | null;
    if (!detail) continue;
    const iteration = (detail as { iterationIndex?: number }).iterationIndex;
    if (typeof iteration !== 'number') continue;
    // Find variants for this invocation
    const invVariants = singlePassVariants.filter((v) => v.agent_invocation_id === inv.id);
    for (const v of invVariants) {
      const parent = v.parent_variant_id ? variantsById.get(v.parent_variant_id) : null;
      if (parent?.elo_score != null && v.elo_score != null) {
        if (!byIteration.has(iteration)) byIteration.set(iteration, []);
        byIteration.get(iteration)!.push(v.elo_score - parent.elo_score);
      }
    }
  }
  if (byIteration.size === 0) {
    console.log('  (no iteration-level breakdown — execution_detail.iterationIndex not present)');
  } else {
    for (const [iter, deltas] of [...byIteration.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`  iter ${iter}: n=${deltas.length}  mean Δ=${fmt(mean(deltas))}  median Δ=${fmt(median(deltas))}`);
    }
  }
  console.log();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
