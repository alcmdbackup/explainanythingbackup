// Tests for evolution DB entity Zod schemas (Phase 1).
// Validates InsertSchema and FullDbSchema for all 10 evolution tables.

/** @jest-environment node */

import { v4 as uuidv4 } from 'uuid';
import {
  evolutionStrategyInsertSchema,
  evolutionStrategyFullDbSchema,
  evolutionPromptInsertSchema,
  evolutionPromptFullDbSchema,
  evolutionExperimentInsertSchema,
  evolutionExperimentFullDbSchema,
  evolutionRunInsertSchema,
  evolutionRunFullDbSchema,
  evolutionVariantInsertSchema,
  evolutionVariantFullDbSchema,
  evolutionAgentInvocationInsertSchema,
  evolutionAgentInvocationFullDbSchema,
  evolutionRunLogInsertSchema,
  evolutionRunLogFullDbSchema,
  evolutionArenaComparisonInsertSchema,
  evolutionArenaComparisonFullDbSchema,
  evolutionBudgetEventInsertSchema,
  evolutionBudgetEventFullDbSchema,
  evolutionExplanationInsertSchema,
  evolutionExplanationFullDbSchema,
  EvolutionRunSummaryV3Schema,
  EvolutionRunSummarySchema,
} from './schemas';

// ─── Fixture helpers ─────────────────────────────────────────────

const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';
const UUID3 = '00000000-0000-4000-8000-000000000003';
const NOW = '2026-03-23T12:00:00Z';

function createValidStrategyInsert() {
  return {
    name: 'test-strategy',
    config: { generationModel: 'gpt-4o', judgeModel: 'gpt-4o', iterations: 3 },
    config_hash: 'abc123def456',
  };
}

function createValidPromptInsert() {
  return { prompt: 'Explain quantum physics', title: 'Quantum Physics' };
}

function createValidExperimentInsert() {
  return { name: 'experiment-1', prompt_id: UUID1 };
}

function createValidRunInsert() {
  return { prompt_id: UUID1, strategy_id: UUID2, budget_cap_usd: 5.0 };
}

function createValidVariantInsert() {
  return { id: UUID1, run_id: UUID2, variant_content: 'Some explanation text' };
}

function createValidInvocationInsert() {
  return { run_id: UUID1, agent_name: 'generation', iteration: 0, execution_order: 0 };
}

function createValidRunLogInsert() {
  return { run_id: UUID1, level: 'info' as const, message: 'Starting run' };
}

function createValidArenaComparisonInsert() {
  return { prompt_id: UUID1, entry_a: UUID2, entry_b: UUID3, winner: 'a' as const, confidence: 0.8 };
}

function createValidBudgetEventInsert() {
  return {
    run_id: UUID1,
    event_type: 'spend' as const,
    agent_name: 'generation',
    amount_usd: 0.05,
    total_spent_usd: 0.1,
    total_reserved_usd: 0.0,
    available_budget_usd: 4.9,
  };
}

function createValidExplanationInsert() {
  return { title: 'Quantum Physics', content: 'Explanation content here', source: 'explanation' as const };
}

function createValidRunSummaryV3() {
  return {
    version: 3 as const,
    stopReason: 'iterations_complete',
    finalPhase: 'COMPETITION' as const,
    totalIterations: 5,
    durationSeconds: 120,
    muHistory: [25, 26, 27],
    diversityHistory: [0.5, 0.6, 0.7],
    matchStats: { totalMatches: 10, avgConfidence: 0.75, decisiveRate: 0.8 },
    topVariants: [{ id: UUID1, strategy: 'generation', mu: 28, isBaseline: false }],
    baselineRank: 3,
    baselineMu: 25,
    strategyEffectiveness: { generation: { count: 5, avgMu: 26 } },
    metaFeedback: {
      successfulStrategies: ['paraphrase'],
      recurringWeaknesses: ['too verbose'],
      patternsToAvoid: ['repetition'],
      priorityImprovements: ['conciseness'],
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('evolution_strategies', () => {
  it('parses valid insert', () => {
    expect(() => evolutionStrategyInsertSchema.parse(createValidStrategyInsert())).not.toThrow();
  });

  it('parses full DB row', () => {
    const row = { ...createValidStrategyInsert(), id: UUID1, created_at: NOW };
    expect(() => evolutionStrategyFullDbSchema.parse(row)).not.toThrow();
  });

  it('rejects missing name', () => {
    const { name, ...rest } = createValidStrategyInsert();
    expect(() => evolutionStrategyInsertSchema.parse(rest)).toThrow();
  });

  it('rejects invalid pipeline_type', () => {
    expect(() => evolutionStrategyInsertSchema.parse({
      ...createValidStrategyInsert(), pipeline_type: 'invalid',
    })).toThrow();
  });

  it('FullDbSchema requires id and created_at', () => {
    expect(() => evolutionStrategyFullDbSchema.parse(createValidStrategyInsert())).toThrow();
  });

  it('applies default values', () => {
    const result = evolutionStrategyInsertSchema.parse(createValidStrategyInsert());
    expect(result.pipeline_type).toBe('full');
    expect(result.status).toBe('active');
  });
});

describe('evolution_prompts', () => {
  it('parses valid insert', () => {
    expect(() => evolutionPromptInsertSchema.parse(createValidPromptInsert())).not.toThrow();
  });

  it('parses full DB row', () => {
    const row = { ...createValidPromptInsert(), id: UUID1, created_at: NOW };
    expect(() => evolutionPromptFullDbSchema.parse(row)).not.toThrow();
  });

  it('rejects empty prompt', () => {
    expect(() => evolutionPromptInsertSchema.parse({ prompt: '', title: 'Test' })).toThrow();
  });

  it('rejects invalid status', () => {
    expect(() => evolutionPromptInsertSchema.parse({
      ...createValidPromptInsert(), status: 'bogus',
    })).toThrow();
  });
});

describe('evolution_experiments', () => {
  it('parses valid insert', () => {
    expect(() => evolutionExperimentInsertSchema.parse(createValidExperimentInsert())).not.toThrow();
  });

  it('parses full DB row', () => {
    const row = { ...createValidExperimentInsert(), id: UUID1, created_at: NOW };
    expect(() => evolutionExperimentFullDbSchema.parse(row)).not.toThrow();
  });

  it('defaults status to draft', () => {
    const result = evolutionExperimentInsertSchema.parse(createValidExperimentInsert());
    expect(result.status).toBe('draft');
  });

  it('rejects invalid status', () => {
    expect(() => evolutionExperimentInsertSchema.parse({
      ...createValidExperimentInsert(), status: 'bogus',
    })).toThrow();
  });
});

describe('evolution_runs', () => {
  it('parses valid insert', () => {
    expect(() => evolutionRunInsertSchema.parse(createValidRunInsert())).not.toThrow();
  });

  it('parses full DB row', () => {
    const row = { ...createValidRunInsert(), id: UUID1, created_at: NOW };
    expect(() => evolutionRunFullDbSchema.parse(row)).not.toThrow();
  });

  it('rejects invalid status', () => {
    expect(() => evolutionRunInsertSchema.parse({
      ...createValidRunInsert(), status: 'bogus',
    })).toThrow();
  });

  it('handles nullable fields', () => {
    const result = evolutionRunInsertSchema.parse({
      ...createValidRunInsert(),
      explanation_id: null,
      error_message: null,
      runner_id: null,
    });
    expect(result.explanation_id).toBeNull();
  });

  it('defaults archived to false', () => {
    const result = evolutionRunInsertSchema.parse(createValidRunInsert());
    expect(result.archived).toBe(false);
  });
});

describe('evolution_variants', () => {
  it('parses valid insert', () => {
    expect(() => evolutionVariantInsertSchema.parse(createValidVariantInsert())).not.toThrow();
  });

  it('parses full DB row', () => {
    const row = { ...createValidVariantInsert(), created_at: NOW };
    expect(() => evolutionVariantFullDbSchema.parse(row)).not.toThrow();
  });

  it('requires id (client-generated)', () => {
    const { id, ...rest } = createValidVariantInsert();
    expect(() => evolutionVariantInsertSchema.parse(rest)).toThrow();
  });

  it('rejects empty variant_content', () => {
    expect(() => evolutionVariantInsertSchema.parse({
      ...createValidVariantInsert(), variant_content: '',
    })).toThrow();
  });

  it('defaults is_winner to false', () => {
    const result = evolutionVariantInsertSchema.parse(createValidVariantInsert());
    expect(result.is_winner).toBe(false);
  });
});

describe('evolution_agent_invocations', () => {
  it('parses valid insert', () => {
    expect(() => evolutionAgentInvocationInsertSchema.parse(createValidInvocationInsert())).not.toThrow();
  });

  it('parses full DB row', () => {
    const row = { ...createValidInvocationInsert(), id: UUID1, created_at: NOW };
    expect(() => evolutionAgentInvocationFullDbSchema.parse(row)).not.toThrow();
  });

  it('rejects negative iteration', () => {
    expect(() => evolutionAgentInvocationInsertSchema.parse({
      ...createValidInvocationInsert(), iteration: -1,
    })).toThrow();
  });

  it('handles nullable execution_detail', () => {
    const result = evolutionAgentInvocationInsertSchema.parse({
      ...createValidInvocationInsert(), execution_detail: null,
    });
    expect(result.execution_detail).toBeNull();
  });
});

describe('evolution_run_logs', () => {
  it('parses valid insert', () => {
    expect(() => evolutionRunLogInsertSchema.parse(createValidRunLogInsert())).not.toThrow();
  });

  it('parses full DB row', () => {
    const row = { ...createValidRunLogInsert(), id: 1, created_at: NOW };
    expect(() => evolutionRunLogFullDbSchema.parse(row)).not.toThrow();
  });

  it('rejects invalid log level', () => {
    expect(() => evolutionRunLogInsertSchema.parse({
      ...createValidRunLogInsert(), level: 'trace',
    })).toThrow();
  });

  it('accepts all valid log levels', () => {
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      expect(() => evolutionRunLogInsertSchema.parse({
        ...createValidRunLogInsert(), level,
      })).not.toThrow();
    }
  });
});

describe('evolution_arena_comparisons', () => {
  it('parses valid insert', () => {
    expect(() => evolutionArenaComparisonInsertSchema.parse(createValidArenaComparisonInsert())).not.toThrow();
  });

  it('parses full DB row', () => {
    const row = { ...createValidArenaComparisonInsert(), id: UUID1, created_at: NOW };
    expect(() => evolutionArenaComparisonFullDbSchema.parse(row)).not.toThrow();
  });

  it('rejects invalid winner', () => {
    expect(() => evolutionArenaComparisonInsertSchema.parse({
      ...createValidArenaComparisonInsert(), winner: 'c',
    })).toThrow();
  });

  it('rejects confidence > 1', () => {
    expect(() => evolutionArenaComparisonInsertSchema.parse({
      ...createValidArenaComparisonInsert(), confidence: 1.5,
    })).toThrow();
  });

  it('accepts all valid winners', () => {
    for (const winner of ['a', 'b', 'draw'] as const) {
      expect(() => evolutionArenaComparisonInsertSchema.parse({
        ...createValidArenaComparisonInsert(), winner,
      })).not.toThrow();
    }
  });
});

describe('evolution_budget_events', () => {
  it('parses valid insert', () => {
    expect(() => evolutionBudgetEventInsertSchema.parse(createValidBudgetEventInsert())).not.toThrow();
  });

  it('parses full DB row', () => {
    const row = { ...createValidBudgetEventInsert(), id: UUID1, created_at: NOW };
    expect(() => evolutionBudgetEventFullDbSchema.parse(row)).not.toThrow();
  });

  it('rejects invalid event_type', () => {
    expect(() => evolutionBudgetEventInsertSchema.parse({
      ...createValidBudgetEventInsert(), event_type: 'unknown',
    })).toThrow();
  });

  it('accepts all valid event types', () => {
    for (const event_type of ['reserve', 'spend', 'release_ok', 'release_failed'] as const) {
      expect(() => evolutionBudgetEventInsertSchema.parse({
        ...createValidBudgetEventInsert(), event_type,
      })).not.toThrow();
    }
  });
});

describe('evolution_explanations', () => {
  it('parses valid insert', () => {
    expect(() => evolutionExplanationInsertSchema.parse(createValidExplanationInsert())).not.toThrow();
  });

  it('parses full DB row', () => {
    const row = { ...createValidExplanationInsert(), id: 1, created_at: NOW };
    expect(() => evolutionExplanationFullDbSchema.parse(row)).not.toThrow();
  });

  it('rejects invalid source', () => {
    expect(() => evolutionExplanationInsertSchema.parse({
      ...createValidExplanationInsert(), source: 'unknown',
    })).toThrow();
  });

  it('rejects empty title', () => {
    expect(() => evolutionExplanationInsertSchema.parse({
      ...createValidExplanationInsert(), title: '',
    })).toThrow();
  });
});

describe('EvolutionRunSummary schemas', () => {
  it('parses valid V3 summary', () => {
    expect(() => EvolutionRunSummaryV3Schema.parse(createValidRunSummaryV3())).not.toThrow();
  });

  it('rejects V3 with extra fields (strict)', () => {
    expect(() => EvolutionRunSummaryV3Schema.parse({
      ...createValidRunSummaryV3(), extraField: 'nope',
    })).toThrow();
  });

  it('transforms V2 summary to V3', () => {
    const v2 = {
      version: 2,
      stopReason: 'budget_exceeded',
      finalPhase: 'COMPETITION',
      totalIterations: 3,
      durationSeconds: 60,
      ordinalHistory: [10, 12],
      diversityHistory: [0.5],
      matchStats: { totalMatches: 5, avgConfidence: 0.7, decisiveRate: 0.6 },
      topVariants: [{ id: UUID1, strategy: 'gen', ordinal: 15, isBaseline: false }],
      baselineRank: 2,
      baselineOrdinal: 10,
      strategyEffectiveness: { gen: { count: 3, avgOrdinal: 12 } },
      metaFeedback: null,
    };
    const result = EvolutionRunSummarySchema.parse(v2);
    expect(result.version).toBe(3);
    expect(result.muHistory.length).toBe(2);
    expect(result.topVariants[0].mu).toBeGreaterThan(15);
  });

  it('transforms V1 summary to V3', () => {
    const v1 = {
      stopReason: 'iterations_complete',
      finalPhase: 'EXPANSION',
      totalIterations: 2,
      durationSeconds: 30,
      eloHistory: [1200, 1250],
      diversityHistory: [0.4],
      matchStats: { totalMatches: 3, avgConfidence: 0.6, decisiveRate: 0.5 },
      topVariants: [{ id: UUID1, strategy: 'gen', elo: 1300, isBaseline: true }],
      baselineRank: 1,
      baselineElo: 1300,
      strategyEffectiveness: { gen: { count: 2, avgElo: 1250 } },
      metaFeedback: null,
    };
    const result = EvolutionRunSummarySchema.parse(v1);
    expect(result.version).toBe(3);
    expect(result.muHistory.length).toBe(2);
  });

  it('rejects completely invalid data', () => {
    expect(() => EvolutionRunSummarySchema.parse({ foo: 'bar' })).toThrow();
  });
});
