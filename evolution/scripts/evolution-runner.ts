// Batch runner for V2 evolution pipeline: claims pending runs from staging + prod databases, executes in parallel, handles shutdown.
// Usage: npx tsx scripts/evolution-runner.ts [--dry-run] [--max-runs N] [--parallel N] [--max-concurrent-llm N]

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { executeV2Run, type ClaimedRun } from '../src/lib/pipeline/runner';
import { callLLM } from '@/lib/services/llms';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';

interface DbTarget { name: string; client: SupabaseClient }
interface TaggedRun { run: ClaimedRun; db: DbTarget }

const REQUIRED_ENV_VARS = [
  'OPENAI_API_KEY',
  'SUPABASE_URL_STAGING',
  'SUPABASE_KEY_STAGING',
  'SUPABASE_URL_PROD',
  'SUPABASE_KEY_PROD',
] as const;

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

const EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001';

async function buildDbTargets(): Promise<DbTarget[]> {
  const names = ['staging', 'prod'] as const;
  const targets: DbTarget[] = names.map((name) => {
    const url = process.env[`SUPABASE_URL_${name.toUpperCase()}`]!;
    const key = process.env[`SUPABASE_KEY_${name.toUpperCase()}`]!;
    return { name, client: createClient(url, key) };
  });

  const failures: string[] = [];
  for (const target of targets) {
    const { error } = await target.client.from('evolution_runs').select('id').limit(1);
    if (error) failures.push(`${target.name}: ${error.message}`);
  }
  if (failures.length > 0) {
    throw new Error(`[FATAL] Unreachable targets:\n${failures.join('\n')}`);
  }

  return targets;
}

function log(level: string, message: string, ctx: Record<string, unknown> = {}): void {
  const ts = new Date().toISOString();
  const extra = Object.keys(ctx).length > 0 ? ` ${JSON.stringify(ctx)}` : '';
  console.log(`[${ts}] [${level.toUpperCase()}] ${message}${extra}`);
}

async function claimNextRun(db: DbTarget): Promise<ClaimedRun | null> {
  const { data, error } = await db.client.rpc('claim_evolution_run', {
    p_runner_id: RUNNER_ID,
  });

  if (error) {
    if (error.code === '42883') {
      log('warn', 'claim_evolution_run RPC not found, using fallback claim', { db: db.name });
      return claimNextRunFallback(db);
    }
    log('error', 'Failed to claim run', { db: db.name, error: error.message });
    return null;
  }

  if (!data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  const run = Array.isArray(data) ? data[0] : data;
  return run as ClaimedRun;
}

async function claimNextRunFallback(db: DbTarget): Promise<ClaimedRun | null> {
  const { data: pending } = await db.client
    .from('evolution_runs')
    .select('id, explanation_id, prompt_id, experiment_id, strategy_config_id, budget_cap_usd')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (!pending || pending.length === 0) return null;

  const run = pending[0];

  const { error } = await db.client
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
    log('warn', 'Failed to claim run (likely race)', { db: db.name, runId: run.id });
    return null;
  }

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

function createLLMProvider() {
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

async function executeRun(tagged: TaggedRun): Promise<void> {
  const { run, db } = tagged;

  log('info', 'Starting evolution run', {
    runId: run.id,
    explanationId: run.explanation_id,
    promptId: run.prompt_id,
    db: db.name,
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

  const llmProvider = createLLMProvider();

  try {
    await executeV2Run(run.id, run, db.client, llmProvider);
    log('info', 'Run completed', { runId: run.id, db: db.name });
  } catch (error) {
    log('error', 'Run failed', { runId: run.id, db: db.name, error: String(error) });
    await markRunFailed(db.client, run.id, String(error));
  }
}

async function markRunFailed(db: SupabaseClient, runId: string, errorMessage: string): Promise<void> {
  try {
    await db.from('evolution_runs').update({
      status: 'failed',
      error_message: errorMessage.slice(0, 2000),
      runner_id: null,
    }).eq('id', runId).in('status', ['pending', 'claimed', 'running']);
  } catch (err) {
    log('error', 'Failed to mark run as failed', { runId, error: String(err) });
  }
}

let shuttingDown = false;

function setupGracefulShutdown(): void {
  const handler = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'Received shutdown signal, finishing current runs...');
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

async function main(): Promise<void> {
  const { initLLMSemaphore } = await import('../../src/lib/services/llmSemaphore');
  initLLMSemaphore(MAX_CONCURRENT_LLM);

  const targets = await buildDbTargets();
  log('info', 'Connected to databases', { targets: targets.map((t) => t.name) });

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

    const batch = await claimBatch(batchSize, targets);

    if (batch.length === 0) {
      log('info', 'No pending runs found, exiting');
      break;
    }

    log('info', 'Processing batch', {
      batchSize: batch.length,
      runIds: batch.map((t) => t.run.id),
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

const isDirectExecution = require.main === module || process.argv[1]?.endsWith('evolution-runner.ts');
if (isDirectExecution) {
  main().catch((error) => {
    log('error', 'Runner crashed', { error: String(error) });
    process.exit(1);
  });
}

export { claimBatch, claimNextRun, parseIntArg, log, executeRun, markRunFailed, buildDbTargets };
export type { ClaimedRun, DbTarget, TaggedRun };
