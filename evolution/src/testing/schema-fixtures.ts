// Typed test fixture factories for evolution DB schemas.
// Provides schema-conforming mock data for tests that exercise write paths.

import {
  evolutionStrategyInsertSchema,
  evolutionRunInsertSchema,
  evolutionVariantInsertSchema,
  evolutionAgentInvocationInsertSchema,
  evolutionRunLogInsertSchema,
  evolutionExperimentInsertSchema,
  evolutionArenaComparisonInsertSchema,
  evolutionBudgetEventInsertSchema,
  evolutionPromptInsertSchema,
  evolutionExplanationInsertSchema,
} from '../lib/schemas';

const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';
const UUID3 = '00000000-0000-4000-8000-000000000003';

export function createValidStrategyInsert(overrides?: Record<string, unknown>) {
  return evolutionStrategyInsertSchema.parse({
    name: 'test-strategy',
    config: { generationModel: 'gpt-4o', judgeModel: 'gpt-4o', iterations: 3 },
    config_hash: 'abc123def456',
    ...overrides,
  });
}

export function createValidRunInsert(overrides?: Record<string, unknown>) {
  return evolutionRunInsertSchema.parse({
    prompt_id: UUID1,
    strategy_id: UUID2,
    budget_cap_usd: 5.0,
    status: 'pending',
    ...overrides,
  });
}

export function createValidVariantInsert(overrides?: Record<string, unknown>) {
  return evolutionVariantInsertSchema.parse({
    id: UUID1,
    run_id: UUID2,
    variant_content: 'Test explanation text',
    elo_score: 1200,
    generation: 0,
    agent_name: 'generation',
    match_count: 0,
    is_winner: false,
    ...overrides,
  });
}

export function createValidInvocationInsert(overrides?: Record<string, unknown>) {
  return evolutionAgentInvocationInsertSchema.parse({
    run_id: UUID1,
    agent_name: 'generation',
    iteration: 0,
    execution_order: 0,
    ...overrides,
  });
}

export function createValidRunLogInsert(overrides?: Record<string, unknown>) {
  return evolutionRunLogInsertSchema.parse({
    run_id: UUID1,
    level: 'info',
    message: 'Test log message',
    ...overrides,
  });
}

export function createValidExperimentInsert(overrides?: Record<string, unknown>) {
  return evolutionExperimentInsertSchema.parse({
    name: 'test-experiment',
    prompt_id: UUID1,
    ...overrides,
  });
}

export function createValidArenaComparisonInsert(overrides?: Record<string, unknown>) {
  return evolutionArenaComparisonInsertSchema.parse({
    prompt_id: UUID1,
    entry_a: UUID2,
    entry_b: UUID3,
    winner: 'a',
    confidence: 0.8,
    ...overrides,
  });
}

export function createValidBudgetEventInsert(overrides?: Record<string, unknown>) {
  return evolutionBudgetEventInsertSchema.parse({
    run_id: UUID1,
    event_type: 'spend',
    agent_name: 'generation',
    amount_usd: 0.05,
    total_spent_usd: 0.1,
    total_reserved_usd: 0.0,
    available_budget_usd: 4.9,
    ...overrides,
  });
}

export function createValidPromptInsert(overrides?: Record<string, unknown>) {
  return evolutionPromptInsertSchema.parse({
    prompt: 'Explain quantum physics',
    title: 'Quantum Physics',
    ...overrides,
  });
}

export function createValidExplanationInsert(overrides?: Record<string, unknown>) {
  return evolutionExplanationInsertSchema.parse({
    title: 'Quantum Physics',
    content: 'Explanation content here',
    source: 'explanation',
    ...overrides,
  });
}
