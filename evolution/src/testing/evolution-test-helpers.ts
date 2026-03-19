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

/**
 * Delete evolution test data in FK-safe order.
 * Silently ignores errors so tests always complete cleanup.
 */
export async function cleanupEvolutionData(
  supabase: SupabaseClient,
  explanationIds: number[],
  extraRunIds?: string[],
): Promise<void> {
  if (explanationIds.length === 0 && (!extraRunIds || extraRunIds.length === 0)) return;

  try {
    // Get run IDs for these explanations
    const runIds: string[] = [...(extraRunIds ?? [])];
    if (explanationIds.length > 0) {
      const { data: runs } = await supabase
        .from('evolution_runs')
        .select('id')
        .in('explanation_id', explanationIds);
      runIds.push(...(runs ?? []).map((r) => r.id));
    }

    // Collect evolution_explanation_ids before deleting runs (if table exists)
    let evoExplIds: string[] = [];
    if (runIds.length > 0 && await evolutionExplanationsTableExists(supabase)) {
      const { data: evoExpls } = await supabase
        .from('evolution_runs')
        .select('evolution_explanation_id')
        .in('id', runIds);
      evoExplIds = (evoExpls ?? [])
        .map((r) => r.evolution_explanation_id as string)
        .filter(Boolean);
    }

    if (runIds.length > 0) {
      // Delete in FK-safe order: children first
      await supabase.from('evolution_agent_invocations').delete().in('run_id', runIds);
      await supabase.from('evolution_checkpoints').delete().in('run_id', runIds);
      await supabase.from('evolution_variants').delete().in('run_id', runIds);
    }

    // Delete runs (parent of variants/checkpoints).
    // NOTE: strategy_configs and evolution_arena_topics are NOT deleted here because
    // they may be shared fixtures across multiple tests. Callers should clean them
    // up explicitly in afterAll when appropriate.
    if (runIds.length > 0) {
      await supabase.from('evolution_runs').delete().in('id', runIds);
    }

    // Delete evolution_explanations after runs (runs reference them via FK)
    if (evoExplIds.length > 0) {
      await supabase.from('evolution_explanations').delete().in('id', evoExplIds);
    }
  } catch (error) {
    // Don't throw on cleanup failure — log only
    console.warn('cleanupEvolutionData partial failure:', error);
  }
}

// ─── Test data factories ────────────────────────────────────────

/**
 * Insert a test strategy_configs row and return its UUID.
 * Uses a unique hash per call to avoid unique-constraint collisions.
 */
export async function createTestStrategyConfig(
  supabase: SupabaseClient,
): Promise<string> {
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await supabase
    .from('evolution_strategy_configs')
    .insert({
      config_hash: `test_hash_${uniqueSuffix}`,
      name: `test_strategy_${uniqueSuffix}`,
      label: 'Test strategy',
      config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 1 },
    })
    .select('id')
    .single();

  if (error) throw new Error(`createTestStrategyConfig failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return data.id;
}

/**
 * Insert a test evolution_arena_topics row and return its UUID.
 * Satisfies the NOT NULL prompt_id FK on evolution_runs.
 */
export async function createTestPrompt(
  supabase: SupabaseClient,
): Promise<string> {
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await supabase
    .from('evolution_arena_topics')
    .insert({
      prompt: `test_prompt_${uniqueSuffix}`,
      title: `Test Prompt ${uniqueSuffix}`,
    })
    .select('id')
    .single();

  if (error) throw new Error(`createTestPrompt failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return data.id;
}

/**
 * Check if the evolution_explanations table exists in the DB.
 * Caches result per-process to avoid repeated queries.
 */
let _evoExplTableExists: boolean | null = null;

/** Reset the cached table-existence check. Call in beforeAll/beforeEach for integration tests. */
export function resetEvoExplTableCache(): void {
  _evoExplTableExists = null;
}

async function evolutionExplanationsTableExists(supabase: SupabaseClient): Promise<boolean> {
  if (_evoExplTableExists !== null) return _evoExplTableExists;
  const { error } = await supabase.from('evolution_explanations').select('id').limit(1);
  _evoExplTableExists = !(error && (error.code === '42P01' || error.message?.includes('does not exist')));
  return _evoExplTableExists;
}

/**
 * Insert a test evolution_explanations row and return its UUID.
 * Auto-infers source from whether explanationId is provided.
 * Returns null if the table doesn't exist yet (pre-migration).
 */
export async function createTestEvolutionExplanation(
  supabase: SupabaseClient,
  opts: { explanationId?: number; promptId?: string; title?: string; content?: string } = {},
): Promise<string> {
  const { data, error } = await supabase
    .from('evolution_explanations')
    .insert({
      explanation_id: opts.explanationId ?? null,
      prompt_id: opts.promptId ?? null,
      title: opts.title ?? 'Test Evolution Explanation',
      content: opts.content ?? VALID_VARIANT_TEXT,
      source: opts.explanationId ? 'explanation' : 'prompt_seed',
    })
    .select('id')
    .single();

  if (error) throw new Error(`createTestEvolutionExplanation failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return data.id;
}

/**
 * Insert a test evolution run and return the full row.
 * Auto-creates a strategy_config, prompt, and evolution_explanation if not provided.
 * Writes BOTH explanation_id and evolution_explanation_id during dual-column coexistence.
 * Gracefully skips evolution_explanation_id if the table doesn't exist yet.
 */
export async function createTestEvolutionRun(
  supabase: SupabaseClient,
  explanationId: number | null,
  overrides?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const strategyConfigId = overrides?.strategy_config_id ?? await createTestStrategyConfig(supabase);
  const promptId = overrides?.prompt_id ?? await createTestPrompt(supabase);

  // Only create evolution_explanation if the table exists (migration applied)
  let evolutionExplanationId: string | undefined;
  if (overrides?.evolution_explanation_id != null) {
    evolutionExplanationId = overrides.evolution_explanation_id as string;
  } else if (await evolutionExplanationsTableExists(supabase)) {
    evolutionExplanationId = await createTestEvolutionExplanation(supabase, {
      explanationId: explanationId ?? undefined,
      promptId: explanationId ? undefined : promptId as string,
    });
  }

  const row: Record<string, unknown> = {
    explanation_id: explanationId,
    status: 'pending',
    budget_cap_usd: 5.0,
    strategy_config_id: strategyConfigId,
    prompt_id: promptId,
    ...overrides,
  };

  // Only include evolution_explanation_id if we have one (table exists)
  if (evolutionExplanationId != null) {
    row.evolution_explanation_id = evolutionExplanationId;
  }

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

// ─── Checkpoint factory ─────────────────────────────────────────

/** Creates a test checkpoint row in evolution_checkpoints. */
export async function createTestCheckpoint(
  supabase: SupabaseClient,
  runId: string,
  iteration: number,
  lastAgent: string,
  snapshotOverrides: Partial<SerializedPipelineState> = {},
): Promise<string> {
  const defaultSnapshot: SerializedPipelineState = {
    iteration,
    originalText: VALID_VARIANT_TEXT,
    pool: [{
      id: `v-${iteration}-1`,
      text: VALID_VARIANT_TEXT,
      version: 1,
      parentIds: [],
      strategy: 'structural_transform',
      createdAt: Date.now(),
      iterationBorn: iteration,
    }],
    newEntrantsThisIteration: [`v-${iteration}-1`],
    ratings: { [`v-${iteration}-1`]: { mu: 25 + iteration * 2, sigma: 8.333 } },
    matchCounts: { [`v-${iteration}-1`]: iteration * 2 },
    matchHistory: [],
    dimensionScores: null,
    allCritiques: null,
    similarityMatrix: null,
    diversityScore: null,
    metaFeedback: null,
    debateTranscripts: [],
    ...snapshotOverrides,
  };

  const { data, error } = await supabase
    .from('evolution_checkpoints')
    .insert({
      run_id: runId,
      iteration,
      last_agent: lastAgent,
      phase: 'EXPANSION',
      state_snapshot: defaultSnapshot,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
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
  supabase: SupabaseClient,
  runIds: string[],
): Promise<void> {
  if (runIds.length === 0) return;

  const { data: runs } = await supabase
    .from('evolution_runs')
    .select('id, explanation_id, evolution_explanation_id')
    .in('id', runIds);

  for (const run of runs ?? []) {
    if (run.explanation_id === null) continue; // prompt-based — no sync needed

    const { data: evoExpl } = await supabase
      .from('evolution_explanations')
      .select('explanation_id')
      .eq('id', run.evolution_explanation_id)
      .single();

    if (!evoExpl) {
      throw new Error(`Run ${run.id}: evolution_explanation ${run.evolution_explanation_id} not found`);
    }
    if (evoExpl.explanation_id !== run.explanation_id) {
      throw new Error(
        `Run ${run.id}: explanation_id mismatch — run has ${run.explanation_id}, ` +
        `evolution_explanation has ${evoExpl.explanation_id}`,
      );
    }
  }
}
