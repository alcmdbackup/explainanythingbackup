/**
 * One-shot analysis script for Phase 7 staging validation of the
 * updated_criteria_agent_20260505 project.
 *
 * Pulls the most recent N completed runs (default 10) whose strategy uses any
 * of the 3 criteria-driven agent types, then prints:
 *   - Per-agent Elo Δ vs parent_variant (mean/median/p25)
 *   - Sentence verbatim overlap percentile per agent (median/p25/min)
 *   - Bucket table: Elo Δ × overlap percentile per agent
 *   - Mirror-approver agreement rate distribution (propose/approve only)
 *
 * Usage:
 *   npx tsx evolution/scripts/analyzeRecentCriteriaRuns.ts             # last 10 runs
 *   npx tsx evolution/scripts/analyzeRecentCriteriaRuns.ts --limit 20  # last 20 runs
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  if (idx >= 0 && process.argv[idx + 1]) return parseInt(process.argv[idx + 1]!, 10);
  return 10;
})();

const CRITERIA_AGENT_TYPES = [
  'criteria_and_generate',
  'single_pass_evaluate_criteria_and_generate',
  'proposer_approver_criteria_generate',
] as const;

function loadEnv(): { url: string; serviceRoleKey: string } {
  // Prefer .env.local (used by next dev), fall back to .env
  for (const candidate of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: true });
    }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  }
  return { url, serviceRoleKey: key };
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0]!;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (1 - (idx - lo)) + sorted[hi]! * (idx - lo);
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

interface RunRow {
  id: string;
  status: string;
  strategy_id: string;
  prompt_id: string | null;
  created_at: string;
  evolution_strategies: { config: { iterationConfigs?: Array<{ agentType: string }> } } | null;
}

async function fetchRecentRuns(db: SupabaseClient, limit: number): Promise<RunRow[]> {
  const { data, error } = await db
    .from('evolution_runs')
    .select('id, status, strategy_id, prompt_id, created_at, evolution_strategies!inner(config, is_test_content)')
    .eq('status', 'completed')
    .eq('evolution_strategies.is_test_content', false)
    .order('created_at', { ascending: false })
    .limit(50); // pull more, filter to criteria-using
  if (error) throw new Error(`Run fetch failed: ${error.message}`);
  return (data ?? []).filter((r) => {
    const cfg = (r.evolution_strategies as unknown as { config: { iterationConfigs?: Array<{ agentType: string }> } } | null)?.config;
    return cfg?.iterationConfigs?.some((ic) => CRITERIA_AGENT_TYPES.includes(ic.agentType as typeof CRITERIA_AGENT_TYPES[number]));
  }).slice(0, limit) as unknown as RunRow[];
}

interface VariantRow {
  id: string;
  run_id: string;
  parent_variant_id: string | null;
  agent_name: string;
  elo_score: number | null;
  sentence_verbatim_ratio: number | null;
}

async function fetchVariantsForRuns(db: SupabaseClient, runIds: string[]): Promise<VariantRow[]> {
  const { data, error } = await db
    .from('evolution_variants')
    .select('id, run_id, parent_variant_id, agent_name, elo_score, sentence_verbatim_ratio')
    .in('run_id', runIds);
  if (error) throw new Error(`Variants fetch failed: ${error.message}`);
  return (data ?? []) as VariantRow[];
}

async function fetchInvocationsForRuns(
  db: SupabaseClient,
  runIds: string[],
): Promise<Array<{ run_id: string; agent_name: string; execution_detail: Record<string, unknown> | null }>> {
  const { data, error } = await db
    .from('evolution_agent_invocations')
    .select('run_id, agent_name, execution_detail')
    .in('run_id', runIds)
    .eq('agent_name', 'proposer_approver_criteria_generate');
  if (error) throw new Error(`Invocations fetch failed: ${error.message}`);
  return (data ?? []) as Array<{ run_id: string; agent_name: string; execution_detail: Record<string, unknown> | null }>;
}

async function main() {
  const { url, serviceRoleKey } = loadEnv();
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`  Phase 7 Staging Validation — last ${LIMIT} criteria-driven runs`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);

  const runs = await fetchRecentRuns(db, LIMIT);
  if (runs.length === 0) {
    console.log('No criteria-driven completed runs found in non-test strategies.');
    return;
  }

  console.log(`Found ${runs.length} runs. Run IDs:`);
  for (const r of runs) {
    const cfg = (r.evolution_strategies as unknown as { config: { iterationConfigs?: Array<{ agentType: string }> } } | null)?.config;
    const agentTypes = cfg?.iterationConfigs?.map((ic) => ic.agentType).join(' → ') ?? '?';
    console.log(`  ${r.id.slice(0, 8)} (${r.created_at.slice(0, 10)}): ${agentTypes}`);
  }
  console.log();

  const runIds = runs.map((r) => r.id);
  const [variants, paInvocations] = await Promise.all([
    fetchVariantsForRuns(db, runIds),
    fetchInvocationsForRuns(db, runIds),
  ]);

  console.log(`Total variants: ${variants.length}`);

  // Build parent-elo map for delta computation.
  const variantById = new Map<string, VariantRow>();
  for (const v of variants) variantById.set(v.id, v);

  // Per-agent buckets.
  interface AgentBucket {
    eloDeltas: number[];
    overlaps: number[];
    elos: number[];
    count: number;
  }
  const buckets = new Map<string, AgentBucket>();
  for (const v of variants) {
    if (!buckets.has(v.agent_name)) {
      buckets.set(v.agent_name, { eloDeltas: [], overlaps: [], elos: [], count: 0 });
    }
    const b = buckets.get(v.agent_name)!;
    b.count++;
    if (v.elo_score != null) b.elos.push(v.elo_score);
    if (v.sentence_verbatim_ratio != null) b.overlaps.push(v.sentence_verbatim_ratio);
    if (v.parent_variant_id != null && v.elo_score != null) {
      const parent = variantById.get(v.parent_variant_id);
      if (parent?.elo_score != null) {
        b.eloDeltas.push(v.elo_score - parent.elo_score);
      }
    }
  }

  // ── Per-agent summary table ────────────────────────────────────────────
  console.log(`\n──────────────────────────────────────────────────────────────────`);
  console.log(`  Per-agent Elo Δ vs parent (filtered to variants with a parent)`);
  console.log(`──────────────────────────────────────────────────────────────────`);
  console.log(`  ${'agent_name'.padEnd(54)} ${'n'.padStart(4)} ${'mean'.padStart(8)} ${'med'.padStart(8)} ${'p25'.padStart(8)}`);
  for (const [agentName, b] of [...buckets.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${agentName.padEnd(54)} ${String(b.count).padStart(4)} ${fmt(mean(b.eloDeltas), 1).padStart(8)} ${fmt(median(b.eloDeltas), 1).padStart(8)} ${fmt(percentile(b.eloDeltas, 0.25), 1).padStart(8)}`);
  }

  // ── Per-agent sentence-overlap percentiles ─────────────────────────────
  console.log(`\n──────────────────────────────────────────────────────────────────`);
  console.log(`  Per-agent sentence-verbatim ratio (lower = more rewrite)`);
  console.log(`──────────────────────────────────────────────────────────────────`);
  console.log(`  ${'agent_name'.padEnd(54)} ${'n'.padStart(4)} ${'med'.padStart(8)} ${'p25'.padStart(8)} ${'min'.padStart(8)}`);
  for (const [agentName, b] of [...buckets.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${agentName.padEnd(54)} ${String(b.overlaps.length).padStart(4)} ${pct(median(b.overlaps)).padStart(8)} ${pct(percentile(b.overlaps, 0.25)).padStart(8)} ${pct(b.overlaps.length > 0 ? Math.min(...b.overlaps) : null).padStart(8)}`);
  }

  // ── Bucket table: Elo Δ × overlap percentile per agent ─────────────────
  console.log(`\n──────────────────────────────────────────────────────────────────`);
  console.log(`  Elo Δ bucketed by sentence-overlap quintile per agent`);
  console.log(`──────────────────────────────────────────────────────────────────`);
  for (const agentName of CRITERIA_AGENT_TYPES) {
    const variantsForAgent = variants.filter(
      (v) => v.agent_name === agentName && v.parent_variant_id != null && v.elo_score != null && v.sentence_verbatim_ratio != null,
    );
    if (variantsForAgent.length === 0) {
      console.log(`\n  ${agentName}: (no qualifying variants)`);
      continue;
    }
    console.log(`\n  ${agentName} (n=${variantsForAgent.length}):`);
    const bucketEdges: Array<[number, number, string]> = [
      [0.0, 0.2, '0-20%'],
      [0.2, 0.4, '20-40%'],
      [0.4, 0.6, '40-60%'],
      [0.6, 0.8, '60-80%'],
      [0.8, 1.01, '80-100%'],
    ];
    console.log(`    ${'overlap'.padEnd(10)} ${'n'.padStart(4)} ${'mean Δ'.padStart(10)} ${'med Δ'.padStart(10)}`);
    for (const [lo, hi, label] of bucketEdges) {
      const inBucket = variantsForAgent.filter((v) => v.sentence_verbatim_ratio! >= lo && v.sentence_verbatim_ratio! < hi);
      if (inBucket.length === 0) continue;
      const deltas = inBucket.map((v) => {
        const parent = variantById.get(v.parent_variant_id!);
        return v.elo_score! - (parent?.elo_score ?? 1200);
      });
      console.log(`    ${label.padEnd(10)} ${String(inBucket.length).padStart(4)} ${fmt(mean(deltas), 1).padStart(10)} ${fmt(median(deltas), 1).padStart(10)}`);
    }
  }

  // ── Mirror-agreement rate distribution (propose/approve only) ───────────
  if (paInvocations.length > 0) {
    console.log(`\n──────────────────────────────────────────────────────────────────`);
    console.log(`  Mirror-approver agreement rate (propose/approve invocations)`);
    console.log(`──────────────────────────────────────────────────────────────────`);
    const mirrorRates: number[] = [];
    const abortReasons = new Map<string, number>();
    const cycleStats = {
      proposedGroupsRaw: [] as number[],
      approverGroups: [] as number[],
      appliedGroups: [] as number[],
      forwardAccepts: [] as number[],
      mirrorRejects: [] as number[],
    };
    const aggregateDropReasons = new Map<string, number>();

    for (const inv of paInvocations) {
      const detail = inv.execution_detail as Record<string, unknown> | null;
      if (!detail) continue;
      const rate = detail.mirrorAgreementRate as number | null | undefined;
      const abortReason = detail.mirrorAbortReason as string | null | undefined;
      if (rate != null && Number.isFinite(rate)) mirrorRates.push(rate);
      if (abortReason) abortReasons.set(abortReason, (abortReasons.get(abortReason) ?? 0) + 1);

      const cycles = (detail.cycles as Array<Record<string, unknown>> | undefined) ?? [];
      const c0 = cycles[0];
      if (c0) {
        if (typeof c0.proposedGroupsRaw === 'number') cycleStats.proposedGroupsRaw.push(c0.proposedGroupsRaw);
        if (typeof c0.approverGroups === 'number') cycleStats.approverGroups.push(c0.approverGroups);
        const applied = c0.appliedGroups;
        cycleStats.appliedGroups.push(typeof applied === 'number' ? applied : Array.isArray(applied) ? applied.length : 0);
        const forwardDecisions = (c0.forwardDecisions as Array<{ decision?: string }> | undefined) ?? [];
        cycleStats.forwardAccepts.push(forwardDecisions.filter((d) => d.decision === 'accept').length);
        const mirrorDecisions = (c0.mirrorDecisions as Array<{ decision?: string | null }> | undefined) ?? [];
        cycleStats.mirrorRejects.push(mirrorDecisions.filter((d) => d.decision === 'reject').length);
        const dropped = (c0.droppedPostApprover as Array<{ reason?: string }> | undefined) ?? [];
        for (const d of dropped) {
          if (d.reason) aggregateDropReasons.set(d.reason, (aggregateDropReasons.get(d.reason) ?? 0) + 1);
        }
      }
    }
    console.log(`  invocations: ${paInvocations.length}  (with rate: ${mirrorRates.length})`);
    if (mirrorRates.length > 0) {
      console.log(`  rate mean: ${pct(mean(mirrorRates))}   median: ${pct(median(mirrorRates))}   p25: ${pct(percentile(mirrorRates, 0.25))}   p75: ${pct(percentile(mirrorRates, 0.75))}`);
      const lowCount = mirrorRates.filter((r) => r < 0.20).length;
      const highCount = mirrorRates.filter((r) => r > 0.95).length;
      const inBand = mirrorRates.length - lowCount - highCount;
      console.log(`  alert bands: <0.20 → ${lowCount} (${pct(lowCount / mirrorRates.length)})  in-band → ${inBand} (${pct(inBand / mirrorRates.length)})  >0.95 → ${highCount} (${pct(highCount / mirrorRates.length)})`);
    }

    if (abortReasons.size > 0) {
      console.log(`\n  Mirror abort reason distribution:`);
      for (const [reason, count] of [...abortReasons.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${reason.padEnd(36)} ${String(count).padStart(4)}  (${pct(count / paInvocations.length)})`);
      }
    }

    if (cycleStats.proposedGroupsRaw.length > 0) {
      console.log(`\n  Cycle funnel (mean per invocation):`);
      console.log(`    proposed groups (raw):     ${fmt(mean(cycleStats.proposedGroupsRaw), 1)}`);
      console.log(`    after pre-validation:      ${fmt(mean(cycleStats.approverGroups), 1)}`);
      console.log(`    forward-accepted:          ${fmt(mean(cycleStats.forwardAccepts), 1)}`);
      console.log(`    mirror-rejected (good):    ${fmt(mean(cycleStats.mirrorRejects), 1)}`);
      console.log(`    final applied:             ${fmt(mean(cycleStats.appliedGroups), 1)}`);
    }

    if (aggregateDropReasons.size > 0) {
      console.log(`\n  Aggregator drop-reason distribution (across all invocations):`);
      const totalDrops = [...aggregateDropReasons.values()].reduce((s, n) => s + n, 0);
      for (const [reason, count] of [...aggregateDropReasons.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${reason.padEnd(40)} ${String(count).padStart(5)}  (${pct(count / totalDrops)})`);
      }
    }
  }

  // ── Single-pass sentence-overlap diagnostic ─────────────────────────────
  const singlePassVariants = variants.filter((v) => v.agent_name === 'criteria_driven_single_pass');
  if (singlePassVariants.length > 0) {
    const withOverlap = singlePassVariants.filter((v) => v.sentence_verbatim_ratio != null).length;
    console.log(`\n──────────────────────────────────────────────────────────────────`);
    console.log(`  Single-pass coverage diagnostic`);
    console.log(`──────────────────────────────────────────────────────────────────`);
    console.log(`  Total variants: ${singlePassVariants.length}`);
    console.log(`  With sentence_verbatim_ratio set: ${withOverlap} (${pct(withOverlap / singlePassVariants.length)})`);
    console.log(`  With ratio NULL: ${singlePassVariants.length - withOverlap} ← unexpected if Phase 1.4b plumbing is intact`);
  }

  console.log();
}

main().catch((err) => {
  console.error('Analysis failed:', err);
  process.exit(1);
});
