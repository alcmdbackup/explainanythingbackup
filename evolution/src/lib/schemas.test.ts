// Tests for evolution Zod schemas: DB entities (Phase 1) and internal pipeline types (Phase 2).
// Validates InsertSchema/FullDbSchema for all 10 DB tables plus internal pipeline schemas.

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
  // Phase 2: Internal pipeline schemas
  variantSchema,
  v2StrategyConfigSchema,
  evolutionConfigSchema,
  v2MatchSchema,
  evolutionResultSchema,
  ratingSchema,
  cachedMatchSchema,
  critiqueSchema,
  metaFeedbackSchema,
  agentExecutionDetailSchema,
  generationExecutionDetailSchema,
  iterativeEditingExecutionDetailSchema,
  reflectionExecutionDetailSchema,
  sectionDecompositionExecutionDetailSchema,
  treeSearchExecutionDetailSchema,
  outlineGenerationExecutionDetailSchema,
  rankingExecutionDetailSchema,
  debateExecutionDetailSchema,
  evolutionExecutionDetailSchema,
  proximityExecutionDetailSchema,
  metaReviewExecutionDetailSchema,
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
  return { prompt: 'Explain quantum physics', name: 'Quantum Physics' };
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
    expect(() => evolutionPromptInsertSchema.parse({ prompt: '', name: 'Test' })).toThrow();
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
    expect(result.topVariants[0]!.mu).toBeGreaterThan(15);
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

// ═══════════════════════════════════════════════════════════════════
// Phase 2: Internal Pipeline Type Schemas
// ═══════════════════════════════════════════════════════════════════

describe('variantSchema', () => {
  const validVariant = {
    id: UUID1, text: 'Some text', version: 0, parentIds: [],
    strategy: 'generation', createdAt: 1711152000, iterationBorn: 0,
  };

  it('parses valid variant', () => {
    expect(() => variantSchema.parse(validVariant)).not.toThrow();
  });

  it('accepts optional fields', () => {
    const result = variantSchema.parse({ ...validVariant, costUsd: 0.05, fromArena: true });
    expect(result.costUsd).toBe(0.05);
    expect(result.fromArena).toBe(true);
  });

  it('rejects negative version', () => {
    expect(() => variantSchema.parse({ ...validVariant, version: -1 })).toThrow();
  });
});

describe('v2StrategyConfigSchema', () => {
  it('parses valid config', () => {
    expect(() => v2StrategyConfigSchema.parse({
      generationModel: 'gpt-4o', judgeModel: 'gpt-4o', iterations: 5,
    })).not.toThrow();
  });

  it('rejects iterations < 1', () => {
    expect(() => v2StrategyConfigSchema.parse({
      generationModel: 'gpt-4o', judgeModel: 'gpt-4o', iterations: 0,
    })).toThrow();
  });
});

describe('evolutionConfigSchema', () => {
  it('parses valid config', () => {
    expect(() => evolutionConfigSchema.parse({
      iterations: 5, budgetUsd: 10, judgeModel: 'gpt-4o', generationModel: 'gpt-4o',
    })).not.toThrow();
  });

  it('rejects budgetUsd > 50', () => {
    expect(() => evolutionConfigSchema.parse({
      iterations: 5, budgetUsd: 51, judgeModel: 'gpt-4o', generationModel: 'gpt-4o',
    })).toThrow();
  });

  it('rejects budgetUsd = 0', () => {
    expect(() => evolutionConfigSchema.parse({
      iterations: 5, budgetUsd: 0, judgeModel: 'gpt-4o', generationModel: 'gpt-4o',
    })).toThrow();
  });
});

describe('v2MatchSchema', () => {
  it('parses valid match', () => {
    expect(() => v2MatchSchema.parse({
      winnerId: UUID1, loserId: UUID2, result: 'win',
      confidence: 0.8, judgeModel: 'gpt-4o', reversed: false,
    })).not.toThrow();
  });

  it('rejects invalid result', () => {
    expect(() => v2MatchSchema.parse({
      winnerId: UUID1, loserId: UUID2, result: 'loss',
      confidence: 0.8, judgeModel: 'gpt-4o', reversed: false,
    })).toThrow();
  });
});

describe('ratingSchema', () => {
  it('parses valid rating', () => {
    expect(() => ratingSchema.parse({ mu: 25, sigma: 8.333 })).not.toThrow();
  });

  it('rejects non-positive sigma', () => {
    expect(() => ratingSchema.parse({ mu: 25, sigma: 0 })).toThrow();
  });
});

describe('cachedMatchSchema', () => {
  it('parses valid cached match', () => {
    expect(() => cachedMatchSchema.parse({
      winnerId: UUID1, loserId: UUID2, confidence: 0.7, isDraw: false,
    })).not.toThrow();
  });

  it('accepts null winnerId/loserId for draws', () => {
    expect(() => cachedMatchSchema.parse({
      winnerId: null, loserId: null, confidence: 0.5, isDraw: true,
    })).not.toThrow();
  });
});

describe('critiqueSchema', () => {
  it('parses valid critique', () => {
    expect(() => critiqueSchema.parse({
      variationId: UUID1,
      dimensionScores: { clarity: 8, depth: 7 },
      goodExamples: { clarity: ['good example'] },
      badExamples: { depth: ['bad example'] },
      notes: { clarity: 'well written' },
      reviewer: 'reflection',
    })).not.toThrow();
  });

  it('accepts optional scale', () => {
    const result = critiqueSchema.parse({
      variationId: UUID1, dimensionScores: {}, goodExamples: {},
      badExamples: {}, notes: {}, reviewer: 'flow', scale: '0-5',
    });
    expect(result.scale).toBe('0-5');
  });
});

describe('metaFeedbackSchema', () => {
  it('parses valid meta feedback', () => {
    expect(() => metaFeedbackSchema.parse({
      recurringWeaknesses: ['verbose'],
      priorityImprovements: ['conciseness'],
      successfulStrategies: ['paraphrase'],
      patternsToAvoid: ['repetition'],
    })).not.toThrow();
  });
});

describe('agentExecutionDetailSchema (discriminated union)', () => {
  it('parses generation detail', () => {
    expect(() => generationExecutionDetailSchema.parse({
      detailType: 'generation', totalCost: 0.05,
      strategies: [{ name: 'paraphrase', promptLength: 500, status: 'success', variantId: UUID1 }],
      feedbackUsed: true,
    })).not.toThrow();
  });

  it('parses ranking detail', () => {
    expect(() => rankingExecutionDetailSchema.parse({
      detailType: 'ranking', totalCost: 0.1,
      triage: [{
        variantId: UUID1, opponents: [UUID2],
        matches: [{ opponentId: UUID2, winner: UUID1, confidence: 0.8, cacheHit: false }],
        eliminated: false,
        ratingBefore: { mu: 25, sigma: 8 }, ratingAfter: { mu: 26, sigma: 7 },
      }],
      fineRanking: { rounds: 3, exitReason: 'convergence', convergenceStreak: 5 },
      budgetPressure: 0.3, budgetTier: 'medium', top20Cutoff: 20,
      eligibleContenders: 5, totalComparisons: 10, flowEnabled: false,
    })).not.toThrow();
  });

  it('parses debate detail', () => {
    expect(() => debateExecutionDetailSchema.parse({
      detailType: 'debate', totalCost: 0.08,
      variantA: { id: UUID1, mu: 25 }, variantB: { id: UUID2, mu: 24 },
      transcript: [{ role: 'advocate_a', content: 'A is better' }],
    })).not.toThrow();
  });

  it('parses evolution detail', () => {
    expect(() => evolutionExecutionDetailSchema.parse({
      detailType: 'evolution', totalCost: 0.06,
      parents: [{ id: UUID1, mu: 25 }],
      mutations: [{ strategy: 'crossover', status: 'success', variantId: UUID2 }],
      creativeExploration: false, feedbackUsed: true,
    })).not.toThrow();
  });

  it('parses proximity detail', () => {
    expect(() => proximityExecutionDetailSchema.parse({
      detailType: 'proximity', totalCost: 0.02,
      newEntrants: 3, existingVariants: 10, diversityScore: 0.7, totalPairsComputed: 30,
    })).not.toThrow();
  });

  it('parses iterativeEditing detail', () => {
    expect(() => iterativeEditingExecutionDetailSchema.parse({
      detailType: 'iterativeEditing', totalCost: 0.04,
      targetVariantId: UUID1,
      config: { maxCycles: 5, maxConsecutiveRejections: 3, qualityThreshold: 7.5 },
      cycles: [{
        cycleNumber: 0,
        target: { dimension: 'clarity', description: 'Improve sentence clarity', score: 5, source: 'critique' },
        verdict: 'ACCEPT', confidence: 0.85, formatValid: true, newVariantId: UUID2,
      }],
      initialCritique: { dimensionScores: { clarity: 5, depth: 7 } },
      finalCritique: { dimensionScores: { clarity: 8, depth: 7 } },
      stopReason: 'threshold_met',
      consecutiveRejections: 0,
    })).not.toThrow();
  });

  it('parses reflection detail', () => {
    expect(() => reflectionExecutionDetailSchema.parse({
      detailType: 'reflection', totalCost: 0.03,
      variantsCritiqued: [{
        variantId: UUID1, status: 'success', avgScore: 7.2,
        dimensionScores: { clarity: 8, depth: 6.5 },
        goodExamples: { clarity: ['Clear opening paragraph'] },
        badExamples: { depth: ['Missing technical detail'] },
        notes: { clarity: 'Well structured' },
      }],
      dimensions: ['clarity', 'depth', 'engagement'],
    })).not.toThrow();
  });

  it('parses sectionDecomposition detail', () => {
    expect(() => sectionDecompositionExecutionDetailSchema.parse({
      detailType: 'sectionDecomposition', totalCost: 0.05,
      targetVariantId: UUID1,
      weakness: { dimension: 'depth', description: 'Lacks technical detail in middle sections' },
      sections: [
        { index: 0, heading: 'Introduction', eligible: false, improved: false, charCount: 200 },
        { index: 1, heading: 'Core Concepts', eligible: true, improved: true, charCount: 450 },
        { index: 2, heading: null, eligible: true, improved: false, charCount: 300 },
      ],
      sectionsImproved: 1, totalEligible: 2,
      formatValid: true, newVariantId: UUID2,
    })).not.toThrow();
  });

  it('parses treeSearch detail', () => {
    expect(() => treeSearchExecutionDetailSchema.parse({
      detailType: 'treeSearch', totalCost: 0.07,
      rootVariantId: UUID1,
      config: { beamWidth: 3, branchingFactor: 2, maxDepth: 4 },
      result: {
        treeSize: 12, maxDepth: 3, prunedBranches: 4,
        revisionPath: [
          { type: 'improve', dimension: 'clarity', description: 'Simplify jargon' },
          { type: 'restructure', description: 'Reorder sections for flow' },
        ],
      },
      bestLeafVariantId: UUID2, addedToPool: true,
    })).not.toThrow();
  });

  it('parses outlineGeneration detail', () => {
    expect(() => outlineGenerationExecutionDetailSchema.parse({
      detailType: 'outlineGeneration', totalCost: 0.06,
      steps: [
        { name: 'outline', score: 0.9, costUsd: 0.01, inputLength: 500, outputLength: 300 },
        { name: 'expand', score: 0.85, costUsd: 0.02, inputLength: 300, outputLength: 1200 },
        { name: 'polish', score: 0.88, costUsd: 0.02, inputLength: 1200, outputLength: 1100 },
        { name: 'verify', score: 0.92, costUsd: 0.01, inputLength: 1100, outputLength: 50 },
      ],
      weakestStep: 'expand', variantId: UUID1,
    })).not.toThrow();
  });

  it('parses metaReview detail', () => {
    expect(() => metaReviewExecutionDetailSchema.parse({
      detailType: 'metaReview', totalCost: 0.03,
      successfulStrategies: ['gen'], recurringWeaknesses: ['verbose'],
      patternsToAvoid: ['repetition'], priorityImprovements: ['flow'],
      analysis: {
        strategyMus: { gen: 26 }, bottomQuartileCount: 2,
        poolDiversity: 0.6, muRange: 5, activeStrategies: 3, topVariantAge: 2,
      },
    })).not.toThrow();
  });

  it('discriminates by detailType', () => {
    const genDetail = {
      detailType: 'generation', totalCost: 0.05,
      strategies: [], feedbackUsed: false,
    };
    const result = agentExecutionDetailSchema.parse(genDetail);
    expect(result.detailType).toBe('generation');
  });

  it('rejects unknown detailType', () => {
    expect(() => agentExecutionDetailSchema.parse({
      detailType: 'unknown', totalCost: 0,
    })).toThrow();
  });

  it('accepts _truncated flag', () => {
    const result = generationExecutionDetailSchema.parse({
      detailType: 'generation', totalCost: 0.05,
      strategies: [], feedbackUsed: false, _truncated: true,
    });
    expect(result._truncated).toBe(true);
  });
});
