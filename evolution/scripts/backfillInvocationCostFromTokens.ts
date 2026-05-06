#!/usr/bin/env npx tsx
// Backfill evolution_agent_invocations.cost_usd + run-level cost metrics from the
// real provider-billed token counts stored in llmCallTracking. Repairs historical
// values inflated by Bug A (string-length cost math) and Bug B (sibling bleed under
// parallel dispatch).
//
// Usage:
//   npx tsx evolution/scripts/backfillInvocationCostFromTokens.ts               # dry-run, all completed runs
//   npx tsx evolution/scripts/backfillInvocationCostFromTokens.ts --apply       # actually write
//   npx tsx evolution/scripts/backfillInvocationCostFromTokens.ts --run-id UUID # single-run mode
//   npx tsx evolution/scripts/backfillInvocationCostFromTokens.ts --since=2026-04-01
//
// Guards:
//   - Default mode is --dry-run (prints planned writes, doesn't touch DB).
//   - Skips any run whose last_heartbeat is within 15 min of now() (live pipeline might still be writing).
//   - Errors out if llmCallTracking.evolution_invocation_id NULL rate > 10% for targeted window.
//   - Skips invocations with zero llmCallTracking coverage (reports count in summary).
//
// Env: .env.local — NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

// ─── Args ────────────────────────────────────────────────────────
const apply = process.argv.includes('--apply');
const runIdArg = process.argv.find((a) => a.startsWith('--run-id='))?.split('=')[1];
const sinceArg = process.argv.find((a) => a.startsWith('--since='))?.split('=')[1];
// Phase 7-prereq (debug_evolution_run_cost_20260426): allow operator to override
// the >5x cost-delta hard gate when investigation confirms the delta is a real
// Bug A correction (chars/4 over-counting → real-token under-counting).
const allowLargeDeltas = process.argv.includes('--allow-large-deltas');
// Phase 7-prereq: comma-separated run UUIDs to skip during backfill — useful
// after dry-run review reveals specific runs need manual repair instead.
const excludeRunIdsArg = process.argv.find((a) => a.startsWith('--exclude-run-ids='))?.split('=')[1];
const excludeRunIds = new Set(
  excludeRunIdsArg ? excludeRunIdsArg.split(',').map((s) => s.trim()).filter(Boolean) : [],
);
const BATCH_SIZE = 100;
const HEARTBEAT_SKIP_MINUTES = 15;
const NULL_COVERAGE_THRESHOLD = 0.1; // 10%
const LARGE_DELTA_RATIO = 5; // hard gate: any run whose new cost differs from old by >5x must be reviewed

// Snapshot script start — any run with completed_at ≥ this is NOT processed.
const SCRIPT_START = new Date();

// Map evolution_agent_invocations.agent_name → which run-level cost metric the
// invocation's cost rolls up into.
const AGENT_TO_COST_METRIC: Record<string, 'generation_cost' | 'ranking_cost' | 'seed_cost' | null> = {
  generate_from_previous_article: 'generation_cost',
  swiss_ranking: 'ranking_cost',
  merge_ratings: null, // no LLM calls; contributes $0
  create_seed_article: 'seed_cost',
  // B005-S6: reflection wrapper makes both reflection + generation calls; bucket as
  // generation_cost (matches the dominant cost in the wrapper's per-invocation total).
  // Reflection-specific cost is also tracked separately via reflection_cost on the
  // run-level metric written by createEvolutionLLMClient.
  reflect_and_generate_from_previous_article: 'generation_cost',
};

interface InvRow {
  id: string;
  run_id: string;
  agent_name: string;
  cost_usd: number | null;
}

interface LlmRow {
  evolution_invocation_id: string | null;
  estimated_cost_usd: number | null;
}

async function preflightCheck(db: SupabaseClient, sinceIso: string | null): Promise<void> {
  // Reject if > NULL_COVERAGE_THRESHOLD of evolution_* llmCallTracking rows in the window
  // have NULL evolution_invocation_id — indicates the FK wasn't populated so backfill
  // would produce incorrect attribution.
  let query = db.from('llmCallTracking').select('evolution_invocation_id', { count: 'exact', head: true })
    .like('call_source', 'evolution_%');
  if (sinceIso) query = query.gte('created_at', sinceIso);
  const { count: totalCount, error: totalErr } = await query;
  if (totalErr) throw new Error(`preflight: total count failed: ${totalErr.message}`);

  let nullQuery = db.from('llmCallTracking').select('evolution_invocation_id', { count: 'exact', head: true })
    .like('call_source', 'evolution_%')
    .is('evolution_invocation_id', null);
  if (sinceIso) nullQuery = nullQuery.gte('created_at', sinceIso);
  const { count: nullCount, error: nullErr } = await nullQuery;
  if (nullErr) throw new Error(`preflight: null count failed: ${nullErr.message}`);

  if (!totalCount || totalCount === 0) {
    console.log('[preflight] no llmCallTracking rows in window — nothing to backfill.');
    return;
  }
  const nullRate = (nullCount ?? 0) / totalCount;
  console.log(`[preflight] ${nullCount ?? 0}/${totalCount} llmCallTracking rows have NULL evolution_invocation_id (${(nullRate * 100).toFixed(2)}%)`);
  if (nullRate > NULL_COVERAGE_THRESHOLD) {
    throw new Error(
      `Preflight failed: ${(nullRate * 100).toFixed(1)}% of llmCallTracking rows have NULL ` +
      `evolution_invocation_id (threshold ${(NULL_COVERAGE_THRESHOLD * 100).toFixed(0)}%). ` +
      `Backfill would produce wrong cost attribution. Aborting.`,
    );
  }
}

async function fetchTargetRuns(db: SupabaseClient, sinceIso: string | null): Promise<string[]> {
  const heartbeatCutoff = new Date(SCRIPT_START.getTime() - HEARTBEAT_SKIP_MINUTES * 60_000).toISOString();

  if (runIdArg) {
    // Single-run mode still respects race guard.
    const { data, error } = await db.from('evolution_runs')
      .select('id, status, completed_at, last_heartbeat')
      .eq('id', runIdArg)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`Run ${runIdArg} not found`);
    if (data.status !== 'completed') throw new Error(`Run ${runIdArg} status=${data.status}, must be 'completed'`);
    if (data.completed_at && new Date(data.completed_at) >= SCRIPT_START) {
      throw new Error(`Run ${runIdArg} completed at ${data.completed_at} >= script start ${SCRIPT_START.toISOString()}; won't race live writes`);
    }
    if (data.last_heartbeat && data.last_heartbeat >= heartbeatCutoff) {
      throw new Error(`Run ${runIdArg} heartbeat too fresh (${data.last_heartbeat}) — might still be writing`);
    }
    return [runIdArg];
  }

  let query = db.from('evolution_runs').select('id').eq('status', 'completed')
    .lt('completed_at', SCRIPT_START.toISOString())
    .or(`last_heartbeat.is.null,last_heartbeat.lt.${heartbeatCutoff}`);
  if (sinceIso) query = query.gte('completed_at', sinceIso);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id as string);
}

async function fetchInvocationsForRun(db: SupabaseClient, runId: string): Promise<InvRow[]> {
  const { data, error } = await db.from('evolution_agent_invocations')
    .select('id, run_id, agent_name, cost_usd')
    .eq('run_id', runId);
  if (error) throw new Error(error.message);
  return (data ?? []) as InvRow[];
}

async function fetchLlmCostsForInvocations(db: SupabaseClient, invocationIds: string[]): Promise<Map<string, number>> {
  if (invocationIds.length === 0) return new Map();
  const result = new Map<string, number>();
  // Chunk in batches of 500 to avoid .in() URL limits.
  for (let i = 0; i < invocationIds.length; i += 500) {
    const chunk = invocationIds.slice(i, i + 500);
    const { data, error } = await db.from('llmCallTracking')
      .select('evolution_invocation_id, estimated_cost_usd')
      .in('evolution_invocation_id', chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as LlmRow[]) {
      if (!row.evolution_invocation_id) continue;
      const cost = Number(row.estimated_cost_usd ?? 0);
      if (!Number.isFinite(cost)) continue;
      result.set(row.evolution_invocation_id, (result.get(row.evolution_invocation_id) ?? 0) + cost);
    }
  }
  return result;
}

interface RunPlan {
  runId: string;
  invocationWrites: Array<{ invocationId: string; oldCost: number | null; newCost: number }>;
  skippedInvocations: number; // zero-coverage
  runLevel: {
    cost: number;
    generation_cost: number;
    ranking_cost: number;
    seed_cost: number;
  };
}

async function planRun(db: SupabaseClient, runId: string): Promise<RunPlan> {
  const invocations = await fetchInvocationsForRun(db, runId);
  const ids = invocations.map((i) => i.id);
  const llmByInv = await fetchLlmCostsForInvocations(db, ids);

  const plan: RunPlan = {
    runId,
    invocationWrites: [],
    skippedInvocations: 0,
    runLevel: { cost: 0, generation_cost: 0, ranking_cost: 0, seed_cost: 0 },
  };

  for (const inv of invocations) {
    const realCost = llmByInv.get(inv.id);
    const costMetric = AGENT_TO_COST_METRIC[inv.agent_name];
    // Agents that make no LLM calls contribute $0. Compare against any stored value.
    if (costMetric === null) {
      if ((inv.cost_usd ?? 0) !== 0) {
        plan.invocationWrites.push({ invocationId: inv.id, oldCost: inv.cost_usd, newCost: 0 });
      }
      continue;
    }
    if (realCost === undefined) {
      // Skip — no llmCallTracking coverage for this invocation. Don't overwrite with zero.
      plan.skippedInvocations++;
      continue;
    }
    plan.invocationWrites.push({ invocationId: inv.id, oldCost: inv.cost_usd, newCost: realCost });
    plan.runLevel.cost += realCost;
    if (costMetric === 'generation_cost') plan.runLevel.generation_cost += realCost;
    else if (costMetric === 'ranking_cost') plan.runLevel.ranking_cost += realCost;
    else if (costMetric === 'seed_cost') plan.runLevel.seed_cost += realCost;
  }

  return plan;
}

async function applyPlan(db: SupabaseClient, plan: RunPlan): Promise<void> {
  // Update invocation rows
  for (const write of plan.invocationWrites) {
    const { error } = await db.from('evolution_agent_invocations')
      .update({ cost_usd: write.newCost })
      .eq('id', write.invocationId);
    if (error) throw new Error(`Update invocation ${write.invocationId} failed: ${error.message}`);
  }

  // Overwrite run-level cost metrics. Uses plain UPSERT via writeMetric (writeMetricMax
  // would be a no-op when the corrected value is lower than what's already stored).
  const { writeMetric } = await import('../src/lib/metrics/writeMetrics');
  await writeMetric(db, 'run', plan.runId, 'cost', plan.runLevel.cost, 'during_execution');
  await writeMetric(db, 'run', plan.runId, 'generation_cost', plan.runLevel.generation_cost, 'during_execution');
  await writeMetric(db, 'run', plan.runId, 'ranking_cost', plan.runLevel.ranking_cost, 'during_execution');
  await writeMetric(db, 'run', plan.runId, 'seed_cost', plan.runLevel.seed_cost, 'during_execution');
}

async function main(): Promise<void> {
  console.log(`[backfill] start ${SCRIPT_START.toISOString()}  mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  const db = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sinceIso = sinceArg ? new Date(sinceArg).toISOString() : null;
  await preflightCheck(db, sinceIso);

  const runIds = (await fetchTargetRuns(db, sinceIso)).filter((id) => !excludeRunIds.has(id));
  console.log(`[backfill] ${runIds.length} candidate runs${excludeRunIds.size > 0 ? ` (${excludeRunIds.size} excluded via --exclude-run-ids)` : ''}`);
  if (allowLargeDeltas) console.log(`[backfill] --allow-large-deltas active: runs with >${LARGE_DELTA_RATIO}x cost delta will be applied (default behavior would skip them)`);

  const summary = {
    totalRuns: runIds.length,
    runsProcessed: 0,
    runsFullyCovered: 0,
    runsPartiallyCovered: 0,
    runsFullySkipped: 0,
    runsLargeDelta: 0, // Phase 7-prereq: count runs whose max planned delta exceeds LARGE_DELTA_RATIO
    totalInvocationWrites: 0,
    totalInvocationsSkipped: 0,
    excludedByFlag: excludeRunIds.size,
  };

  for (let i = 0; i < runIds.length; i += BATCH_SIZE) {
    const batch = runIds.slice(i, i + BATCH_SIZE);
    for (const runId of batch) {
      try {
        const plan = await planRun(db, runId);
        if (plan.invocationWrites.length === 0 && plan.skippedInvocations === 0) {
          summary.runsFullySkipped++;
          continue;
        }
        const totalInvs = plan.invocationWrites.length + plan.skippedInvocations;
        if (plan.skippedInvocations === 0) summary.runsFullyCovered++;
        else if (plan.invocationWrites.length > 0) summary.runsPartiallyCovered++;
        else { summary.runsFullySkipped++; continue; }

        // Phase 7-prereq: detect >5x cost-delta runs. Computes the max ratio across this
        // run's planned invocation writes (oldCost vs newCost). 0 → any → ratio is treated
        // as "large" (a write that fills in a previously-NULL cost is always interesting).
        const maxRatio = plan.invocationWrites.reduce((max, w) => {
          const oldVal = w.oldCost ?? 0;
          if (oldVal === 0 && w.newCost === 0) return max;
          if (oldVal === 0) return Math.max(max, Number.POSITIVE_INFINITY);
          const ratio = Math.max(w.newCost / oldVal, oldVal / w.newCost);
          return Math.max(max, ratio);
        }, 1);
        const isLargeDelta = maxRatio > LARGE_DELTA_RATIO;
        if (isLargeDelta) summary.runsLargeDelta++;

        summary.totalInvocationWrites += plan.invocationWrites.length;
        summary.totalInvocationsSkipped += plan.skippedInvocations;
        summary.runsProcessed++;

        console.log(
          `[backfill] run=${runId.slice(0, 8)}  invs=${totalInvs}  writes=${plan.invocationWrites.length}  skipped=${plan.skippedInvocations}  ` +
          `cost=$${plan.runLevel.cost.toFixed(6)} gen=$${plan.runLevel.generation_cost.toFixed(6)} rank=$${plan.runLevel.ranking_cost.toFixed(6)} seed=$${plan.runLevel.seed_cost.toFixed(6)}` +
          (isLargeDelta ? `  [LARGE_DELTA maxRatio=${Number.isFinite(maxRatio) ? maxRatio.toFixed(2) : 'inf'}x]` : ''),
        );

        if (apply) {
          if (isLargeDelta && !allowLargeDeltas) {
            console.warn(`[backfill] run=${runId.slice(0, 8)} SKIPPED (--apply): max delta ${Number.isFinite(maxRatio) ? maxRatio.toFixed(2) : 'inf'}x exceeds gate ${LARGE_DELTA_RATIO}x. Investigate, then re-run with --allow-large-deltas (or --exclude-run-ids=${runId} to permanently exclude).`);
            continue;
          }
          await applyPlan(db, plan);
        }
      } catch (err) {
        console.error(`[backfill] run=${runId} FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (runIds.length > BATCH_SIZE) {
      console.log(`[backfill] batch progress ${Math.min(i + BATCH_SIZE, runIds.length)}/${runIds.length}`);
    }
  }

  console.log('[backfill] summary:', JSON.stringify(summary, null, 2));
  if (summary.runsLargeDelta > 0 && apply && !allowLargeDeltas) {
    console.warn(`[backfill] ${summary.runsLargeDelta} run(s) had >${LARGE_DELTA_RATIO}x cost-delta and were SKIPPED. Review, then re-run with --allow-large-deltas to apply, or --exclude-run-ids=<csv> to omit them.`);
  }
  console.log(`[backfill] done. mode=${apply ? 'APPLY' : 'DRY-RUN (re-run with --apply to write)'}`);
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
