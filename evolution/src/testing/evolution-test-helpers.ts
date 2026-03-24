// Reusable helpers for evolution pipeline integration tests.
// Provides NOOP_SPAN, DB cleanup, test data factories, mock LLM client, and mock logger.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CostTracker, EvolutionLLMClient, EvolutionLogger, ExecutionContext, SerializedPipelineState } from '@evolution/lib/types';

// ─── NOOP_SPAN ──────────────────────────────────────────────────
// Mirrors the noopSpan in instrumentation.ts for use in mocked instrumentation modules.

const NOOP_SPAN_INNER: Record<string, unknown> = {};

export const NOOP_SPAN: Record<string, unknown> = {
  spanContext: () => ({ traceId: '0', spanId: '0', traceFlags: 0 }),
  setAttribute: () => NOOP_SPAN_INNER,
  setAttributes: () => NOOP_SPAN_INNER,
  addEvent: () => NOOP_SPAN_INNER,
  addLink: () => NOOP_SPAN_INNER,
  addLinks: () => NOOP_SPAN_INNER,
  setStatus: () => NOOP_SPAN_INNER,
  updateName: () => NOOP_SPAN_INNER,
  end: () => {},
  isRecording: () => false,
  recordException: () => {},
};

// ─── Valid variant text ─────────────────────────────────────────
// ~300 char markdown that passes validateFormat() (has H1, section headings, paragraph prose).

export const VALID_VARIANT_TEXT = `# Understanding Evolution Testing

## Overview

This is a test variant created by the evolution pipeline. It demonstrates proper formatting with section headings and paragraph structure. The content validates correctly against format rules.

## Key Concepts

The evolution pipeline generates variants through multiple strategies. Each variant competes in pairwise comparisons to establish Elo ratings. Higher-rated variants advance through subsequent iterations.`;

// ─── Table existence check ──────────────────────────────────────

/**
 * Check if evolution tables exist in the DB.
 * Returns true if evolution_runs table is queryable.
 * Used to skip entire test suites when migrations haven't been applied.
 */
export async function evolutionTablesExist(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase
    .from('evolution_runs')
    .select('id')
    .limit(1);

  // error code 42P01 = "relation does not exist"
  if (error && (error.code === '42P01' || error.message?.includes('does not exist'))) {
    return false;
  }
  return true;
}

// ─── Cleanup helper ─────────────────────────────────────────────

/** Options for cleanupEvolutionData(). All fields optional — only provided IDs are cleaned up. */
export interface CleanupOptions {
  explanationIds?: number[];
  runIds?: string[];
  strategyIds?: string[];
  promptIds?: string[];
}

/**
 * Delete evolution test data in FK-safe order.
 * Silently ignores errors so tests always complete cleanup.
 */
export async function cleanupEvolutionData(
  supabase: SupabaseClient,
  options: CleanupOptions,
): Promise<void> {
  const { explanationIds = [], runIds: extraRunIds = [], strategyIds = [], promptIds = [] } = options;
  const hasIds = explanationIds.length > 0 || extraRunIds.length > 0 || strategyIds.length > 0 || promptIds.length > 0;
  if (!hasIds) return;

  try {
    // Collect run IDs from explicit + explanation-derived
    const runIds: string[] = [...extraRunIds];
    if (explanationIds.length > 0) {
      const { data: runs } = await supabase
        .from('evolution_runs')
        .select('id')
        .in('explanation_id', explanationIds);
      runIds.push(...(runs ?? []).map((r) => r.id));
    }

    if (runIds.length > 0) {
      // Delete in FK-safe order: leaf tables first
      await supabase.from('evolution_arena_comparisons').delete().in('run_id', runIds);
      await supabase.from('evolution_logs').delete().in('run_id', runIds);
      await supabase.from('evolution_agent_invocations').delete().in('run_id', runIds);
      await supabase.from('evolution_variants').delete().in('run_id', runIds);
      await supabase.from('evolution_runs').delete().in('id', runIds);
    }

    // Delete strategies (after runs that reference them)
    if (strategyIds.length > 0) {
      await supabase.from('evolution_strategies').delete().in('id', strategyIds);
    }

    // Delete prompts (after runs that reference them)
    if (promptIds.length > 0) {
      await supabase.from('evolution_prompts').delete().in('id', promptIds);
    }
  } catch (error) {
    // Don't throw on cleanup failure — log only
    console.warn('cleanupEvolutionData partial failure:', error);
  }
}

// ─── Test data factories ────────────────────────────────────────

/**
 * Insert a test evolution_strategies row and return its UUID.
 * Uses a unique hash per call to avoid unique-constraint collisions.
 */
export async function createTestStrategyConfig(
  supabase: SupabaseClient,
): Promise<string> {
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await supabase
    .from('evolution_strategies')
    .insert({
      config_hash: `test_hash_${uniqueSuffix}`,
      name: `[TEST] strategy_${uniqueSuffix}`,
      label: '[TEST] Strategy',
      config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 1 },
    })
    .select('id')
    .single();

  if (error) throw new Error(`createTestStrategyConfig failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return data.id;
}

/**
 * Insert a test evolution_prompts row and return its UUID.
 * Satisfies the NOT NULL prompt_id FK on evolution_runs.
 */
export async function createTestPrompt(
  supabase: SupabaseClient,
): Promise<string> {
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await supabase
    .from('evolution_prompts')
    .insert({
      prompt: `[TEST] prompt_${uniqueSuffix}`,
      title: `[TEST] Prompt ${uniqueSuffix}`,
    })
    .select('id')
    .single();

  if (error) throw new Error(`createTestPrompt failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return data.id;
}

/**
 * Insert a test evolution_explanations row and return its UUID.
 * Auto-infers source from whether explanationId is provided.
 * Returns null if the table doesn't exist yet (pre-migration).
 */
export async function createTestEvolutionExplanation(
  _supabase: SupabaseClient,
  _opts: { explanationId?: number; promptId?: string; title?: string; content?: string } = {},
): Promise<string> {
  // V2: evolution_explanations table dropped
  return undefined as unknown as string;
}

/**
 * Insert a test evolution run and return the full row.
 * Auto-creates a strategy_config, prompt, and evolution_explanation if not provided.
 * Auto-creates a strategy_config and prompt if not provided.
 */
export async function createTestEvolutionRun(
  supabase: SupabaseClient,
  explanationId: number | null,
  overrides?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const strategyConfigId = overrides?.strategy_id ?? await createTestStrategyConfig(supabase);
  const promptId = overrides?.prompt_id ?? await createTestPrompt(supabase);

  const row: Record<string, unknown> = {
    explanation_id: explanationId,
    status: 'pending',
    budget_cap_usd: 5.0,
    strategy_id: strategyConfigId,
    prompt_id: promptId,
    ...overrides,
  };

  const { data, error } = await supabase
    .from('evolution_runs')
    .insert(row)
    .select()
    .single();

  if (error) throw new Error(`createTestEvolutionRun failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return data;
}

/**
 * Insert a test variant and return the full row.
 */
export async function createTestVariant(
  supabase: SupabaseClient,
  runId: string,
  explanationId: number | null,
  overrides?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const row = {
    run_id: runId,
    explanation_id: explanationId,
    variant_content: VALID_VARIANT_TEXT,
    elo_score: 1200,
    generation: 1,
    agent_name: 'test',
    match_count: 0,
    ...overrides,
  };

  const { data, error } = await supabase
    .from('evolution_variants')
    .insert(row)
    .select()
    .single();

  if (error) throw new Error(`createTestVariant failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return data;
}

// ─── Mock LLM client ────────────────────────────────────────────

/**
 * Create a mock EvolutionLLMClient that returns format-valid markdown and structured results.
 */
export function createMockEvolutionLLMClient(
  overrides?: Partial<EvolutionLLMClient>,
): EvolutionLLMClient {
  return {
    complete: jest.fn().mockResolvedValue(VALID_VARIANT_TEXT),
    completeStructured: jest.fn().mockResolvedValue({ winner: 'A', confidence: 0.9 }),
    ...overrides,
  };
}

// ─── Mock logger ────────────────────────────────────────────────

/**
 * Create a mock EvolutionLogger with jest.fn() for all 4 methods.
 */
export function createMockEvolutionLogger(): EvolutionLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

/**
 * Create a mock EntityLogger with call-capturing for test assertions.
 * Tracks all log calls with level, message, and context.
 */
export function createMockEntityLogger() {
  const calls: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];
  const logger: import('@evolution/lib/pipeline/infra/createEntityLogger').EntityLogger = {
    info: jest.fn((msg: string, ctx?: Record<string, unknown>) => calls.push({ level: 'info', message: msg, context: ctx })),
    warn: jest.fn((msg: string, ctx?: Record<string, unknown>) => calls.push({ level: 'warn', message: msg, context: ctx })),
    error: jest.fn((msg: string, ctx?: Record<string, unknown>) => calls.push({ level: 'error', message: msg, context: ctx })),
    debug: jest.fn((msg: string, ctx?: Record<string, unknown>) => calls.push({ level: 'debug', message: msg, context: ctx })),
  };
  return { logger, calls };
}

// ─── Checkpoint factory ─────────────────────────────────────────

/** Stub: evolution_checkpoints table dropped in V2. */
export async function createTestCheckpoint(
  _supabase: SupabaseClient,
  _runId: string,
  _iteration: number,
  _lastAgent: string,
  _snapshotOverrides: Partial<SerializedPipelineState> = {},
): Promise<string> {
  // V2: evolution_checkpoints table dropped
  return undefined as unknown as string;
}

// ─── LLM call tracking factory ──────────────────────────────────

/** Creates a test llmCallTracking row for cost testing. */
export async function createTestLLMCallTracking(
  supabase: SupabaseClient,
  callSource: string,
  estimatedCostUsd: number,
  createdAt: string = new Date().toISOString(),
): Promise<void> {
  const { error } = await supabase
    .from('llmCallTracking')
    .insert({
      call_source: callSource,
      estimated_cost_usd: estimatedCostUsd,
      created_at: createdAt,
      userid: '00000000-0000-4000-8000-000000000099',
      prompt: '[test] evolution cost tracking',
      content: '[test] response content',
      raw_api_response: '{}',
      model: 'gpt-4o-mini',
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      finish_reason: 'stop',
    });

  if (error) throw error;
}

// ─── Agent invocation factory ────────────────────────────────────

/** Creates a test evolution_agent_invocations row for cost testing. */
export async function createTestAgentInvocation(
  supabase: SupabaseClient,
  runId: string,
  iteration: number,
  agentName: string,
  opts: { costUsd?: number; executionOrder?: number; success?: boolean; skipped?: boolean } = {},
): Promise<void> {
  const { error } = await supabase
    .from('evolution_agent_invocations')
    .insert({
      run_id: runId,
      iteration,
      agent_name: agentName,
      execution_order: opts.executionOrder ?? 0,
      success: opts.success ?? true,
      cost_usd: opts.costUsd ?? 0,
      skipped: opts.skipped ?? false,
      execution_detail: {},
    });

  if (error) throw error;
}

// ─── Mock CostTracker ────────────────────────────────────────────

/**
 * Create a mock CostTracker with jest.fn() for all methods.
 * Tracks per-agent costs in an internal Map for realistic behavior.
 */
export function createMockCostTracker(): CostTracker {
  const agentCosts = new Map<string, number>();
  const invocationCosts = new Map<string, number>();
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn((name: string, cost: number, invocationId?: string) => {
      agentCosts.set(name, (agentCosts.get(name) ?? 0) + cost);
      if (invocationId) {
        invocationCosts.set(invocationId, (invocationCosts.get(invocationId) ?? 0) + cost);
      }
    }),
    getAgentCost: jest.fn((name: string) => agentCosts.get(name) ?? 0),
    getTotalSpent: jest.fn().mockReturnValue(0),
    getAvailableBudget: jest.fn().mockReturnValue(5),
    getAllAgentCosts: jest.fn(() => Object.fromEntries(agentCosts)),
    getTotalReserved: jest.fn().mockReturnValue(0),
    getInvocationCost: jest.fn((id: string) => invocationCosts.get(id) ?? 0),
    releaseReservation: jest.fn(),
    setEventLogger: jest.fn(),
    isOverflowed: false,
  };
}

// ─── Mock ExecutionContext ───────────────────────────────────────

/**
 * Create a mock ExecutionContext with default state, LLM client, logger, and cost tracker.
 * Pass overrides to customize any field.
 */
export function createMockExecutionContext(
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  const state = overrides.state ?? { originalText: '# Original Article\n\n## Intro\n\nOriginal text here. With some content.', pool: [], poolIds: new Set(), iteration: 0, newEntrantsThisIteration: [], ratings: new Map(), matchCounts: new Map(), matchHistory: [], dimensionScores: null, allCritiques: [], diversityScore: 0, metaFeedback: null, lastSyncedMatchIndex: 0, getTopByRating: () => [], getVariationById: () => undefined, getPoolSize: () => 0, hasVariant: () => false } as unknown as import('@evolution/lib/types').ReadonlyPipelineState;
  return {
    payload: overrides.payload ?? {
      originalText: state.originalText,
      title: 'Test Article',
      explanationId: 1,
      runId: 'test-run-1',
      config: {
        iterations: 50,
        budgetUsd: 5.00,
        judgeModel: 'gpt-4.1-nano',
        generationModel: 'gpt-4.1-mini',
      },
    },
    state,
    llmClient: overrides.llmClient ?? createMockEvolutionLLMClient(),
    logger: overrides.logger ?? createMockEvolutionLogger(),
    costTracker: overrides.costTracker ?? createMockCostTracker(),
    runId: overrides.runId ?? 'test-run-1',
    ...overrides,
  };
}

// ─── Dual-column sync assertion ─────────────────────────────────

/**
 * Verify that evolution_explanations.explanation_id matches evolution_runs.explanation_id
 * for all explanation-based runs. Catches divergence between old and new columns.
 */
export async function assertEvolutionExplanationSync(
  _supabase: SupabaseClient,
  _runIds: string[],
): Promise<void> {
  // V2: evolution_explanations table dropped
  return;
}
