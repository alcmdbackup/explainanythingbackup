// Batch runner for evolution pipeline: claims pending runs, executes full pipeline, handles shutdown.
// Usage: npx tsx scripts/evolution-runner.ts [--dry-run] [--max-runs N]

import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// ─── Config ─────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 60_000;
const RUNNER_ID = `runner-${uuidv4().slice(0, 8)}`;
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_RUNS = (() => {
  const idx = process.argv.indexOf('--max-runs');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || 1 : 10;
})();

// ─── Supabase client (service role for RLS bypass) ──────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  }
  return createClient(url, key);
}

// ─── Logger ─────────────────────────────────────────────────────

function log(level: string, message: string, ctx: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  const extra = Object.keys(ctx).length > 0 ? ` ${JSON.stringify(ctx)}` : '';
  console.log(`[${ts}] [${level.toUpperCase()}] ${message}${extra}`);
}

// ─── Claim pending run ──────────────────────────────────────────

interface ClaimedRun {
  id: string;
  explanation_id: number;
  config: Record<string, unknown>;
  budget_cap_usd: number;
}

async function claimNextRun(): Promise<ClaimedRun | null> {
  const supabase = getSupabase();

  // Atomic claim via RPC (FOR UPDATE SKIP LOCKED)
  const { data, error } = await supabase.rpc('claim_evolution_run', {
    p_runner_id: RUNNER_ID,
  });

  if (error) {
    // If the RPC doesn't exist yet, fall back to non-atomic claim
    if (error.code === '42883') {
      log('warn', 'claim_evolution_run RPC not found, using fallback claim');
      return claimNextRunFallback();
    }
    log('error', 'Failed to claim run', { error: error.message });
    return null;
  }

  if (!data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  const run = Array.isArray(data) ? data[0] : data;
  return run as ClaimedRun;
}

async function claimNextRunFallback(): Promise<ClaimedRun | null> {
  const supabase = getSupabase();

  // Find oldest pending run
  const { data: pending } = await supabase
    .from('content_evolution_runs')
    .select('id, explanation_id, config, budget_cap_usd')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (!pending || pending.length === 0) return null;

  const run = pending[0];

  // Attempt to claim (race condition possible without FOR UPDATE SKIP LOCKED)
  const { error } = await supabase
    .from('content_evolution_runs')
    .update({
      status: 'claimed',
      runner_id: RUNNER_ID,
      last_heartbeat: new Date().toISOString(),
      started_at: new Date().toISOString(),
    })
    .eq('id', run.id)
    .eq('status', 'pending');

  if (error) {
    log('warn', 'Failed to claim run (likely race)', { runId: run.id });
    return null;
  }

  return run as ClaimedRun;
}

// ─── Heartbeat ──────────────────────────────────────────────────

function startHeartbeat(runId: string): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const supabase = getSupabase();
      await supabase
        .from('content_evolution_runs')
        .update({ last_heartbeat: new Date().toISOString() })
        .eq('id', runId)
        .eq('runner_id', RUNNER_ID);
    } catch {
      log('warn', 'Heartbeat update failed', { runId });
    }
  }, HEARTBEAT_INTERVAL_MS);
}

// ─── Execute run ────────────────────────────────────────────────

async function executeRun(run: ClaimedRun): Promise<void> {
  // Fetch feature flags before deciding whether to run
  const { fetchEvolutionFeatureFlags } = await import('../src/lib/evolution/core/featureFlags');
  const featureFlags = await fetchEvolutionFeatureFlags(getSupabase());

  log('info', 'Starting evolution run', {
    runId: run.id,
    explanationId: run.explanation_id,
    budget: run.budget_cap_usd,
    dryRun: DRY_RUN,
    flags: featureFlags,
  });

  // Check dry-run: CLI flag OR feature flag
  const isDryRun = DRY_RUN || featureFlags.dryRunOnly;
  if (isDryRun) {
    log('info', 'DRY RUN: would execute full pipeline here', {
      runId: run.id,
      source: DRY_RUN ? 'cli' : 'feature_flag',
    });
    const supabase = getSupabase();
    await supabase.from('content_evolution_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: 'dry-run: no execution performed',
    }).eq('id', run.id);
    return;
  }

  // Dynamic import to avoid loading heavy deps during dry-run
  const {
    PipelineStateImpl,
    executeFullPipeline,
    resolveConfig,
    createCostTracker,
    createEvolutionLogger,
    createEvolutionLLMClient,
    GenerationAgent,
    CalibrationRanker,
    Tournament,
    EvolutionAgent,
  } = await import('../src/lib/evolution/index');

  const config = resolveConfig(run.config as Record<string, unknown>);
  const state = new PipelineStateImpl(await fetchOriginalText(run.explanation_id));

  const logger = createEvolutionLogger(run.id);
  const costTracker = createCostTracker(config);
  const llmClient = createEvolutionLLMClient(RUNNER_ID, costTracker, logger);

  const ctx = {
    payload: {
      originalText: state.originalText,
      title: `Explanation #${run.explanation_id}`,
      explanationId: run.explanation_id,
      runId: run.id,
      config,
    },
    state,
    llmClient,
    logger,
    costTracker,
    runId: run.id,
  };

  const agents = {
    generation: new GenerationAgent(),
    calibration: new CalibrationRanker(),
    tournament: new Tournament(),
    evolution: new EvolutionAgent(),
  };

  const heartbeat = startHeartbeat(run.id);

  const startMs = Date.now();
  try {
    const result = await executeFullPipeline(run.id, agents, ctx, logger, { featureFlags, startMs });
    const durationSeconds = ((Date.now() - startMs) / 1000).toFixed(1);
    log('info', 'Run completed', {
      runId: run.id,
      stopReason: result.stopReason,
      poolSize: state.getPoolSize(),
      totalCost: costTracker.getTotalSpent(),
      duration_seconds: durationSeconds,
      cost_usd: costTracker.getTotalSpent(),
    });
  } catch (error) {
    const durationSeconds = ((Date.now() - startMs) / 1000).toFixed(1);
    log('error', 'Run failed', { runId: run.id, error: String(error), duration_seconds: durationSeconds });
  } finally {
    clearInterval(heartbeat);
  }
}

// ─── Fetch original text ────────────────────────────────────────

async function fetchOriginalText(explanationId: number): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('explanations')
    .select('content')
    .eq('id', explanationId)
    .single();

  if (error || !data) {
    throw new Error(`Failed to fetch explanation #${explanationId}: ${error?.message ?? 'not found'}`);
  }

  return data.content as string;
}

// ─── Graceful shutdown ──────────────────────────────────────────

let shuttingDown = false;

function setupGracefulShutdown() {
  const handler = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'Received shutdown signal, finishing current run...');
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  log('info', 'Evolution runner starting', {
    runnerId: RUNNER_ID,
    dryRun: DRY_RUN,
    maxRuns: MAX_RUNS,
  });

  setupGracefulShutdown();

  let processedRuns = 0;

  while (processedRuns < MAX_RUNS && !shuttingDown) {
    const run = await claimNextRun();

    if (!run) {
      log('info', 'No pending runs found, exiting');
      break;
    }

    await executeRun(run);
    processedRuns++;

    if (processedRuns < MAX_RUNS && !shuttingDown) {
      log('info', 'Looking for next run', { processed: processedRuns, max: MAX_RUNS });
    }
  }

  log('info', 'Runner finished', { processedRuns, shuttingDown });
  process.exit(0);
}

main().catch((error) => {
  log('error', 'Runner crashed', { error: String(error) });
  process.exit(1);
});
