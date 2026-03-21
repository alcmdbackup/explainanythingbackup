// Batch runner for V2 evolution pipeline: claims pending runs, executes in parallel, handles shutdown.
// Usage: npx tsx scripts/evolution-runner.ts [--dry-run] [--max-runs N] [--parallel N] [--max-concurrent-llm N]

import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { executeV2Run, type ClaimedRun } from '../src/lib/pipeline/runner';
import { callLLM } from '@/lib/services/llms';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';

// ─── Config ─────────────────────────────────────────────────────

const REQUIRED_ENV_VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'] as const;

const missingVars = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  console.error(`[FATAL] Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

const RUNNER_ID = `runner-${uuidv4().slice(0, 8)}`;
const DRY_RUN = process.argv.includes('--dry-run');

function parseIntArg(flag: string, defaultVal: number): number {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || defaultVal : defaultVal;
}

const MAX_RUNS = parseIntArg('--max-runs', 10);
const PARALLEL = parseIntArg('--parallel', 1);
const MAX_CONCURRENT_LLM = parseIntArg('--max-concurrent-llm', 20);

/** System UUID for evolution pipeline LLM calls. */
const EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001';

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
    .from('evolution_runs')
    .select('id, explanation_id, prompt_id, experiment_id, strategy_config_id, budget_cap_usd')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (!pending || pending.length === 0) return null;

  const run = pending[0];

  // Attempt to claim (race condition possible without FOR UPDATE SKIP LOCKED)
  const { error } = await supabase
    .from('evolution_runs')
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

// ─── Batch claiming ─────────────────────────────────────────────

async function claimBatch(batchSize: number): Promise<ClaimedRun[]> {
  const claimed: ClaimedRun[] = [];
  for (let i = 0; i < batchSize; i++) {
    const run = await claimNextRun();
    if (!run) break; // No more pending runs
    claimed.push(run);
  }
  return claimed;
}

// ─── Raw LLM provider for V2 ────────────────────────────────────

function createRawLLMProvider() {
  return {
    async complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> {
      const model = (opts?.model ?? 'gpt-4.1-mini') as AllowedLLMModelType;
      return callLLM(
        prompt,
        `evolution_${label}`,
        EVOLUTION_SYSTEM_USERID,
        model,
        false,
        null,
        null,
        null,
        false,
      );
    },
  };
}

// ─── Execute run ────────────────────────────────────────────────

async function executeRun(run: ClaimedRun): Promise<void> {
  log('info', 'Starting evolution run', {
    runId: run.id,
    explanationId: run.explanation_id,
    promptId: run.prompt_id,
    dryRun: DRY_RUN,
  });

  if (DRY_RUN) {
    log('info', 'DRY RUN: would execute full pipeline here', {
      runId: run.id,
    });
    const supabase = getSupabase();
    await supabase.from('evolution_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: 'dry-run: no execution performed',
    }).eq('id', run.id);
    return;
  }

  const db = getSupabase();
  const llmProvider = createRawLLMProvider();

  try {
    await executeV2Run(run.id, run, db, llmProvider);
    log('info', 'Run completed', { runId: run.id });
  } catch (error) {
    log('error', 'Run failed', { runId: run.id, error: String(error) });
    await markRunFailed(run.id, String(error));
  }
}

// ─── Mark run failed ─────────────────────────────────────────────

async function markRunFailed(runId: string, errorMessage: string): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase.from('evolution_runs').update({
      status: 'failed',
      error_message: errorMessage.slice(0, 2000),
      runner_id: null,
    }).eq('id', runId).in('status', ['pending', 'claimed', 'running']);
  } catch (err) {
    log('error', 'Failed to mark run as failed', { runId, error: String(err) });
  }
}

// ─── Graceful shutdown ──────────────────────────────────────────

let shuttingDown = false;

function setupGracefulShutdown() {
  const handler = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'Received shutdown signal, finishing current runs...');
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  // Initialize LLM semaphore with configured concurrency limit
  const { initLLMSemaphore } = await import('../../src/lib/services/llmSemaphore');
  initLLMSemaphore(MAX_CONCURRENT_LLM);

  log('info', 'Evolution runner starting', {
    runnerId: RUNNER_ID,
    dryRun: DRY_RUN,
    maxRuns: MAX_RUNS,
    parallel: PARALLEL,
    maxConcurrentLLM: MAX_CONCURRENT_LLM,
  });

  setupGracefulShutdown();

  let processedRuns = 0;

  while (processedRuns < MAX_RUNS && !shuttingDown) {
    const remaining = MAX_RUNS - processedRuns;
    const batchSize = Math.min(PARALLEL, remaining);

    const batch = await claimBatch(batchSize);

    if (batch.length === 0) {
      log('info', 'No pending runs found, exiting');
      break;
    }

    log('info', 'Processing batch', {
      batchSize: batch.length,
      runIds: batch.map((r) => r.id),
      processed: processedRuns,
      max: MAX_RUNS,
    });

    const results = await Promise.allSettled(batch.map((run) => executeRun(run)));

    results.forEach((result, i) => {
      const runId = batch[i].id;
      if (result.status === 'rejected') {
        log('error', 'Run rejected (unhandled)', { runId, reason: String(result.reason) });
      }
    });

    processedRuns += batch.length;

    if (processedRuns < MAX_RUNS && !shuttingDown) {
      log('info', 'Batch complete, looking for more runs', { processed: processedRuns, max: MAX_RUNS });
    }
  }

  log('info', 'Runner finished', { processedRuns, shuttingDown });
  process.exit(0);
}

// Only auto-run when executed directly (not when imported in tests)
const isDirectExecution = require.main === module || process.argv[1]?.endsWith('evolution-runner.ts');
if (isDirectExecution) {
  main().catch((error) => {
    log('error', 'Runner crashed', { error: String(error) });
    process.exit(1);
  });
}

// ─── Exports for testing ─────────────────────────────────────────

export { claimBatch, claimNextRun, parseIntArg, log, executeRun, markRunFailed, getSupabase };
export type { ClaimedRun };
