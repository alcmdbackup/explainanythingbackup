// Reusable helpers for evolution pipeline integration tests.
// Provides NOOP_SPAN, DB cleanup, test data factories, mock LLM client, and mock logger.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvolutionLLMClient, EvolutionLogger } from '@/lib/evolution/types';

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
): Promise<void> {
  if (explanationIds.length === 0) return;

  try {
    // Get run IDs for these explanations
    const { data: runs } = await supabase
      .from('content_evolution_runs')
      .select('id')
      .in('explanation_id', explanationIds);

    const runIds = (runs ?? []).map((r) => r.id);

    if (runIds.length > 0) {
      // Delete in FK-safe order: children first
      await supabase.from('evolution_checkpoints').delete().in('run_id', runIds);
      await supabase.from('content_evolution_variants').delete().in('run_id', runIds);
    }

    // Delete quality scores and history by explanation
    await supabase.from('content_quality_scores').delete().in('explanation_id', explanationIds);
    await supabase.from('content_history').delete().in('explanation_id', explanationIds);

    // Delete runs last (parent of variants/checkpoints)
    if (runIds.length > 0) {
      await supabase.from('content_evolution_runs').delete().in('id', runIds);
    }
  } catch (error) {
    // Don't throw on cleanup failure — log only
    console.warn('cleanupEvolutionData partial failure:', error);
  }
}

// ─── Test data factories ────────────────────────────────────────

/**
 * Insert a test evolution run and return the full row.
 */
export async function createTestEvolutionRun(
  supabase: SupabaseClient,
  explanationId: number,
  overrides?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const row = {
    explanation_id: explanationId,
    status: 'pending',
    budget_cap_usd: 5.0,
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
  explanationId: number,
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
