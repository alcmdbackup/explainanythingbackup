// Evolution-specific E2E test data factory.
// Creates and cleans up evolution runs, strategies, prompts, and variants with FK-safe ordering.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import * as fs from 'fs';

const TEST_EVO_PREFIX = '[TEST_EVO]';

// eslint-disable-next-line flakiness/no-hardcoded-tmpdir -- base path combined with worker-specific suffix below
const TRACKED_IDS_BASE = '/tmp/e2e-tracked-evolution-ids';

function getTrackedIdsFile(): string {
  const workerIndex = process.env.TEST_PARALLEL_INDEX ?? '0';
  return `${TRACKED_IDS_BASE}-worker-${workerIndex}.txt`;
}

let supabaseInstance: SupabaseClient | null = null;

/**
 * Gets or creates a Supabase client using service role key.
 * Cached for reuse across evolution test data operations.
 */
export function getEvolutionServiceClient(): SupabaseClient {
  if (!supabaseInstance) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for evolution test data factory');
    }
    supabaseInstance = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return supabaseInstance;
}

function generateTestSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ============================================================================
// Tracking system for defense-in-depth cleanup
// ============================================================================

type EvolutionEntityType =
  | 'strategy'
  | 'prompt'
  | 'run'
  | 'variant'
  | 'experiment'
  | 'log'
  | 'invocation'
  | 'comparison'
  | 'explanation'
  | 'metric';

/**
 * Registers an evolution entity ID for cleanup.
 * IDs are persisted to a per-worker temp file so global-teardown can clean them.
 */
export function trackEvolutionId(type: EvolutionEntityType, id: string): void {
  try {
    fs.appendFileSync(getTrackedIdsFile(), `${type}:${id}\n`);
  } catch (err) {
    console.warn(
      `[evolution-test-data-factory] Failed to track ${type} ID ${id}:`,
      err instanceof Error ? err.message : err
    );
  }
}

// ============================================================================
// Factory functions
// ============================================================================

export interface CreateTestStrategyOptions {
  name?: string;
  config?: Record<string, unknown>;
}

export interface TestStrategy {
  id: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test evolution strategy.
 * Auto-tracked for defense-in-depth cleanup.
 */
export async function createTestStrategy(
  options?: CreateTestStrategyOptions
): Promise<TestStrategy> {
  const supabase = getEvolutionServiceClient();
  const suffix = generateTestSuffix();

  // config_hash has a not-null constraint; use a random hex since this row is synthetic
  // and intentionally will not collide with the deterministic hash of any real strategy.
  const configHash = Math.random().toString(16).slice(2, 14).padEnd(12, '0');
  const { data, error } = await supabase
    .from('evolution_strategies')
    .insert({
      name: options?.name ?? `${TEST_EVO_PREFIX} Strategy ${suffix}`,
      config: options?.config ?? { type: 'test', maxIterations: 2 },
      config_hash: configHash,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create test strategy: ${error.message}`);
  }

  trackEvolutionId('strategy', data.id);

  return {
    id: data.id,
    cleanup: async () => {
      await supabase.from('evolution_strategies').delete().eq('id', data.id);
    },
  };
}

export interface CreateTestPromptOptions {
  name?: string;
  prompt?: string;
}

export interface TestPrompt {
  id: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test evolution prompt.
 * Auto-tracked for defense-in-depth cleanup.
 */
export async function createTestPrompt(options?: CreateTestPromptOptions): Promise<TestPrompt> {
  const supabase = getEvolutionServiceClient();
  const suffix = generateTestSuffix();

  const { data, error } = await supabase
    .from('evolution_prompts')
    .insert({
      name: options?.name ?? `${TEST_EVO_PREFIX} Prompt ${suffix}`,
      prompt: options?.prompt ?? 'Test prompt for E2E testing',
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create test prompt: ${error.message}`);
  }

  trackEvolutionId('prompt', data.id);

  return {
    id: data.id,
    cleanup: async () => {
      await supabase.from('evolution_prompts').delete().eq('id', data.id);
    },
  };
}

export interface CreateTestRunOptions {
  strategyId?: string;
  promptId?: string;
  status?: string;
}

export interface TestRun {
  id: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test evolution run.
 * Auto-creates a strategy and prompt if not provided.
 * Auto-tracked for defense-in-depth cleanup.
 */
export async function createTestRun(options?: CreateTestRunOptions): Promise<TestRun> {
  const supabase = getEvolutionServiceClient();

  // Auto-create dependencies if not provided
  const strategyId = options?.strategyId ?? (await createTestStrategy()).id;
  const promptId = options?.promptId ?? (await createTestPrompt()).id;

  const { data, error } = await supabase
    .from('evolution_runs')
    .insert({
      strategy_id: strategyId,
      prompt_id: promptId,
      status: options?.status ?? 'pending',
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create test run: ${error.message}`);
  }

  trackEvolutionId('run', data.id);

  return {
    id: data.id,
    cleanup: async () => {
      await supabase.from('evolution_runs').delete().eq('id', data.id);
    },
  };
}

export interface CreateTestVariantOptions {
  runId: string;
  promptId?: string;
  generation?: number;
  variant_content?: string;
}

export interface TestVariant {
  id: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test evolution variant.
 * Auto-tracked for defense-in-depth cleanup.
 */
export async function createTestVariant(options: CreateTestVariantOptions): Promise<TestVariant> {
  const supabase = getEvolutionServiceClient();
  const suffix = generateTestSuffix();

  const { data, error } = await supabase
    .from('evolution_variants')
    .insert({
      run_id: options.runId,
      prompt_id: options.promptId,
      generation: options.generation ?? 1,
      variant_content: options.variant_content ?? `${TEST_EVO_PREFIX} Variant content ${suffix}`,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create test variant: ${error.message}`);
  }

  trackEvolutionId('variant', data.id);

  return {
    id: data.id,
    cleanup: async () => {
      await supabase.from('evolution_variants').delete().eq('id', data.id);
    },
  };
}

export interface CreateTestExperimentOptions {
  name?: string;
  promptId?: string;
}

export interface TestExperiment {
  id: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test evolution experiment.
 * Auto-tracked for defense-in-depth cleanup.
 */
export async function createTestExperiment(
  options: CreateTestExperimentOptions
): Promise<TestExperiment> {
  const supabase = getEvolutionServiceClient();
  const suffix = generateTestSuffix();

  const { data, error } = await supabase
    .from('evolution_experiments')
    .insert({
      name: options.name ?? `${TEST_EVO_PREFIX} Experiment ${suffix}`,
      prompt_id: options.promptId,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create test experiment: ${error.message}`);
  }

  trackEvolutionId('experiment', data.id);

  return {
    id: data.id,
    cleanup: async () => {
      await supabase.from('evolution_experiments').delete().eq('id', data.id);
    },
  };
}

export interface CreateTestEvolutionLogOptions {
  entityType?: string;
  entityId?: string;
  runId?: string;
  level?: string;
  message?: string;
  agentName?: string;
  iteration?: number;
}

export interface TestEvolutionLog {
  id: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test evolution log entry.
 * Auto-tracked for defense-in-depth cleanup.
 */
export async function createTestEvolutionLog(
  options?: CreateTestEvolutionLogOptions
): Promise<TestEvolutionLog> {
  const supabase = getEvolutionServiceClient();
  const suffix = generateTestSuffix();

  const { data, error } = await supabase
    .from('evolution_logs')
    .insert({
      entity_type: options?.entityType ?? 'run',
      entity_id: options?.entityId ?? '00000000-0000-4000-8000-000000000000',
      run_id: options?.runId ?? null,
      level: options?.level ?? 'info',
      message: options?.message ?? `${TEST_EVO_PREFIX} Log entry ${suffix}`,
      agent_name: options?.agentName ?? 'test',
      iteration: options?.iteration ?? 0,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create test evolution log: ${error.message}`);
  }

  trackEvolutionId('log', data.id);

  return {
    id: data.id,
    cleanup: async () => {
      await supabase.from('evolution_logs').delete().eq('id', data.id);
    },
  };
}

export interface CreateTestArenaComparisonOptions {
  promptId: string;
  entryA: string;
  entryB: string;
  winner?: string;
  confidence?: number;
  runId?: string;
}

export interface TestArenaComparison {
  id: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test arena comparison record.
 * Auto-tracked for defense-in-depth cleanup.
 */
export async function createTestArenaComparison(
  options: CreateTestArenaComparisonOptions
): Promise<TestArenaComparison> {
  const supabase = getEvolutionServiceClient();

  const { data, error } = await supabase
    .from('evolution_arena_comparisons')
    .insert({
      prompt_id: options.promptId,
      entry_a: options.entryA,
      entry_b: options.entryB,
      winner: options.winner ?? options.entryA,
      confidence: options.confidence ?? 0.9,
      run_id: options.runId ?? null,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create test arena comparison: ${error.message}`);
  }

  trackEvolutionId('comparison', data.id);

  return {
    id: data.id,
    cleanup: async () => {
      await supabase.from('evolution_arena_comparisons').delete().eq('id', data.id);
    },
  };
}

// ============================================================================
// Bulk cleanup (defense-in-depth, used by global-teardown)
// ============================================================================

/** FK-safe deletion order for evolution tables */
const FK_SAFE_DELETION_ORDER: { type: EvolutionEntityType; table: string }[] = [
  { type: 'comparison', table: 'evolution_arena_comparisons' },
  { type: 'invocation', table: 'evolution_agent_invocations' },
  { type: 'log', table: 'evolution_logs' },
  { type: 'metric', table: 'evolution_metrics' },
  { type: 'variant', table: 'evolution_variants' },
  { type: 'explanation', table: 'evolution_explanations' },
  { type: 'run', table: 'evolution_runs' },
  { type: 'experiment', table: 'evolution_experiments' },
  { type: 'strategy', table: 'evolution_strategies' },
  { type: 'prompt', table: 'evolution_prompts' },
];

/**
 * Reads all per-worker tracking files and deletes tracked evolution entities in FK-safe order.
 * Returns the total number of records cleaned.
 */
export async function cleanupAllTrackedEvolutionData(): Promise<number> {
  // Collect all tracked IDs grouped by type
  const idsByType = new Map<EvolutionEntityType, Set<string>>();

  try {
    const prefix = 'e2e-tracked-evolution-ids-worker-';
    const files = fs.readdirSync('/tmp').filter((f) => f.startsWith(prefix) && f.endsWith('.txt'));

    for (const file of files) {
      // eslint-disable-next-line flakiness/no-hardcoded-tmpdir -- path derived from worker-specific tracking file
      const content = fs.readFileSync(`/tmp/${file}`, 'utf-8');
      for (const line of content.split('\n').filter(Boolean)) {
        const [type, id] = line.split(':') as [EvolutionEntityType, string];
        if (type && id) {
          if (!idsByType.has(type)) {
            idsByType.set(type, new Set());
          }
          idsByType.get(type)!.add(id);
        }
      }
    }
  } catch (err) {
    console.warn(
      '[evolution-test-data-factory] Failed to read tracked IDs:',
      err instanceof Error ? err.message : err
    );
    return 0;
  }

  if (idsByType.size === 0) {
    return 0;
  }

  const supabase = getEvolutionServiceClient();
  let totalCleaned = 0;

  // Delete in FK-safe order
  for (const { type, table } of FK_SAFE_DELETION_ORDER) {
    const ids = idsByType.get(type);
    if (!ids || ids.size === 0) continue;

    try {
      const idArray = Array.from(ids);
      const { data, error } = await supabase.from(table).delete().in('id', idArray).select('id');

      if (error) {
        console.warn(
          `[evolution-test-data-factory] Failed to clean ${table}:`,
          error.message
        );
      } else {
        totalCleaned += data?.length ?? 0;
      }
    } catch (err) {
      console.warn(
        `[evolution-test-data-factory] Error cleaning ${table}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Clear tracking files
  try {
    const prefix = 'e2e-tracked-evolution-ids-worker-';
    const files = fs.readdirSync('/tmp').filter((f) => f.startsWith(prefix) && f.endsWith('.txt'));
    for (const file of files) {
      // eslint-disable-next-line flakiness/no-hardcoded-tmpdir -- path derived from worker-specific tracking file
      fs.unlinkSync(`/tmp/${file}`);
    }
  } catch (err) {
    console.warn(
      '[evolution-test-data-factory] Failed to clear tracking files:',
      err instanceof Error ? err.message : err
    );
  }

  return totalCleaned;
}

// ============================================================================
// Phase 5: Multi-hop run fixture for lineage + attribution E2E specs
// ============================================================================

export interface MultiHopFixture {
  runId: string;
  promptId: string;
  strategyId: string;
  /** Variants in chain order: [seed, v1, v2, leaf]. */
  variantIds: string[];
  /** Invocation IDs matching the generation of v1, v2, leaf respectively. */
  invocationIds: string[];
  /** Invocation that produced the leaf variant — used for invocation-detail spec. */
  leafInvocationId: string;
  cleanup: () => Promise<void>;
}

interface CreateMultiHopFixtureOptions {
  /** Override the default generation strategy (defaults to lexical_simplify). */
  strategy?: string;
  /** Insert llmCallTracking rows linked to the leaf invocation for the Raw-LLM section spec. */
  seedLlmCallTracking?: boolean;
  /** Insert eloAttrDelta + eloAttrDeltaHist metric rows on the run entity so the
   *  strategy-effectiveness-chart + histogram render without needing computeRunMetrics. */
  seedAttributionMetrics?: boolean;
}

/**
 * Seeds a 4-node lineage chain (seed → v1 → v2 → leaf) with matching agent invocations
 * and optional llmCallTracking rows. Used by Phase 4/5/6 E2E specs:
 * variantLineageTab, strategyEffectivenessChart, variantParentBadge, invocationDetailPrevious.
 *
 * Variant ELOs are chosen so that: seed=1200, v1=1240, v2=1270, leaf=1310 — each hop
 * yields a positive delta so attribution metrics have non-trivial values.
 */
export async function createMultiHopFixture(
  options: CreateMultiHopFixtureOptions = {},
): Promise<MultiHopFixture> {
  const supabase = getEvolutionServiceClient();
  const strategy = options.strategy ?? 'lexical_simplify';
  const suffix = generateTestSuffix();

  // 1. Prompt + strategy + run.
  // Unique prompt text per fixture — avoids uq_arena_topic_prompt collisions when
  // multiple specs run createMultiHopFixture in parallel.
  const prompt = await createTestPrompt({ prompt: `[TEST_EVO] multi-hop fixture prompt ${suffix}` });
  const strategyRow = await createTestStrategy();
  const run = await createTestRun({ promptId: prompt.id, strategyId: strategyRow.id });

  // 2. Variants chain. seed has no parent; v1/v2/leaf link up.
  const elos = [1200, 1240, 1270, 1310];
  const mus = [0, 3, 6, 9]; // OpenSkill mu; maps to elo via dbToRating — arbitrary but increasing.
  const sigmas = [5, 30, 25, 20];
  const names = [`[TEST_EVO] seed ${suffix}`, `[TEST_EVO] v1 ${suffix}`,
                 `[TEST_EVO] v2 ${suffix}`, `[TEST_EVO] leaf ${suffix}`];
  const variantIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const parent = i === 0 ? null : variantIds[i - 1];
    const { data, error } = await supabase
      .from('evolution_variants')
      .insert({
        run_id: run.id,
        prompt_id: prompt.id,
        parent_variant_id: parent,
        generation: i,
        variant_content: `${names[i]} content — iteration ${i}`,
        elo_score: elos[i],
        mu: mus[i],
        sigma: sigmas[i],
        agent_name: i === 0 ? 'seed_variant' : strategy,
        persisted: true,
      })
      .select('id')
      .single();
    if (error) throw new Error(`multi-hop variant[${i}] insert failed: ${error.message}`);
    variantIds.push(data.id);
    trackEvolutionId('variant', data.id);
  }

  // 3. Invocations for the 3 non-seed variants.
  const invocationIds: string[] = [];
  for (let i = 1; i < 4; i++) {
    const { data, error } = await supabase
      .from('evolution_agent_invocations')
      .insert({
        run_id: run.id,
        agent_name: 'generate_from_previous_article',
        iteration: i,
        execution_order: i,
        success: true,
        cost_usd: 0.02,
        duration_ms: 4000,
        execution_detail: {
          detailType: 'generate_from_previous_article',
          strategy,
          variantId: variantIds[i],
          generation: { cost: 0.015, promptLength: 400, textLength: 600, formatValid: true, durationMs: 2500 },
          ranking: { cost: 0.005, localPoolSize: i, initialTop15Cutoff: 0,
                     totalComparisons: 2, stopReason: 'converged',
                     finalLocalElo: elos[i]!, finalLocalUncertainty: sigmas[i]!,
                     finalLocalTop15Cutoff: elos[i]! - 40, durationMs: 1500, comparisons: [] },
          surfaced: true,
          totalCost: 0.02,
        },
      })
      .select('id')
      .single();
    if (error) throw new Error(`multi-hop invocation[${i}] insert failed: ${error.message}`);
    invocationIds.push(data.id);
    trackEvolutionId('invocation', data.id);

    // Link the variant back to its producing invocation.
    await supabase
      .from('evolution_variants')
      .update({ agent_invocation_id: data.id })
      .eq('id', variantIds[i]);
  }

  const leafInvocationId = invocationIds[invocationIds.length - 1]!;

  // 4. Optional: seed eloAttrDelta:* + eloAttrDeltaHist:* metric rows on the run entity.
  if (options.seedAttributionMetrics) {
    const metricKey = `generate_from_previous_article:${strategy}`;
    const rows = [
      {
        entity_type: 'run', entity_id: run.id,
        metric_name: `eloAttrDelta:${metricKey}`,
        value: 36.67, sigma: 10, ci_lower: 15.7, ci_upper: 57.6, n: 3,
        origin_entity_type: 'invocation', source: 'at_finalization',
      },
      {
        entity_type: 'run', entity_id: run.id,
        metric_name: `eloAttrDeltaHist:${metricKey}:30:40`,
        value: 0.67, n: 2, source: 'at_finalization',
      },
      {
        entity_type: 'run', entity_id: run.id,
        metric_name: `eloAttrDeltaHist:${metricKey}:40:gtmax`,
        value: 0.33, n: 1, source: 'at_finalization',
      },
    ];
    const { error } = await supabase.from('evolution_metrics').insert(rows);
    if (error) {
      console.warn('[createMultiHopFixture] attribution metric insert failed:', error.message);
    }
  }

  // 5. Optional: llmCallTracking rows for the leaf invocation (Raw-LLM section spec).
  if (options.seedLlmCallTracking) {
    const { error } = await supabase.from('llmCallTracking').insert({
      evolution_invocation_id: leafInvocationId,
      call_source: 'generation',
      prompt: '[TEST_EVO] Rewrite this article to be simpler. Original text: ...',
      content: '[TEST_EVO] Simplified article text for the leaf variant.',
      raw_api_response: '{"model":"gpt-4.1-mini","usage":{"prompt_tokens":120,"completion_tokens":80}}',
      model: 'gpt-4.1-mini',
      prompt_tokens: 120,
      completion_tokens: 80,
      total_tokens: 200,
      userid: '00000000-0000-0000-0000-000000000000',
    });
    if (error) {
      console.warn('[createMultiHopFixture] llmCallTracking insert failed (non-fatal):', error.message);
    }
  }

  return {
    runId: run.id,
    promptId: prompt.id,
    strategyId: strategyRow.id,
    variantIds,
    invocationIds,
    leafInvocationId,
    cleanup: async () => {
      // Cleanup is handled automatically by trackEvolutionId — each entity is registered
      // and swept by global-teardown. This explicit cleanup is a defensive fallback.
      await supabase.from('llmCallTracking').delete().eq('evolution_invocation_id', leafInvocationId);
      await supabase.from('evolution_agent_invocations').delete().in('id', invocationIds);
      await supabase.from('evolution_variants').delete().in('id', variantIds);
      await run.cleanup();
      await strategyRow.cleanup();
      await prompt.cleanup();
    },
  };
}
