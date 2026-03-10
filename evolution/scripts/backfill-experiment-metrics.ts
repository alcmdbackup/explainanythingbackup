// Backfill metrics_v2 into evolution_experiments.analysis_results.
// Computes per-run metrics using computeRunMetrics and stores under the metrics_v2 key.
// Idempotent, batched, with --dry-run mode (default). Use --run to write.

import dotenv from 'dotenv';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const BATCH_SIZE = 10;
const DRY_RUN = !process.argv.includes('--run');

// ─── Inlined rating helpers (avoid Next.js path alias deps) ──

const DEFAULT_MU = 25;

function toEloScale(mu: number): number {
  return Math.max(0, Math.min(3000, 1200 + mu * (400 / DEFAULT_MU)));
}

// ─── Inlined computeRunMetrics (simplified for backfill) ──

interface MetricValue {
  value: number;
  sigma: number | null;
  ci: [number, number] | null;
  n: number;
}

type MetricsBag = Record<string, MetricValue | null | undefined>;

async function computeRunMetricsForBackfill(
  runId: string,
  supabase: SupabaseClient,
  checkpointCache: Map<string, { ratings: Record<string, { mu: number; sigma: number }> } | null>,
): Promise<MetricsBag> {
  const metrics: MetricsBag = {};

  // 1. Variant stats via RPC
  const { data: statsData, error: statsError } = await supabase.rpc(
    'compute_run_variant_stats',
    { p_run_id: runId },
  );

  type StatsRow = { total_variants: number; median_elo: number | null; p90_elo: number | null; max_elo: number | null };
  const stats: StatsRow | null = statsError
    ? null
    : Array.isArray(statsData) ? (statsData[0] as StatsRow | undefined) ?? null : (statsData as StatsRow | null);

  // 2. Checkpoint for sigma
  const checkpoint = checkpointCache.get(runId) ?? null;
  let variantRatings: Array<{ mu: number; sigma: number }> | null = null;
  if (checkpoint?.ratings && Object.keys(checkpoint.ratings).length > 0) {
    variantRatings = Object.values(checkpoint.ratings);
  }

  // 3. Populate metrics — prefer mu-based values from checkpoint
  if (variantRatings && variantRatings.length > 0) {
    const muElos = variantRatings.map((r) => toEloScale(r.mu));
    muElos.sort((a, b) => a - b);
    metrics.totalVariants = { value: muElos.length, sigma: null, ci: null, n: 1 };
    metrics.medianElo = { value: muElos[Math.min(Math.floor(0.5 * muElos.length), muElos.length - 1)], sigma: null, ci: null, n: 1 };
    metrics.p90Elo = { value: muElos[Math.min(Math.floor(0.9 * muElos.length), muElos.length - 1)], sigma: null, ci: null, n: 1 };
    metrics.maxElo = { value: muElos[muElos.length - 1], sigma: null, ci: null, n: 1 };
  } else if (stats && stats.total_variants > 0) {
    // Fallback to SQL RPC (ordinal-based) when no checkpoint available
    metrics.totalVariants = { value: stats.total_variants, sigma: null, ci: null, n: 1 };
    if (stats.median_elo != null) metrics.medianElo = { value: stats.median_elo, sigma: null, ci: null, n: 1 };
    if (stats.p90_elo != null) metrics.p90Elo = { value: stats.p90_elo, sigma: null, ci: null, n: 1 };
    if (stats.max_elo != null) metrics.maxElo = { value: stats.max_elo, sigma: null, ci: null, n: 1 };
  }

  // 4. Agent costs
  const { data: invocations } = await supabase
    .from('evolution_agent_invocations')
    .select('agent_name, cost_usd')
    .eq('run_id', runId);

  let totalCost = 0;
  if (invocations && invocations.length > 0) {
    const agentCosts = new Map<string, number>();
    for (const inv of invocations as Array<{ agent_name: string; cost_usd: number }>) {
      const cost = Number(inv.cost_usd) || 0;
      agentCosts.set(inv.agent_name, (agentCosts.get(inv.agent_name) ?? 0) + cost);
      totalCost += cost;
    }
    for (const [agent, cost] of agentCosts) {
      metrics[`agentCost:${agent}`] = { value: cost, sigma: null, ci: null, n: 1 };
    }
  }
  metrics.cost = { value: totalCost, sigma: null, ci: null, n: 1 };
  const maxEloVal = (metrics.maxElo as MetricValue | undefined)?.value;
  if (maxEloVal != null && totalCost > 0) {
    metrics['eloPer$'] = { value: (maxEloVal - 1200) / totalCost, sigma: null, ci: null, n: 1 };
  }

  return metrics;
}

// ─── Main ───────────────────────────────────────────────────────

interface BackfillResult {
  succeeded: number;
  failed: number;
  skipped: number;
  failedIds: string[];
}

async function mainWithClient(
  supabase: SupabaseClient,
  writeMode = false,
): Promise<BackfillResult> {
  const dryRun = !writeMode;
  console.log(`Backfill experiment metrics_v2${dryRun ? ' (DRY RUN — use --run to write)' : ''}`);

  // Get experiments with completed/failed runs
  const { data: experiments, error: expError } = await supabase
    .from('evolution_experiments')
    .select('id, status, analysis_results')
    .in('status', ['completed', 'failed', 'cancelled'])
    .order('created_at', { ascending: true });

  if (expError) {
    console.error('Failed to fetch experiments:', expError.message);
    return { succeeded: 0, failed: 0, skipped: 0, failedIds: [] };
  }
  if (!experiments || experiments.length === 0) {
    console.log('No experiments to process');
    return { succeeded: 0, failed: 0, skipped: 0, failedIds: [] };
  }

  console.log(`Found ${experiments.length} experiments to process`);

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const failedIds: string[] = [];

  for (let batch = 0; batch < experiments.length; batch += BATCH_SIZE) {
    const batchExps = experiments.slice(batch, batch + BATCH_SIZE);

    // Batch-load all runs for this batch
    const expIds = batchExps.map((e) => e.id);
    const { data: allRuns } = await supabase
      .from('evolution_runs')
      .select('id, experiment_id, status')
      .in('experiment_id', expIds)
      .eq('status', 'completed');

    const runsByExp = new Map<string, string[]>();
    for (const run of allRuns ?? []) {
      const list = runsByExp.get(run.experiment_id) ?? [];
      list.push(run.id);
      runsByExp.set(run.experiment_id, list);
    }

    // Batch-load checkpoints for all runs
    const allRunIds = (allRuns ?? []).map((r) => r.id);
    const checkpointCache = new Map<string, { ratings: Record<string, { mu: number; sigma: number }> } | null>();

    if (allRunIds.length > 0) {
      // Get latest checkpoint per run via ordering
      const { data: checkpoints } = await supabase
        .from('evolution_checkpoints')
        .select('run_id, state_snapshot')
        .in('run_id', allRunIds)
        .order('created_at', { ascending: false });

      const seen = new Set<string>();
      for (const cp of checkpoints ?? []) {
        if (!seen.has(cp.run_id)) {
          seen.add(cp.run_id);
          const snap = cp.state_snapshot as { ratings?: Record<string, { mu: number; sigma: number }> } | null;
          checkpointCache.set(cp.run_id, snap && snap.ratings ? { ratings: snap.ratings } : null);
        }
      }
    }

    for (const exp of batchExps) {
      try {
        const runIds = runsByExp.get(exp.id) ?? [];
        if (runIds.length === 0) {
          skipped++;
          continue;
        }

        const runMetrics: Record<string, MetricsBag> = {};
        for (const runId of runIds) {
          runMetrics[runId] = await computeRunMetricsForBackfill(runId, supabase, checkpointCache);
        }

        const metricsV2 = { runs: runMetrics, computedAt: new Date().toISOString() };

        if (!dryRun) {
          const existing = (exp.analysis_results as Record<string, unknown>) ?? {};
          const merged = { ...existing, metrics_v2: metricsV2 };
          const { error: writeError } = await supabase
            .from('evolution_experiments')
            .update({ analysis_results: merged })
            .eq('id', exp.id);
          if (writeError) throw new Error(writeError.message);
        }

        succeeded++;
      } catch (e) {
        failed++;
        failedIds.push(exp.id);
        console.error(`  Error processing experiment ${exp.id}: ${String(e)}`);
      }
    }

    console.log(
      `Batch ${Math.floor(batch / BATCH_SIZE) + 1}/${Math.ceil(experiments.length / BATCH_SIZE)}: ` +
      `processed ${Math.min(batch + BATCH_SIZE, experiments.length)}/${experiments.length}`
    );
  }

  console.log(`\nDone: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped (no completed runs)`);
  if (failedIds.length > 0) {
    console.log(`Failed experiment IDs: ${failedIds.join(', ')}`);
  }

  return { succeeded, failed, skipped, failedIds };
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  await mainWithClient(supabase, !DRY_RUN);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}

export { main, mainWithClient, computeRunMetricsForBackfill };
