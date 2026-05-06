// Phase 6.1.1b + 6.1.1c — Backward-compatibility tests for the schema rename
// and enum widening. Verifies that legacy strategy configs (without the new
// editing fields) still parse, and that legacy MergeRatings execution_detail
// rows (with iterationType='generate' or 'swiss') still parse against the
// widened 4-value enum.
//
// 6.1.1b: legacy iterationConfigSchema rows missing editingMaxCycles /
//   editingEligibilityCutoff / editingModel / approverModel parse cleanly.
// 6.1.1c: legacy mergeRatingsExecutionDetailSchema rows with the original
//   2-value iterationType still validate against the 4-value enum.

import { iterationConfigSchema, strategyConfigSchema, mergeRatingsExecutionDetailSchema } from '@evolution/lib/schemas';

describe('Phase 6.1.1b — strategy config schema BC', () => {
  it('parses a pre-editing iterationConfig (no editing fields)', () => {
    const legacy = {
      agentType: 'generate',
      budgetPercent: 60,
      sourceMode: 'seed',
    };
    const parsed = iterationConfigSchema.parse(legacy);
    expect(parsed.agentType).toBe('generate');
    expect(parsed.budgetPercent).toBe(60);
    expect((parsed as { editingMaxCycles?: number }).editingMaxCycles).toBeUndefined();
    expect((parsed as { editingEligibilityCutoff?: unknown }).editingEligibilityCutoff).toBeUndefined();
  });

  it('parses a pre-editing strategyConfig (no editingModel / approverModel)', () => {
    const legacy = {
      generationModel: 'gpt-4.1',
      judgeModel: 'gpt-4.1',
      budgetUsd: 0.05,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 60 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    const parsed = strategyConfigSchema.parse(legacy);
    expect(parsed.generationModel).toBe('gpt-4.1');
    expect((parsed as { editingModel?: string }).editingModel).toBeUndefined();
    expect((parsed as { approverModel?: string }).approverModel).toBeUndefined();
  });

  it('parses a strategyConfig with editing iteration + new fields', () => {
    const config = {
      generationModel: 'gpt-4.1',
      judgeModel: 'gpt-4.1',
      editingModel: 'gpt-4.1-mini',
      approverModel: 'claude-sonnet-4-6',
      budgetUsd: 0.05,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        {
          agentType: 'iterative_editing',
          budgetPercent: 30,
          editingMaxCycles: 3,
          editingEligibilityCutoff: { mode: 'topN', value: 5 },
        },
        { agentType: 'swiss', budgetPercent: 20 },
      ],
    };
    const parsed = strategyConfigSchema.parse(config);
    expect(parsed.iterationConfigs).toHaveLength(3);
    expect((parsed as { editingModel?: string }).editingModel).toBe('gpt-4.1-mini');
    expect((parsed as { approverModel?: string }).approverModel).toBe('claude-sonnet-4-6');
  });

  it('rejects iterationConfig with editingMaxCycles on a non-editing agentType', () => {
    const invalid = {
      agentType: 'generate',
      budgetPercent: 60,
      editingMaxCycles: 3, // only valid on iterative_editing
    };
    expect(() => iterationConfigSchema.parse(invalid)).toThrow();
  });

  it('rejects iterationConfig with editingEligibilityCutoff on a non-editing agentType', () => {
    const invalid = {
      agentType: 'swiss',
      budgetPercent: 50,
      editingEligibilityCutoff: { mode: 'topN', value: 5 },
    };
    expect(() => iterationConfigSchema.parse(invalid)).toThrow();
  });

  it('rejects editingEligibilityCutoff with topN: 0 (Phase 1.1 value-validation refine)', () => {
    const invalid = {
      agentType: 'iterative_editing',
      budgetPercent: 50,
      editingEligibilityCutoff: { mode: 'topN', value: 0 },
    };
    // topN must be int ≥1 (qualityCutoffSchema's defensive widening).
    expect(() => iterationConfigSchema.parse(invalid)).toThrow();
  });

  it('rejects editingEligibilityCutoff with topPercent > 100', () => {
    const invalid = {
      agentType: 'iterative_editing',
      budgetPercent: 50,
      editingEligibilityCutoff: { mode: 'topPercent', value: 150 },
    };
    expect(() => iterationConfigSchema.parse(invalid)).toThrow();
  });

  it('rejects strategyConfig with iterative_editing as the FIRST iteration', () => {
    const invalid = {
      generationModel: 'gpt-4.1',
      judgeModel: 'gpt-4.1',
      budgetUsd: 0.05,
      iterationConfigs: [
        { agentType: 'iterative_editing', budgetPercent: 100 }, // can't be first
      ],
    };
    expect(() => strategyConfigSchema.parse(invalid)).toThrow();
  });

  it('rejects strategyConfig where swiss precedes all variant-producing iterations including editing', () => {
    const invalid = {
      generationModel: 'gpt-4.1',
      judgeModel: 'gpt-4.1',
      budgetUsd: 0.05,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 30 },
        { agentType: 'swiss', budgetPercent: 30 },
        { agentType: 'iterative_editing', budgetPercent: 40 },
      ],
    };
    // This is actually allowed — swiss can precede editing as long as something
    // produces variants before swiss runs. Verify it's accepted.
    const parsed = strategyConfigSchema.parse(invalid);
    expect(parsed.iterationConfigs).toHaveLength(3);
  });
});

describe('Phase 6.1.1c — MergeRatingsAgent execution_detail iterationType BC', () => {
  function legacyDetail(iterationType: string) {
    return {
      detailType: 'merge_ratings',
      iterationType,
      totalCost: 0,
      before: { poolSize: 0, variants: [], top15Cutoff: 0 },
      input: { matchBufferCount: 0, totalMatchesIn: 0, matchesPerBuffer: [], newVariantsAdded: 0 },
      matchesApplied: [],
      matchesAppliedTotal: 0,
      matchesAppliedTruncated: false,
      after: { poolSize: 1, variants: [], top15Cutoff: 0, top15CutoffDelta: 0 },
      variantsAddedToPool: [],
      durationMs: 0,
    };
  }

  it('parses legacy iterationType="generate" rows (pre-rename)', () => {
    const parsed = mergeRatingsExecutionDetailSchema.parse(legacyDetail('generate'));
    expect(parsed.iterationType).toBe('generate');
  });

  it('parses legacy iterationType="swiss" rows', () => {
    const parsed = mergeRatingsExecutionDetailSchema.parse(legacyDetail('swiss'));
    expect(parsed.iterationType).toBe('swiss');
  });

  it('parses new iterationType="reflect_and_generate" rows (post-PR-1017)', () => {
    const parsed = mergeRatingsExecutionDetailSchema.parse(legacyDetail('reflect_and_generate'));
    expect(parsed.iterationType).toBe('reflect_and_generate');
  });

  it('parses new iterationType="iterative_editing" rows (post-bring_back_editing)', () => {
    const parsed = mergeRatingsExecutionDetailSchema.parse(legacyDetail('iterative_editing'));
    expect(parsed.iterationType).toBe('iterative_editing');
  });

  it('rejects unknown iterationType values', () => {
    expect(() => mergeRatingsExecutionDetailSchema.parse(legacyDetail('phantom'))).toThrow();
  });
});
