// Batch runner for V2 evolution pipeline: claims pending runs, executes in parallel, handles shutdown.
// Usage: npx tsx evolution/scripts/processRunQueue.ts [--dry-run] [--max-runs N] [--parallel N] [--max-concurrent-llm N]

import { hostname } from 'os';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { initLLMSemaphore } from '@/lib/services/llmSemaphore';
import { callLLM } from '@/lib/services/llms';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import { executeV2Run } from '../src/lib/pipeline/claimAndExecuteRun';
import type { ClaimedRun } from '../src/lib/pipeline/setup/buildRunContext';

// ─── Config ─────────────────────────────────────────────────────

function parseIntArg(flag: string, defaultVal: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return defaultVal;
  const val = parseInt(process.argv[idx + 1], 10);
  return Number.isFinite(val) && val > 0 ? val : defaultVal;
}

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_RUNS = parseIntArg('--max-runs', 10);
const PARALLEL = parseIntArg('--parallel', 1);
const MAX_CONCURRENT_LLM = parseIntArg('--max-concurrent-llm', 20);
const RUNNER_ID = `v2-${hostname()}-${process.pid}-${Date.now()}`;

/** System UUID for evolution pipeline LLM calls. */
const EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001';

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

// ─── Logger ─────────────────────────────────────────────────────

function log(level: string, message: string, ctx: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  const extra = Object.keys(ctx).length > 0 ? ` ${JSON.stringify(ctx)}` : '';
  console.log(`[${ts}] [${level.toUpperCase()}] ${message}${extra}`);
}

// ─── LLM provider ───────────────────────────────────────────────

function createRawLLMProvider() {
  return {
    async complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> {
      const model = (opts?.model ?? 'deepseek-chat') as AllowedLLMModelType;
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

// ─── Claim pending runs ─────────────────────────────────────────

async function claimNextRun(db: ServiceClient): Promise<ClaimedRun | null> {
  const { data, error } = await db.rpc('claim_evolution_run', {
    p_runner_id: RUNNER_ID,
  });

  if (error) {
    log('error', 'Failed to claim run', { error: error.message });
    return null;
  }

  if (!data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  const run = Array.isArray(data) ? data[0] : data;
  return run as ClaimedRun;
}

async function claimBatch(db: ServiceClient, batchSize: number): Promise<ClaimedRun[]> {
  const claimed: ClaimedRun[] = [];
  for (let i = 0; i < batchSize; i++) {
    const run = await claimNextRun(db);
    if (!run) break;
    claimed.push(run);
  }
  return claimed;
}

// ─── Mark run failed ─────────────────────────────────────────────

async function markRunFailed(db: ServiceClient, runId: string, errorMessage: string): Promise<void> {
  try {
    await db.from('evolution_runs').update({
      status: 'failed',
      error_message: errorMessage.slice(0, 2000),
      completed_at: new Date().toISOString(),
      runner_id: null,
    }).eq('id', runId).in('status', ['pending', 'claimed', 'running']);
  } catch (err) {
    log('error', 'Failed to mark run as failed', { runId, error: String(err) });
  }
}

// ─── Execute run ────────────────────────────────────────────────

async function executeRun(run: ClaimedRun, db: ServiceClient): Promise<void> {
  log('info', 'Starting evolution run', {
    runId: run.id,
    explanationId: run.explanation_id,
    promptId: run.prompt_id,
    dryRun: DRY_RUN,
  });

  if (DRY_RUN) {
    log('info', 'DRY RUN: would execute full pipeline here', { runId: run.id });
    await db.from('evolution_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: 'dry-run: no execution performed',
    }).eq('id', run.id);
    return;
  }

  const llmProvider = createRawLLMProvider();

  try {
    await executeV2Run(run.id, run, db, llmProvider);
    log('info', 'Run completed', { runId: run.id });
  } catch (error) {
    log('error', 'Run failed', { runId: run.id, error: String(error) });
    await markRunFailed(db, run.id, String(error));
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
  initLLMSemaphore(MAX_CONCURRENT_LLM);

  log('info', 'Evolution runner starting', {
    runnerId: RUNNER_ID,
    dryRun: DRY_RUN,
    maxRuns: MAX_RUNS,
    parallel: PARALLEL,
    maxConcurrentLLM: MAX_CONCURRENT_LLM,
  });

  setupGracefulShutdown();

  const db = await createSupabaseServiceClient();
  let processedRuns = 0;

  while (processedRuns < MAX_RUNS && !shuttingDown) {
    const remaining = MAX_RUNS - processedRuns;
    const batchSize = Math.min(PARALLEL, remaining);

    const batch = await claimBatch(db, batchSize);

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

    const results = await Promise.allSettled(batch.map((run) => executeRun(run, db)));

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
const isDirectExecution = require.main === module || process.argv[1]?.endsWith('processRunQueue.ts');
if (isDirectExecution) {
  main().catch((error) => {
    log('error', 'Runner crashed', { error: String(error) });
    process.exit(1);
  });
}

// ─── Exports for testing ─────────────────────────────────────────

export { claimBatch, claimNextRun, parseIntArg, log, executeRun, markRunFailed };
