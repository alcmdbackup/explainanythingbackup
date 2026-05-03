// Integration test: round-trip evaluate_criteria_then_generate_from_previous_article
// execution_detail through Zod validation. Confirms the schema accepts representative
// real-world fixtures and rejects shape drift.

import {
  agentExecutionDetailSchema,
  evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema,
} from '@evolution/lib/schemas';

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const VARIANT = '00000000-0000-4000-8000-0000000000aa';

describe('evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema (integration)', () => {
  const validDetail = {
    detailType: 'evaluate_criteria_then_generate_from_previous_article' as const,
    tactic: 'criteria_driven' as const,
    weakestCriteriaIds: [C1],
    weakestCriteriaNames: ['clarity'],
    evaluateAndSuggest: {
      criteriaScored: [
        { criteriaId: C1, criteriaName: 'clarity', score: 2, minRating: 1, maxRating: 5 },
        { criteriaId: C2, criteriaName: 'engagement', score: 4, minRating: 1, maxRating: 5 },
      ],
      suggestions: [
        { criteriaName: 'clarity', examplePassage: 'foo', whatNeedsAddressing: 'too vague', suggestedFix: 'add context' },
      ],
      droppedSuggestions: [],
      durationMs: 1234,
      cost: 0.001,
    },
    generation: {
      cost: 0.005, promptLength: 1500, textLength: 1200, formatValid: true, durationMs: 3000,
    },
    ranking: {
      cost: 0.003,
      durationMs: 4000,
      stopReason: 'converged' as const,
      totalComparisons: 5,
      finalLocalElo: 1280,
      finalLocalUncertainty: 50,
      finalLocalTop15Cutoff: 1240,
      localPoolSize: 6,
      localPoolVariantIds: [],
      initialTop15Cutoff: 1240,
      comparisons: [],
      variantId: VARIANT,
    },
    totalCost: 0.009,
    estimatedTotalCost: 0.01,
    estimationErrorPct: -10,
    surfaced: true,
    variantId: VARIANT,
  };

  it('accepts representative valid fixture via direct schema', () => {
    const parsed = evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema.parse(validDetail);
    expect(parsed.detailType).toBe('evaluate_criteria_then_generate_from_previous_article');
    expect(parsed.weakestCriteriaIds).toEqual([C1]);
  });

  it('routes through agentExecutionDetailSchema discriminated union', () => {
    const parsed = agentExecutionDetailSchema.parse(validDetail);
    expect(parsed.detailType).toBe('evaluate_criteria_then_generate_from_previous_article');
  });

  it('round-trip preserves all fields byte-equal', () => {
    const parsed = evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema.parse(validDetail);
    expect(parsed).toEqual(validDetail);
  });

  it('rejects unknown detailType', () => {
    expect(() => agentExecutionDetailSchema.parse({
      ...validDetail,
      detailType: 'completely_unknown_agent',
    })).toThrow();
  });

  it('accepts partial fixture (no inner generation, post-eval-error path)', () => {
    const partial = {
      detailType: 'evaluate_criteria_then_generate_from_previous_article' as const,
      tactic: 'criteria_driven' as const,
      weakestCriteriaIds: [],
      weakestCriteriaNames: [],
      totalCost: 0,
      surfaced: false,
    };
    expect(() => evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema.parse(partial))
      .not.toThrow();
  });

  it('accepts droppedSuggestions field with reason annotations', () => {
    const withDropped = {
      ...validDetail,
      evaluateAndSuggest: {
        ...validDetail.evaluateAndSuggest,
        droppedSuggestions: [{ criteriaName: 'engagement', reason: 'not in weakest set' }],
      },
    };
    expect(() => evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema.parse(withDropped))
      .not.toThrow();
  });
});
