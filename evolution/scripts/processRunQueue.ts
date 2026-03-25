// Batch runner for V2 evolution pipeline: claims pending runs via claimAndExecuteRun, handles shutdown.
// Usage: npx tsx evolution/scripts/processRunQueue.ts [--dry-run] [--max-runs N] [--parallel N] [--max-concurrent-llm N]

import { hostname } from 'os';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { initLLMSemaphore } from '../../src/lib/services/llmSemaphore';
import { claimAndExecuteRun } from '../src/lib/pipeline/claimAndExecuteRun';

// ─── Config ─────────────────────────────────────────────────────

function parseIntArg(flag: string, defaultVal: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return defaultVal;
  const val = parseInt(process.argv[idx + 1]!, 10);
  return Number.isFinite(val) && val > 0 ? val : defaultVal;
}

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_RUNS = parseIntArg('--max-runs', 10);
const PARALLEL = parseIntArg('--parallel', 1);
const MAX_CONCURRENT_LLM = parseIntArg('--max-concurrent-llm', 20);
const RUNNER_ID = `v2-${hostname()}-${process.pid}-${Date.now()}`;

interface DbTarget { name: string; client: SupabaseClient }

// ─── Logger ─────────────────────────────────────────────────────

function log(level: string, message: string, ctx: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  const extra = Object.keys(ctx).length > 0 ? ` ${JSON.stringify(ctx)}` : '';
  console.log(`[${ts}] [${level.toUpperCase()}] ${message}${extra}`);
}

// ─── Multi-DB env loading ────────────────────────────────────────

const ENV_TARGETS: { name: string; envFile: string }[] = [
  { name: 'staging', envFile: '.env.local' },
  { name: 'prod', envFile: '.env.evolution-prod' },
];

function loadEnvFile(filename: string): Record<string, string> {
  const filePath = path.resolve(process.cwd(), filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`[FATAL] Missing env file: ${filePath}`);
  }
  return dotenv.parse(fs.readFileSync(filePath));
}

async function buildDbTargets(): Promise<DbTarget[]> {
  // Load shared vars (API keys) into process.env from .env.local
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

  const targets: DbTarget[] = [];
  for (const { name, envFile } of ENV_TARGETS) {
    try {
      const env = loadEnvFile(envFile);
      const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
      const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
      if (!url || !key) {
        log('error', `Skipping target: ${envFile} missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`, { db: name });
        continue;
      }
      targets.push({
        name,
        client: createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }),
      });
    } catch (err) {
      log('error', `Skipping target: failed to load ${envFile}`, { db: name, error: String(err) });
    }
  }

  // Pre-flight connectivity check — warn on failure, don't block other targets
  const reachable: DbTarget[] = [];
  for (const target of targets) {
    const { error } = await target.client.from('evolution_runs').select('id').limit(1);
    if (error) {
      log('error', `Target unreachable, skipping`, { db: target.name, error: error.message });
    } else {
      reachable.push(target);
    }
  }
  if (reachable.length === 0) {
    throw new Error(`[FATAL] No reachable targets — check env files and network`);
  }

  return reachable;
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

  const targets = await buildDbTargets();
  log('info', 'Connected to databases', { targets: targets.map(t => t.name) });

  let processedRuns = 0;

  while (processedRuns < MAX_RUNS && !shuttingDown) {
    const remaining = MAX_RUNS - processedRuns;
    const batchSize = Math.min(PARALLEL, remaining);

    // Build batch: round-robin across targets, up to batchSize
    const batch: { target: DbTarget }[] = [];
    let targetIdx = 0;
    while (batch.length < batchSize) {
      batch.push({ target: targets[targetIdx % targets.length]! });
      targetIdx++;
    }

    // Execute batch in parallel (preserves --parallel N behavior)
    const results = await Promise.allSettled(
      batch.map(({ target }) =>
        claimAndExecuteRun({
          runnerId: RUNNER_ID,
          db: target.client,
          dryRun: DRY_RUN || undefined,
        }).then(result => ({ result, target })),
      ),
    );

    let claimedAny = false;
    for (const settled of results) {
      if (settled.status === 'rejected') {
        log('error', 'claimAndExecuteRun threw unexpectedly', { error: String(settled.reason) });
        continue;
      }
      const { result, target } = settled.value;
      if (result.claimed) {
        claimedAny = true;
        processedRuns++;
        log('info', 'Run completed', {
          db: target.name,
          runId: result.runId,
          stopReason: result.stopReason,
          durationMs: result.durationMs,
          error: result.error,
        });
      }
    }

    if (!claimedAny) {
      log('info', 'No pending runs found, exiting');
      break;
    }

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

export { parseIntArg, log, buildDbTargets, loadEnvFile, main };
export type { DbTarget };
