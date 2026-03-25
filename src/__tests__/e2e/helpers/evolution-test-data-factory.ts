// Evolution-specific E2E test data factory.
// Creates and cleans up evolution runs, strategies, prompts, and variants with FK-safe ordering.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const TEST_EVO_PREFIX = '[TEST_EVO]';

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
    supabaseInstance = createClient(
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
  | 'explanation';

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

  const { data, error } = await supabase
    .from('evolution_strategies')
    .insert({
      name: options?.name ?? `${TEST_EVO_PREFIX} Strategy ${suffix}`,
      config: options?.config ?? { type: 'test', maxIterations: 2 },
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
  title?: string;
  prompt_text?: string;
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
      title: options?.title ?? `${TEST_EVO_PREFIX} Prompt ${suffix}`,
      prompt_text: options?.prompt_text ?? 'Test prompt for E2E testing',
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
  config?: Record<string, unknown>;
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
      config: options?.config ?? { test: true },
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
  iteration?: number;
  content?: string;
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
      iteration: options.iteration ?? 1,
      content: options.content ?? `${TEST_EVO_PREFIX} Variant content ${suffix}`,
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
  strategyId?: string;
  config?: Record<string, unknown>;
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
      strategy_id: options.strategyId,
      config: options.config ?? { test: true },
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
