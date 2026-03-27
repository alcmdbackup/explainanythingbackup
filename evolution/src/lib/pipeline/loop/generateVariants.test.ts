// Tests for V2 generateVariants helper.

import { generateVariants } from './generateVariants';
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
});
