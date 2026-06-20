#!/usr/bin/env npx tsx
// Phase 6 cancel-experiment wrapper for meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616.
// Wraps the existing cancel_experiment(uuid) RPC + reason-logging via createEntityLogger.
//
// Usage:
//   npx tsx evolution/scripts/cancelExperiment.ts \
//     --experiment-id <expId> \
//     --target staging \
//     --reason "Stage 1 check 3 failed: bypass produced 0 raw groups"
//
// Optional:
//   --archive-strategies     UPDATE evolution_strategies SET status='archived' for the
//                            experiment's strategies. Valid status values per the CHECK
//                            constraint at migration 20260329000001:31-35 are only
//                            ('active', 'archived') — NOT 'deprecated'.
//
// What it does:
//   1. Snapshots now() before the RPC. The post-RPC reason-log SELECT filters by
//      completed_at >= snapshot so re-running the script doesn't re-log historical
//      cancellations against the current --reason.
//   2. Calls db.rpc('cancel_experiment', { p_experiment_id }). The RPC sets
//      experiment status='cancelled' only if currently 'running' AND sets runs
//      in ('pending','claimed','running') to status='failed' with
//      error_message='Experiment cancelled'.
//   3. Logs the reason against each just-cancelled run via createEntityLogger
//      with basePath=['cancelExperiment'] (drops to the subagent_name column).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as dns from 'dns';
import { createEntityLogger } from '../src/lib/pipeline/infra/createEntityLogger';

dns.setDefaultResultOrder('ipv4first');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseStringArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

// ─── Core function (exported for tests) ─────────────────────────

export interface CancelOptions {
  experimentId: string;
  reason: string;
  archiveStrategies?: boolean;
}

export interface CancelResult {
  cancelledRunCount: number;
  archivedStrategyCount: number;
  experimentWasRunning: boolean;
}

export async function cancelExperiment(
  db: SupabaseClient,
  opts: CancelOptions,
): Promise<CancelResult> {
  // Snapshot before the RPC for the discriminating WHERE filter on reason-logging.
  const cancelStartedAt = new Date().toISOString();

  // Was the experiment in 'running' state?  The RPC is a no-op otherwise; we
  // still call it (idempotent) but use this for the result struct.
  const { data: expBefore } = await db
    .from('evolution_experiments')
    .select('status, prompt_id')
    .eq('id', opts.experimentId)
    .maybeSingle();
  if (!expBefore) {
    throw new Error(`Experiment ${opts.experimentId} not found`);
  }
  const experimentWasRunning = expBefore.status === 'running';

  // Cancel via the existing RPC.
  const { error: rpcErr } = await db.rpc('cancel_experiment', {
    p_experiment_id: opts.experimentId,
  });
  if (rpcErr) {
    throw new Error(`cancel_experiment RPC failed: ${rpcErr.message}`);
  }

  // SELECT the runs the RPC just cancelled — discriminating filter on
  // completed_at >= cancelStartedAt so re-runs don't re-log historical cancellations.
  const { data: cancelledRuns, error: selErr } = await db
    .from('evolution_runs')
    .select('id, experiment_id, strategy_id, completed_at')
    .eq('experiment_id', opts.experimentId)
    .eq('status', 'failed')
    .eq('error_message', 'Experiment cancelled')
    .gte('completed_at', cancelStartedAt);
  if (selErr) {
    throw new Error(`Select cancelled runs failed: ${selErr.message}`);
  }

  // Log reason against each just-cancelled run.
  for (const r of cancelledRuns ?? []) {
    const logger = createEntityLogger(
      {
        entityType: 'run',
        entityId: r.id,
        runId: r.id,
        experimentId: r.experiment_id ?? undefined,
        strategyId: r.strategy_id ?? undefined,
      },
      db,
      ['cancelExperiment'],
    );
    await logger.info(opts.reason);
  }

  // Archive strategies (--archive-strategies). Only valid status value per the
  // CHECK constraint at migration 20260329000001:31-35: ('active' | 'archived').
  let archivedStrategyCount = 0;
  if (opts.archiveStrategies) {
    const { data: runs } = await db
      .from('evolution_runs')
      .select('strategy_id')
      .eq('experiment_id', opts.experimentId);
    const strategyIds = Array.from(new Set((runs ?? []).map((r) => r.strategy_id).filter(Boolean) as string[]));
    if (strategyIds.length > 0) {
      const { data: updated, error: updErr } = await db
        .from('evolution_strategies')
        .update({ status: 'archived' })
        .in('id', strategyIds)
        .eq('status', 'active') // no-op on already-archived
        .select('id');
      if (updErr) {
        throw new Error(`Archive strategies failed: ${updErr.message}`);
      }
      archivedStrategyCount = updated?.length ?? 0;
    }
  }

  return {
    cancelledRunCount: cancelledRuns?.length ?? 0,
    archivedStrategyCount,
    experimentWasRunning,
  };
}

// ─── CLI ────────────────────────────────────────────────────────

function buildDb(target: 'staging' | 'prod'): SupabaseClient {
  const envFile = target === 'staging' ? '.env.local' : '.env.evolution-prod';
  const envPath = path.resolve(process.cwd(), envFile);
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

async function main(): Promise<void> {
  const experimentId = parseStringArg('--experiment-id');
  const reason = parseStringArg('--reason');
  const target = (parseStringArg('--target') ?? 'staging') as 'staging' | 'prod';
  const archiveStrategies = process.argv.includes('--archive-strategies');

  if (!experimentId || !UUID_RE.test(experimentId)) {
    throw new Error(`Invalid UUID for --experiment-id: ${experimentId}`);
  }
  if (!reason || reason.length === 0) {
    throw new Error('--reason is required (use a short description of why the experiment was cancelled)');
  }

  const db = buildDb(target);
  const result = await cancelExperiment(db, { experimentId, reason, archiveStrategies });

  console.log(`[cancel] experiment_was_running=${result.experimentWasRunning}`);
  console.log(`[cancel] cancelled_runs=${result.cancelledRunCount}`);
  console.log(`[cancel] archived_strategies=${result.archivedStrategyCount}`);
  if (result.cancelledRunCount === 0 && !result.experimentWasRunning) {
    console.log('[cancel] (Experiment was not running and had no cancellable runs — no-op.)');
  }
}

const isDirectExecution = require.main === module
  || process.argv[1]?.endsWith('cancelExperiment.ts');
if (isDirectExecution) {
  main().catch((err) => {
    console.error('[FATAL]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
