// Batch runner for V2 evolution pipeline: claims pending runs, executes in parallel, handles shutdown.
// Usage: npx tsx evolution/scripts/processRunQueue.ts [--dry-run] [--max-runs N] [--parallel N] [--max-concurrent-llm N]

import { hostname } from 'os';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { initLLMSemaphore } from '../../src/lib/services/llmSemaphore';
import { callLLM } from '../../src/lib/services/llms';
import type { AllowedLLMModelType } from '../../src/lib/schemas/schemas';
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

interface DbTarget { name: string; client: SupabaseClient }
interface TaggedRun { run: ClaimedRun; db: DbTarget }

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

async function claimNextRun(db: DbTarget): Promise<ClaimedRun | null> {
  const { data, error } = await db.client.rpc('claim_evolution_run', {
    p_runner_id: RUNNER_ID,
  });

  if (error) {
    log('error', 'Failed to claim run', { db: db.name, error: error.message });
    return null;
  }

  if (!data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  const run = Array.isArray(data) ? data[0] : data;
  return run as ClaimedRun;
}

async function claimBatch(batchSize: number, targets: DbTarget[]): Promise<TaggedRun[]> {
  const claimed: TaggedRun[] = [];
  const exhausted = new Set<string>();
  let targetIdx = 0;

  while (claimed.length < batchSize && exhausted.size < targets.length) {
    const target = targets[targetIdx % targets.length];
    targetIdx++;
    if (exhausted.has(target.name)) continue;

    const run = await claimNextRun(target);
    if (!run) {
      exhausted.add(target.name);
      continue;
    }
    claimed.push({ run, db: target });
  }
  return claimed;
}

// ─── Mark run failed ─────────────────────────────────────────────

async function markRunFailed(db: SupabaseClient, runId: string, errorMessage: string): Promise<void> {
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

async function executeRun(tagged: TaggedRun): Promise<void> {
  const { run, db } = tagged;
  log('info', 'Starting evolution run', {
    runId: run.id,
    db: db.name,
    explanationId: run.explanation_id,
    promptId: run.prompt_id,
    dryRun: DRY_RUN,
  });

  if (DRY_RUN) {
    log('info', 'DRY RUN: would execute full pipeline here', { runId: run.id, db: db.name });
    await db.client.from('evolution_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: 'dry-run: no execution performed',
    }).eq('id', run.id);
    return;
  }

  const llmProvider = createRawLLMProvider();

  try {
    await executeV2Run(run.id, run, db.client, llmProvider);
    log('info', 'Run completed', { runId: run.id, db: db.name });
  } catch (error) {
    log('error', 'Run failed', { runId: run.id, db: db.name, error: String(error) });
    await markRunFailed(db.client, run.id, String(error));
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

  const targets = await buildDbTargets();
  log('info', 'Connected to databases', { targets: targets.map(t => t.name) });

  let processedRuns = 0;

  while (processedRuns < MAX_RUNS && !shuttingDown) {
    const remaining = MAX_RUNS - processedRuns;
    const batchSize = Math.min(PARALLEL, remaining);

    const batch = await claimBatch(batchSize, targets);

    if (batch.length === 0) {
      log('info', 'No pending runs found, exiting');
      break;
    }

    log('info', 'Processing batch', {
      batchSize: batch.length,
      runIds: batch.map((t) => t.run.id),
      dbs: batch.map((t) => t.db.name),
      processed: processedRuns,
      max: MAX_RUNS,
    });

    const results = await Promise.allSettled(batch.map((tagged) => executeRun(tagged)));

    results.forEach((result, i) => {
      const runId = batch[i].run.id;
      if (result.status === 'rejected') {
        log('error', 'Run rejected (unhandled)', { runId, db: batch[i].db.name, reason: String(result.reason) });
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

export { claimBatch, claimNextRun, parseIntArg, log, executeRun, markRunFailed, buildDbTargets, loadEnvFile };
export type { DbTarget, TaggedRun };
