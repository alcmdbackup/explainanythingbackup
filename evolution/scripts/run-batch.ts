/**
 * CLI for running batch evolution experiments with combinatorial config expansion.
 * Reads JSON config, estimates costs, filters by budget, executes runs sequentially.
 *
 * Usage:
 *   npx tsx scripts/run-batch.ts --config experiments/my-batch.json [--dry-run] [--confirm] [--resume <batch-id>]
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import {
  BatchConfigSchema,
  expandBatchConfig,
  filterByBudget,
  type BatchConfig,
  type ExpandedRun,
  type BatchExecutionPlan,
} from '../../src/config/batchRunSchema';
import { estimateRunCostWithAgentModels } from '../src/lib/core/costEstimator';
import { formatCost } from '../../src/config/llmPricing';
import { getOrdinal, ordinalToEloScale } from '../src/lib/core/rating';
import type { EvolutionRunConfig } from '../src/lib/types';

// ─── Types ────────────────────────────────────────────────────────

interface CLIArgs {
  configPath: string;
  dryRun: boolean;
  confirm: boolean;
  resumeId?: string;
}

// ─── Supabase Client ──────────────────────────────────────────────

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key);
}

// ─── Evolution Run Execution ──────────────────────────────────────

interface ExecutionResult {
  runId: string;
  actualCost: number;
  topElo: number;
  stopReason: string;
}

/**
 * Execute a single evolution run for a batch experiment.
 * Creates temporary explanation, queues run, and executes pipeline inline.
 */
async function executeEvolutionRun(
  run: ExpandedRun,
  batchId: string,
  batchName: string
): Promise<ExecutionResult> {
  const supabase = getSupabaseClient();

  // 1. Create temporary explanation for this prompt
  // First, get or create a "Batch Experiments" topic
  const { data: existingTopic } = await supabase
    .from('topics')
    .select('id')
    .eq('topic_title', 'Batch Experiments')
    .single();

  let topicId: number;
  if (existingTopic) {
    topicId = existingTopic.id;
  } else {
    const { data: newTopic, error: topicError } = await supabase
      .from('topics')
      .insert({ topic_title: 'Batch Experiments', topic_description: 'Auto-generated topic for batch evolution experiments' })
      .select('id')
      .single();
    if (topicError || !newTopic) {
      throw new Error(`Failed to create topic: ${topicError?.message ?? 'unknown'}`);
    }
    topicId = newTopic.id;
  }

  const promptTitle = `[Batch: ${batchName}] ${run.prompt.slice(0, 50)}...`;
  const { data: explanation, error: expError } = await supabase
    .from('explanations')
    .insert({
      explanation_title: promptTitle,
      content: run.prompt,
      primary_topic_id: topicId,
      status: 'draft',
    })
    .select('id')
    .single();

  if (expError || !explanation) {
    throw new Error(`Failed to create explanation: ${expError?.message ?? 'unknown'}`);
  }

  // 2. Build partial run config (resolveConfig will merge with defaults)
  // Convert partial budget caps to Record<string, number> (filter undefined values)
  const budgetCaps: Record<string, number> | undefined = run.budgetCaps
    ? Object.fromEntries(
        Object.entries(run.budgetCaps).filter((entry): entry is [string, number] => entry[1] !== undefined)
      )
    : undefined;

  // Note: agentModels per-agent overrides not yet supported in pipeline
  // TODO: Add agentModels support to EvolutionRunConfig when needed
  const runConfig: Partial<EvolutionRunConfig> = {
    generationModel: run.generationModel,
    judgeModel: run.judgeModel,
    maxIterations: run.iterations,
    budgetCapUsd: run.budgetCapUsd,
    ...(budgetCaps && { budgetCaps }),
  };

  // 3. Queue evolution run
  const { data: evolutionRun, error: runError } = await supabase
    .from('evolution_runs')
    .insert({
      explanation_id: explanation.id,
      budget_cap_usd: run.budgetCapUsd,
      config: runConfig,
      batch_run_id: batchId,
      status: 'claimed', // Mark as claimed immediately since we'll execute inline
    })
    .select('id')
    .single();

  if (runError || !evolutionRun) {
    throw new Error(`Failed to create evolution run: ${runError?.message ?? 'unknown'}`);
  }

  const runId = evolutionRun.id;

  // 4. Execute pipeline inline (similar to evolution-runner.ts)
  const {
    executeFullPipeline,
    preparePipelineRun,
  } = await import('../src/lib/index');

  const { ctx, agents, costTracker } = preparePipelineRun({
    runId,
    originalText: run.prompt,
    title: promptTitle,
    explanationId: explanation.id,
    configOverrides: runConfig,
    llmClientId: batchId,
  });

  const startMs = Date.now();
  const result = await executeFullPipeline(runId, agents, ctx, ctx.logger, { startMs });

  // 5. Get final stats
  const actualCost = costTracker.getTotalSpent();
  const { state } = ctx;

  // Get top Elo from pool (ratings are OpenSkill format, convert to Elo scale)
  const topVariant = [...state.pool].sort((a, b) => {
    const ratingA = state.ratings.get(a.id);
    const ratingB = state.ratings.get(b.id);
    const ordA = ratingA ? getOrdinal(ratingA) : 0;
    const ordB = ratingB ? getOrdinal(ratingB) : 0;
    return ordB - ordA;
  })[0];
  const topRating = topVariant ? state.ratings.get(topVariant.id) : null;
  const topElo = topRating ? ordinalToEloScale(getOrdinal(topRating)) : 1200;

  return {
    runId,
    actualCost,
    topElo,
    stopReason: result.stopReason,
  };
}

// ─── CLI Argument Parsing ─────────────────────────────────────────

function parseArgs(argv: string[] = process.argv.slice(2)): CLIArgs {
  function getValue(name: string): string | undefined {
    const idx = argv.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  }

  function getFlag(name: string): boolean {
    return argv.includes(`--${name}`);
  }

  if (getFlag('help') || argv.length === 0) {
    console.log(`Usage: npx tsx scripts/run-batch.ts --config <path> [options]

Options:
  --config <path>    Path to batch config JSON (required)
  --dry-run          Show execution plan without running
  --confirm          Auto-confirm and start execution
  --resume <id>      Resume a previous batch run by ID

Examples:
  npx tsx scripts/run-batch.ts --config experiments/test-batch.json --dry-run
  npx tsx scripts/run-batch.ts --config experiments/test-batch.json --confirm
  npx tsx scripts/run-batch.ts --resume abc123-def456
`);
    process.exit(0);
  }

  const configPath = getValue('config');
  const resumeId = getValue('resume');

  if (!configPath && !resumeId) {
    console.error('Error: --config <path> or --resume <id> is required');
    process.exit(1);
  }

  return {
    configPath: configPath ?? '',
    dryRun: getFlag('dry-run'),
    confirm: getFlag('confirm'),
    resumeId,
  };
}

// ─── Config Loading ───────────────────────────────────────────────

function loadAndValidateConfig(configPath: string): BatchConfig {
  // Security: Validate config path is within allowed directories
  const resolved = path.resolve(configPath);
  const projectRoot = path.resolve(__dirname, '..');
  const allowedDirs = [
    path.join(projectRoot, 'experiments'),
    path.join(projectRoot, 'config'),
  ];

  const isAllowed = allowedDirs.some(dir => resolved.startsWith(dir + path.sep)) ||
    allowedDirs.some(dir => resolved === dir);

  if (!isAllowed) {
    throw new Error(`Config file must be in experiments/ or config/ directory. Got: ${resolved}`);
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch (e) {
    throw new Error(`Invalid JSON in config file: ${e instanceof Error ? e.message : String(e)}`);
  }

  return BatchConfigSchema.parse(raw);
}

// ─── Cost Estimation ──────────────────────────────────────────────

async function estimateRunCosts(runs: ExpandedRun[]): Promise<void> {
  for (const run of runs) {
    // Estimate text length from prompt (rough heuristic)
    const estimatedTextLength = run.prompt.length * 100;

    const estimate = await estimateRunCostWithAgentModels({
      generationModel: run.generationModel,
      judgeModel: run.judgeModel,
      maxIterations: run.iterations,
      agentModels: run.agentModels,
    }, estimatedTextLength);

    run.estimatedCost = estimate.totalUsd;
  }
}

// ─── Execution Plan Building ──────────────────────────────────────

async function buildExecutionPlan(config: BatchConfig): Promise<BatchExecutionPlan> {
  // Expand matrix + explicit runs
  let runs = expandBatchConfig(config);

  // Estimate costs for each run
  await estimateRunCosts(runs);

  // Filter by budget with priority sorting
  const prioritySort = config.optimization?.prioritySort ?? 'cost_asc';
  runs = filterByBudget(
    runs,
    config.totalBudgetUsd,
    config.safetyMargin ?? 0.1,
    prioritySort
  );

  const totalEstimatedCost = runs
    .filter(r => r.status === 'pending')
    .reduce((sum, r) => sum + r.estimatedCost, 0);

  const runsPlanned = runs.filter(r => r.status === 'pending').length;
  const runsSkipped = runs.filter(r => r.status === 'skipped').length;

  return {
    config,
    runs,
    totalEstimatedCost,
    runsPlanned,
    runsSkipped,
    effectiveBudget: config.totalBudgetUsd * (1 - (config.safetyMargin ?? 0.1)),
  };
}

// ─── Display Functions ────────────────────────────────────────────

function displayPlan(plan: BatchExecutionPlan): void {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`Batch: ${plan.config.name}`);
  if (plan.config.description) {
    console.log(`Description: ${plan.config.description}`);
  }
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Budget:');
  console.log(`  Total:     ${formatCost(plan.config.totalBudgetUsd)}`);
  console.log(`  Safety:    ${((plan.config.safetyMargin ?? 0.1) * 100).toFixed(0)}%`);
  console.log(`  Effective: ${formatCost(plan.effectiveBudget)}`);
  console.log(`  Estimated: ${formatCost(plan.totalEstimatedCost)}`);
  console.log();

  console.log('Runs:');
  console.log(`  Planned:   ${plan.runsPlanned}`);
  console.log(`  Skipped:   ${plan.runsSkipped} (budget constraint)`);
  console.log();

  // Show first 10 planned runs
  const planned = plan.runs.filter(r => r.status === 'pending').slice(0, 10);
  if (planned.length > 0) {
    console.log('Execution Order (first 10):');
    console.log('─────────────────────────────────────────────────────────────');
    for (let i = 0; i < planned.length; i++) {
      const run = planned[i];
      const promptPreview = run.prompt.slice(0, 40) + (run.prompt.length > 40 ? '...' : '');
      const overrides = run.agentModels ? ` [overrides: ${Object.keys(run.agentModels).join(',')}]` : '';
      console.log(`  ${i + 1}. ${formatCost(run.estimatedCost)} | ${run.generationModel} | ${run.iterations} iters | "${promptPreview}"${overrides}`);
    }
    if (plan.runsPlanned > 10) {
      console.log(`  ... and ${plan.runsPlanned - 10} more`);
    }
    console.log();
  }

  // Show skipped runs if any
  const skipped = plan.runs.filter(r => r.status === 'skipped').slice(0, 5);
  if (skipped.length > 0) {
    console.log('Skipped Runs (first 5):');
    console.log('─────────────────────────────────────────────────────────────');
    for (const run of skipped) {
      const promptPreview = run.prompt.slice(0, 40) + (run.prompt.length > 40 ? '...' : '');
      console.log(`  ${formatCost(run.estimatedCost)} | ${run.generationModel} | "${promptPreview}"`);
    }
    console.log();
  }
}

// ─── Database Persistence ─────────────────────────────────────────

async function createBatchRun(plan: BatchExecutionPlan): Promise<string> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('evolution_batch_runs')
    .insert({
      name: plan.config.name,
      config: plan.config,
      status: 'pending',
      total_budget_usd: plan.config.totalBudgetUsd,
      estimated_usd: plan.totalEstimatedCost,
      runs_planned: plan.runsPlanned,
      runs_skipped: plan.runsSkipped,
      execution_plan: plan.runs,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create batch run: ${error.message}`);
  }

  return data.id;
}

async function updateBatchRunStatus(
  batchId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('evolution_batch_runs')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId);

  if (error) {
    console.warn(`Failed to update batch run: ${error.message}`);
  }
}

// ─── Main Execution ───────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║           Batch Evolution Run CLI                         ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // EXP-4: Resume an interrupted/failed batch
  if (args.resumeId) {
    const supabase = getSupabaseClient();
    const { data: batch, error: fetchErr } = await supabase
      .from('evolution_batch_runs')
      .select('id, execution_plan, status, config, runs_completed, runs_failed, spent_usd')
      .eq('id', args.resumeId)
      .single();

    if (fetchErr || !batch) {
      console.error(`Batch not found: ${args.resumeId}`);
      process.exit(1);
    }

    if (batch.status === 'completed') {
      console.log('Batch already completed — nothing to resume.');
      return;
    }

    type PlanRun = { status: string; generationModel: string; iterations: number; prompt: string; runId?: string; actualCost?: number; topElo?: number };
    const execPlan = (batch.execution_plan ?? []) as PlanRun[];
    const remaining = execPlan.filter((r) => r.status === 'pending' || r.status === 'failed');
    console.log(`Resuming batch ${args.resumeId}: ${remaining.length} runs remaining out of ${execPlan.length}`);

    if (remaining.length === 0) {
      console.log('No pending/failed runs to resume.');
      return;
    }

    // Re-run the batch execution loop with the existing batch ID
    await updateBatchRunStatus(batch.id, { status: 'running' });

    let completed = batch.runs_completed ?? 0;
    let failed = batch.runs_failed ?? 0;
    let totalSpent = batch.spent_usd ?? 0;

    for (const run of remaining) {
      run.status = 'pending'; // Reset for re-execution
      try {
        const result = await executeEvolutionRun(run as never, batch.id, (batch.config as { name: string })?.name ?? 'resumed');
        run.status = 'completed';
        run.runId = result.runId;
        run.actualCost = result.actualCost;
        run.topElo = result.topElo;
        totalSpent += result.actualCost;
        completed++;
        console.log(`✓ Completed: cost=${formatCost(result.actualCost)}, reason=${result.stopReason}`);
      } catch (error) {
        run.status = 'failed';
        failed++;
        console.error(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await updateBatchRunStatus(batch.id, { runs_completed: completed, runs_failed: failed, spent_usd: totalSpent, execution_plan: execPlan });
    }

    await updateBatchRunStatus(batch.id, { status: 'completed', completed_at: new Date().toISOString(), runs_completed: completed, runs_failed: failed, spent_usd: totalSpent });
    console.log(`\nResume complete: ${completed} completed, ${failed} failed, ${formatCost(totalSpent)} spent`);
    return;
  }

  // Load and validate config
  console.log(`Loading config: ${args.configPath}`);
  const config = loadAndValidateConfig(args.configPath);
  console.log(`✓ Config validated: ${config.name}\n`);

  // Build execution plan
  console.log('Building execution plan...');
  const plan = await buildExecutionPlan(config);
  console.log('✓ Plan ready\n');

  // Display plan
  displayPlan(plan);

  if (args.dryRun) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('DRY RUN - No runs will be executed');
    console.log('Remove --dry-run and add --confirm to execute');
    console.log('═══════════════════════════════════════════════════════════\n');
    return;
  }

  if (!args.confirm) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Add --confirm to execute this batch');
    console.log('Add --dry-run to preview without confirmation prompt');
    console.log('═══════════════════════════════════════════════════════════\n');
    return;
  }

  // Create batch record
  console.log('Creating batch record...');
  const batchId = await createBatchRun(plan);
  console.log(`✓ Batch created: ${batchId}\n`);

  // Start execution
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Starting batch execution...');
  console.log('═══════════════════════════════════════════════════════════\n');

  await updateBatchRunStatus(batchId, {
    status: 'running',
    started_at: new Date().toISOString(),
  });

  let completed = 0;
  let failed = 0;
  let totalSpent = 0;
  let interrupted = false;

  // EXP-1: Handle SIGINT/SIGTERM — mark batch as interrupted and exit gracefully
  const handleSignal = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}, marking batch as interrupted...`);
    interrupted = true;
    await updateBatchRunStatus(batchId, {
      status: 'interrupted',
      completed_at: new Date().toISOString(),
      runs_completed: completed,
      runs_failed: failed,
      spent_usd: totalSpent,
      execution_plan: plan.runs,
    });
    process.exit(0);
  };
  process.on('SIGINT', () => void handleSignal('SIGINT'));
  process.on('SIGTERM', () => void handleSignal('SIGTERM'));

  const plannedRuns = plan.runs.filter(r => r.status === 'pending');

  // EXP-2: Track created run IDs for cleanup on fatal failure
  const createdRunIds: string[] = [];

  try {
    for (let i = 0; i < plannedRuns.length; i++) {
      if (interrupted) break;
      const run = plannedRuns[i];
      const progress = `[${i + 1}/${plannedRuns.length}]`;

      console.log(`${progress} Starting: ${run.generationModel} | ${run.iterations} iters | "${run.prompt.slice(0, 30)}..."`);

      try {
        const result = await executeEvolutionRun(run, batchId, plan.config.name);

        run.status = 'completed';
        run.runId = result.runId;
        run.actualCost = result.actualCost;
        run.topElo = result.topElo;
        totalSpent += result.actualCost;
        completed++;
        createdRunIds.push(result.runId);

        console.log(`${progress} ✓ Completed: cost=${formatCost(result.actualCost)}, elo=${result.topElo.toFixed(0)}, reason=${result.stopReason}`);
      } catch (error) {
        run.status = 'failed';
        failed++;
        console.error(`${progress} ✗ Failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Update batch progress
      await updateBatchRunStatus(batchId, {
        runs_completed: completed,
        runs_failed: failed,
        spent_usd: totalSpent,
        execution_plan: plan.runs,
      });
    }
  } catch (fatalError) {
    // EXP-2: Clean up on fatal (non-per-run) failure
    console.error('Fatal batch error, cleaning up...', fatalError instanceof Error ? fatalError.message : String(fatalError));
    await updateBatchRunStatus(batchId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      runs_completed: completed,
      runs_failed: failed,
      spent_usd: totalSpent,
    });
    throw fatalError;
  }

  // Mark batch complete
  await updateBatchRunStatus(batchId, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    runs_completed: completed,
    runs_failed: failed,
    spent_usd: totalSpent,
    execution_plan: plan.runs,
    results: {
      totalRuns: plannedRuns.length,
      completed,
      failed,
      totalSpent,
      avgElo: plannedRuns.filter(r => r.topElo).reduce((s, r) => s + (r.topElo ?? 0), 0) / completed || 0,
    },
  });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('Batch Complete');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Completed: ${completed}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Spent:     ${formatCost(totalSpent)}`);
  console.log(`Batch ID:  ${batchId}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
