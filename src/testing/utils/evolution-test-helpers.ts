// Reusable helpers for evolution pipeline integration tests.
// Provides NOOP_SPAN, DB cleanup, test data factories, mock LLM client, and mock logger.

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvolutionLLMClient, EvolutionLogger, SerializedPipelineState } from '@/lib/evolution/types';

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
 * Returns true if content_evolution_runs table is queryable.
 * Used to skip entire test suites when migrations haven't been applied.
 */
export async function evolutionTablesExist(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase
    .from('content_evolution_runs')
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
        .from('content_evolution_runs')
        .select('id')
        .in('explanation_id', explanationIds);
      runIds.push(...(runs ?? []).map((r) => r.id));
    }

    if (runIds.length > 0) {
      // Delete in FK-safe order: children first
      await supabase.from('evolution_checkpoints').delete().in('run_id', runIds);
      await supabase.from('content_evolution_variants').delete().in('run_id', runIds);
    }

    // Delete quality scores and history by explanation
    if (explanationIds.length > 0) {
      await supabase.from('content_quality_scores').delete().in('explanation_id', explanationIds);
      await supabase.from('content_history').delete().in('explanation_id', explanationIds);
    }

    // Delete runs and their auto-created strategy configs
    if (runIds.length > 0) {
      // Collect strategy_config_ids before deleting runs
      const { data: runRows } = await supabase
        .from('content_evolution_runs')
        .select('strategy_config_id')
        .in('id', runIds);
      const strategyIds = (runRows ?? []).map((r) => r.strategy_config_id).filter(Boolean);

      await supabase.from('content_evolution_runs').delete().in('id', runIds);

      // Clean up test strategy configs (name starts with 'test_strategy_')
      if (strategyIds.length > 0) {
        await supabase.from('strategy_configs').delete()
          .in('id', strategyIds)
          .ilike('name', 'test_strategy_%');
      }

      // Clean up auto-created prompt topics
      await supabase.from('hall_of_fame_topics').delete()
        .eq('prompt', 'Test evolution prompt');
    }
  } catch (error) {
    // Don't throw on cleanup failure — log only
    console.warn('cleanupEvolutionData partial failure:', error);
  }
}

// ─── Test data factories ────────────────────────────────────────

/** Get or create a test strategy config and return its ID. Caller must clean up. */
export async function createTestStrategyConfig(
  supabase: SupabaseClient,
): Promise<string> {
  const config = { generationModel: 'test-model', judgeModel: 'test-judge', iterations: 3, budgetCaps: { generation: 30 } };
  const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12);

  // Try to find existing config with same hash first
  const { data: existing } = await supabase
    .from('strategy_configs')
    .select('id')
    .eq('config_hash', configHash)
    .single();

  if (existing) return existing.id;

  const name = `test_strategy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await supabase
    .from('strategy_configs')
    .insert({ config_hash: configHash, name, label: 'Test strategy', config })
    .select('id')
    .single();

  // Handle race condition: another test may have inserted between select and insert
  if (error?.code === '23505') {
    const { data: retry } = await supabase
      .from('strategy_configs')
      .select('id')
      .eq('config_hash', configHash)
      .single();
    if (retry) return retry.id;
  }

  if (error) throw new Error(`createTestStrategyConfig failed: ${error.message ?? error.code}`);
  return data.id;
}

/** Get or create a test prompt topic and return its ID. */
export async function createTestPromptTopic(
  supabase: SupabaseClient,
  prompt = 'Test evolution prompt',
): Promise<string> {
  const { data: existing } = await supabase
    .from('hall_of_fame_topics')
    .select('id')
    .ilike('prompt', prompt)
    .is('deleted_at', null)
    .single();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from('hall_of_fame_topics')
    .insert({ prompt, title: prompt })
    .select('id')
    .single();
  if (error?.code === '23505') {
    const { data: retry } = await supabase
      .from('hall_of_fame_topics')
      .select('id')
      .ilike('prompt', prompt)
      .is('deleted_at', null)
      .single();
    if (retry) return retry.id;
  }
  if (error) throw new Error(`createTestPromptTopic failed: ${error.message ?? error.code}`);
  return data.id;
}

/**
 * Insert a test evolution run and return the full row.
 * Auto-creates a strategy config and prompt topic if not provided in overrides.
 */
export async function createTestEvolutionRun(
  supabase: SupabaseClient,
  explanationId: number | null,
  overrides?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let strategyConfigId = overrides?.strategy_config_id;
  if (!strategyConfigId) {
    strategyConfigId = await createTestStrategyConfig(supabase);
  }

  let promptId = overrides?.prompt_id;
  if (!promptId) {
    promptId = await createTestPromptTopic(supabase);
  }

  const row = {
    explanation_id: explanationId,
    status: 'pending',
    budget_cap_usd: 5.0,
    strategy_config_id: strategyConfigId,
    prompt_id: promptId,
    ...overrides,
  };

  const { data, error } = await supabase
    .from('content_evolution_runs')
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
    .from('content_evolution_variants')
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
