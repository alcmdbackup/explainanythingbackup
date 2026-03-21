// CLI batch runner for V2 evolution pipeline. Claims and executes pending runs.

import { hostname } from 'os';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { initLLMSemaphore, getLLMSemaphore } from '@/lib/services/llmSemaphore';
import { executeV2Run, type ClaimedRun } from '../src/lib/pipeline/runner';

// ─── Arg parsing ─────────────────────────────────────────────────

function parseIntArg(flag: string, defaultVal: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return defaultVal;
  const val = parseInt(process.argv[idx + 1], 10);
  return Number.isFinite(val) && val > 0 ? val : defaultVal;
}

const PARALLEL = parseIntArg('--parallel', 1);
const MAX_RUNS = parseIntArg('--max-runs', Infinity);
const MAX_CONCURRENT_LLM = parseIntArg('--max-concurrent-llm', 20);
const RUNNER_ID = `v2-${hostname()}-${process.pid}-${Date.now()}`;

// ─── LLM provider with semaphore ─────────────────────────────────

function createThrottledProvider() {
  const semaphore = getLLMSemaphore();
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async complete(_prompt: string, _label: string, _opts?: { model?: string }): Promise<string> {
      await semaphore.acquire();
      try {
        // In production, this would call the actual LLM API.
        // For now, the runner is wired but the provider is injected at the call site.
        throw new Error('Raw LLM provider must be injected — this is a placeholder');
      } finally {
        semaphore.release();
      }
    },
  };
}

// ─── Batch loop ──────────────────────────────────────────────────

let shuttingDown = false;

function setupGracefulShutdown(): void {
  const handler = () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.warn('[V2Runner] Shutting down gracefully...');
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

async function claimBatch(db: Awaited<ReturnType<typeof createSupabaseServiceClient>>, batchSize: number): Promise<ClaimedRun[]> {
  const runs: ClaimedRun[] = [];
  for (let i = 0; i < batchSize; i++) {
    const { data, error } = await db.rpc('claim_evolution_run', { p_runner_id: RUNNER_ID });
    if (error || !data || (Array.isArray(data) && data.length === 0)) break;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.id) break;
    runs.push(row as ClaimedRun);
  }
  return runs;
}

async function main(): Promise<void> {
  console.warn(`[V2Runner] Starting: parallel=${PARALLEL}, maxRuns=${MAX_RUNS}, concurrentLLM=${MAX_CONCURRENT_LLM}`);
  initLLMSemaphore(MAX_CONCURRENT_LLM);
  setupGracefulShutdown();

  const db = await createSupabaseServiceClient();
  let processedRuns = 0;

  while (processedRuns < MAX_RUNS && !shuttingDown) {
    const remaining = Math.min(PARALLEL, MAX_RUNS - processedRuns);
    const batch = await claimBatch(db, remaining);

    if (batch.length === 0) {
      console.warn('[V2Runner] No pending runs. Exiting.');
      break;
    }

    console.warn(`[V2Runner] Claimed ${batch.length} runs`);

    // Note: In production, llmProvider would be created with actual API client
    const results = await Promise.allSettled(
      batch.map((run) => executeV2Run(run.id, run, db, createThrottledProvider())),
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('[V2Runner] Run failed:', r.reason);
      }
    }

    processedRuns += batch.length;
  }

  console.warn(`[V2Runner] Done. Processed ${processedRuns} runs.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[V2Runner] Fatal:', err);
  process.exit(1);
});

export { claimBatch, parseIntArg, RUNNER_ID };
