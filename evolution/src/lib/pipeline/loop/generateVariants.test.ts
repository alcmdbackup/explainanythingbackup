// Tests for V2 generateVariants helper.

import { generateVariants, selectStrategies, buildDefaultGuidance, getKnownStrategyNames } from './generateVariants';
import { BudgetExceededError, BudgetExceededWithPartialResults } from '../../types';
import { createV2MockLlm } from '../../../testing/v2MockLlm';
import type { EvolutionConfig } from '../infra/types';

const baseConfig: EvolutionConfig = {
  iterations: 5,
  budgetUsd: 1.0,
  judgeModel: 'gpt-4.1-nano',
  generationModel: 'gpt-4.1-mini',
};

const validText = `# Test Article

## Introduction

This is a generated variant with proper formatting. It has multiple sentences in each paragraph. The content validates correctly.

## Details

The pipeline generates variants through strategies. Each variant goes through comparisons. Higher-rated variants advance.`;

describe('generateVariants', () => {
  it('produces 3 variants with correct iterationBorn', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const result = await generateVariants('original', 2, llm, baseConfig);
    expect(result.variants).toHaveLength(3);
    expect(result.variants.every((v) => v.iterationBorn === 2)).toBe(true);
    expect(llm.complete).toHaveBeenCalledTimes(3);
  });

  it('discards format-invalid variants without retry', async () => {
    const llm = createV2MockLlm({ defaultText: 'no heading, bad format' });
    const result = await generateVariants('original', 1, llm, baseConfig);
    expect(result.variants).toHaveLength(0);
  });

  it('returns empty when all fail format validation', async () => {
    const llm = createV2MockLlm({ defaultText: 'invalid' });
    const result = await generateVariants('original', 1, llm, baseConfig);
    expect(result.variants).toHaveLength(0);
  });

  it('propagates BudgetExceededError with partial results', async () => {
    let callCount = 0;
    const llm = createV2MockLlm();
    llm.complete.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) throw new BudgetExceededError('generation', 0.9, 0.1, 1.0);
      return validText;
    });

    try {
      await generateVariants('original', 1, llm, baseConfig);
      fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect(err).toBeInstanceOf(BudgetExceededWithPartialResults);
      const partialErr = err as BudgetExceededWithPartialResults;
      // At least 1 variant should succeed (the ones that don't throw)
      expect((partialErr.partialData as any[]).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('injects feedback into prompts', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const feedback = { weakestDimension: 'clarity', suggestions: ['simplify'] };
    await generateVariants('original', 1, llm, baseConfig, feedback);
    const calls = llm.complete.mock.calls;
    expect(calls.some((c: string[]) => c[0]!.includes('clarity'))).toBe(true);
    expect(calls.some((c: string[]) => c[0]!.includes('simplify'))).toBe(true);
  });

  it('makes all 3 LLM calls in parallel', async () => {
    let callCount = 0;
    let resolveAll: (() => void) | null = null;
    const barrier = new Promise<void>((r) => { resolveAll = r; });

    const llm = createV2MockLlm();
    llm.complete.mockImplementation(async () => {
      callCount++;
      if (callCount === 3) resolveAll!();
      await barrier;
      return validText;
    });

    const promise = generateVariants('original', 1, llm, baseConfig);
    await promise;
    expect(llm.complete).toHaveBeenCalledTimes(3);
  });

  it('respects strategiesPerRound=1', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const config = { ...baseConfig, strategiesPerRound: 1 };
    const result = await generateVariants('original', 1, llm, config);
    expect(result.variants).toHaveLength(1);
    expect(llm.complete).toHaveBeenCalledTimes(1);
    // First strategy should be structural_transform
    expect(result.variants[0]!.strategy).toBe('structural_transform');
  });

  it('assigns unique IDs to each variant', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const result = await generateVariants('original', 1, llm, baseConfig);
    const ids = result.variants.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('populates strategyResults for each attempted strategy', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const result = await generateVariants('original', 1, llm, baseConfig);
    expect(result.strategyResults).toBeDefined();
    expect(result.strategyResults.length).toBeGreaterThan(0);
    // Each strategyResult should have at minimum a strategy name and status
    result.strategyResults.forEach((sr) => {
      expect(sr.name).toBeDefined();
      expect(sr.status).toBeDefined();
    });
  });

  // ─── generationGuidance tests ──────────────────────────────────

  it('uses generationGuidance strategies when provided', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const config: EvolutionConfig = {
      ...baseConfig,
      generationGuidance: [{ strategy: 'engagement_amplify', percent: 100 }],
    };
    const result = await generateVariants('original', 1, llm, config);
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]!.strategy).toBe('engagement_amplify');
  });

  it('falls back to default 3 strategies when generationGuidance is undefined', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const result = await generateVariants('original', 1, llm, baseConfig);
    expect(result.variants).toHaveLength(3);
    const strategies = result.variants.map((v) => v.strategy);
    expect(strategies).toContain('structural_transform');
    expect(strategies).toContain('lexical_simplify');
    expect(strategies).toContain('grounding_enhance');
  });

  it('runs all guidance strategies when strategiesPerRound >= guidance length', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const config: EvolutionConfig = {
      ...baseConfig,
      strategiesPerRound: 10,
      generationGuidance: [
        { strategy: 'style_polish', percent: 50 },
        { strategy: 'tone_transform', percent: 50 },
      ],
    };
    const result = await generateVariants('original', 1, llm, config);
    expect(result.variants).toHaveLength(2);
    const strategies = new Set(result.variants.map((v) => v.strategy));
    expect(strategies.has('style_polish')).toBe(true);
    expect(strategies.has('tone_transform')).toBe(true);
  });

  it('each of 8 strategies produces format-valid output', async () => {
    const allStrategies = getKnownStrategyNames();
    expect(allStrategies.length).toBe(8);
    for (const strategy of allStrategies) {
      const llm = createV2MockLlm({ defaultText: validText });
      const config: EvolutionConfig = {
        ...baseConfig,
        generationGuidance: [{ strategy, percent: 100 }],
      };
      const result = await generateVariants('original', 1, llm, config);
      expect(result.variants).toHaveLength(1);
      expect(result.variants[0]!.strategy).toBe(strategy);
    }
  });
});

// ─── selectStrategies unit tests ──────────────────────────────────

describe('selectStrategies', () => {
  const guidance = [
    { strategy: 'a', percent: 50 },
    { strategy: 'b', percent: 30 },
    { strategy: 'c', percent: 20 },
  ];

  it('returns all when count >= entries.length', () => {
    expect(selectStrategies(guidance, 3)).toEqual(['a', 'b', 'c']);
    expect(selectStrategies(guidance, 5)).toEqual(['a', 'b', 'c']);
  });

  it('returns exactly count items when count < entries.length', () => {
    const result = selectStrategies(guidance, 2);
    expect(result).toHaveLength(2);
  });

  it('samples without replacement (no duplicates)', () => {
    for (let i = 0; i < 20; i++) {
      const result = selectStrategies(guidance, 2);
      expect(new Set(result).size).toBe(result.length);
    }
  });

  it('single entry at 100% always returns that strategy', () => {
    const single = [{ strategy: 'only', percent: 100 }];
    expect(selectStrategies(single, 1)).toEqual(['only']);
  });

  it('weighted: roll=0 selects first strategy (highest cumulative first)', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = selectStrategies(guidance, 1);
    expect(result).toEqual(['a']);
    jest.restoreAllMocks();
  });

  it('weighted: roll=0.99 selects last strategy', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const result = selectStrategies(guidance, 1);
    expect(result).toEqual(['c']);
    jest.restoreAllMocks();
  });

  it('weighted: roll=0.5 selects second strategy (cumulative 50 < 50*100=50, so b at 80)', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.51);
    const result = selectStrategies(guidance, 1);
    expect(result).toEqual(['b']);
    jest.restoreAllMocks();
  });
});

// ─── buildDefaultGuidance unit tests ─────────────────────────────

describe('buildDefaultGuidance', () => {
  it('produces entries that sum to exactly 100', () => {
    const guidance = buildDefaultGuidance();
    const total = guidance.reduce((sum, g) => sum + g.percent, 0);
    expect(total).toBe(100);
  });

  it('includes all known strategies', () => {
    const guidance = buildDefaultGuidance();
    const names = guidance.map((g) => g.strategy);
    expect(names).toEqual(expect.arrayContaining([...getKnownStrategyNames()]));
  });

  it('has no duplicate strategy names', () => {
    const guidance = buildDefaultGuidance();
    const names = guidance.map((g) => g.strategy);
    expect(new Set(names).size).toBe(names.length);
  });
});
