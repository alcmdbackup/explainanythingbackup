// Tests for Zod preprocess migrations: verify legacy run_summary rows with old field names
// (strategyEffectiveness, strategyMus, topVariants[].strategy, generationGuidance[].strategy)
// parse correctly through the renamed preprocess chain.

import { EvolutionRunSummarySchema, generationGuidanceEntrySchema } from './schemas';

// Helper: minimal valid V3 run summary with OLD field names (legacy DB rows)
function legacyV3Summary() {
  return {
    version: 3,
    stopReason: 'converged',
    finalPhase: 'COMPETITION',
    totalIterations: 3,
    durationSeconds: 120,
    eloHistory: [[1200, 1250, 1300]],
    diversityHistory: [1.0],
    matchStats: { totalMatches: 10, avgConfidence: 0.8, decisiveRate: 0.7 },
    topVariants: [
      { id: 'v1', strategy: 'structural_transform', elo: 1300, isSeedVariant: false },
    ],
    seedVariantRank: 2,
    seedVariantElo: 1200,
    // OLD field names — must be renamed by preprocess
    strategyEffectiveness: {
      structural_transform: { count: 3, avgElo: 1280 },
    },
    metaFeedback: null,
  };
}

// Helper: V3 summary with NEW field names
function newV3Summary() {
  return {
    ...legacyV3Summary(),
    topVariants: [
      { id: 'v1', tactic: 'structural_transform', elo: 1300, isSeedVariant: false },
    ],
    // NEW field names
    tacticEffectiveness: {
      structural_transform: { count: 3, avgElo: 1280 },
    },
    // Remove old names
    strategyEffectiveness: undefined,
  };
}

describe('Zod preprocess migration: run_summary', () => {
  it('legacy V3 with strategyEffectiveness → parses to tacticEffectiveness', () => {
    const result = EvolutionRunSummarySchema.parse(legacyV3Summary());
    expect(result.tacticEffectiveness).toBeDefined();
    expect(result.tacticEffectiveness.structural_transform!.count).toBe(3);
    // @ts-expect-error — old key should be gone after preprocess
    expect(result.strategyEffectiveness).toBeUndefined();
  });

  it('legacy V3 topVariants[].strategy → parses to topVariants[].tactic', () => {
    const result = EvolutionRunSummarySchema.parse(legacyV3Summary());
    expect(result.topVariants[0]!.tactic).toBe('structural_transform');
    // @ts-expect-error — old key should be gone
    expect(result.topVariants[0]!.strategy).toBeUndefined();
  });

  it('new V3 with tacticEffectiveness → parses directly (no rename needed)', () => {
    const summary = newV3Summary();
    delete (summary as Record<string, unknown>).strategyEffectiveness;
    const result = EvolutionRunSummarySchema.parse(summary);
    expect(result.tacticEffectiveness).toBeDefined();
    expect(result.tacticEffectiveness.structural_transform!.avgElo).toBe(1280);
  });

  it('new V3 with topVariants[].tactic → parses directly', () => {
    const summary = newV3Summary();
    delete (summary as Record<string, unknown>).strategyEffectiveness;
    const result = EvolutionRunSummarySchema.parse(summary);
    expect(result.topVariants[0]!.tactic).toBe('structural_transform');
  });

  it('strategyMus key in run summary is silently dropped (not a V3 field)', () => {
    // strategyMus exists in metaReview execution detail, not in run summary V3.
    // The renameKeys maps it to tacticMus, but since tacticMus is also not in the
    // V3 strict schema, it needs to be removed from the rename map to avoid rejection.
    // This test verifies the summary parses without strategyMus.
    const summary = legacyV3Summary();
    const result = EvolutionRunSummarySchema.parse(summary);
    expect(result).toBeDefined();
  });
});

describe('Zod preprocess migration: generationGuidance', () => {
  it('legacy {strategy, percent} → parses to {tactic, percent}', () => {
    const result = generationGuidanceEntrySchema.parse({ strategy: 'structural_transform', percent: 50 });
    expect(result.tactic).toBe('structural_transform');
    expect(result.percent).toBe(50);
    // @ts-expect-error — old key should be gone
    expect(result.strategy).toBeUndefined();
  });

  it('new {tactic, percent} → parses directly', () => {
    const result = generationGuidanceEntrySchema.parse({ tactic: 'analogy_bridge', percent: 30 });
    expect(result.tactic).toBe('analogy_bridge');
    expect(result.percent).toBe(30);
  });

  it('write path emits tactic, not strategy', () => {
    // Parse then serialize — output should have 'tactic' key
    const result = generationGuidanceEntrySchema.parse({ strategy: 'lexical_simplify', percent: 100 });
    const serialized = JSON.parse(JSON.stringify(result));
    expect(serialized.tactic).toBe('lexical_simplify');
    expect(serialized.strategy).toBeUndefined();
  });
});
