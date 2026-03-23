// Tests for V2 evolveVariants helper.

import { evolveVariants } from './extractFeedback';
import { BudgetExceededError } from '../../types';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import { createV2MockLlm } from '../../../testing/v2MockLlm';
import type { EvolutionConfig } from '../infra/types';

const baseConfig: EvolutionConfig = {
  iterations: 5,
  budgetUsd: 1.0,
  judgeModel: 'gpt-4.1-nano',
  generationModel: 'gpt-4.1-mini',
};

const validText = `# Evolved Article

## Introduction

This is an evolved test variant with proper formatting. It has multiple sentences per paragraph. The content validates correctly.

## Details

The pipeline evolves variants through mutation and crossover. Each variant improves upon its parents. Higher quality emerges over iterations.`;

function makeVariant(id: string, mu: number, version = 1): Variant {
  return {
    id,
    text: `# Variant ${id}\n\n## Section\n\nContent for variant ${id}. This has multiple sentences. It is properly formatted.`,
    version,
    parentIds: [],
    strategy: 'test',
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
  };
}

function makeRatings(entries: Array<[string, number]>): Map<string, Rating> {
  return new Map(entries.map(([id, mu]) => [id, { mu, sigma: 8.333 }]));
}

describe('evolveVariants', () => {
  it('selects parents from top-rated variants', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const pool = [makeVariant('a', 30), makeVariant('b', 20), makeVariant('c', 10)];
    const ratings = makeRatings([['a', 30], ['b', 20], ['c', 10]]);

    await evolveVariants(pool, ratings, 2, llm, baseConfig);

    // Should call with parent a (top rated) text in prompts
    const calls = llm.complete.mock.calls;
    expect(calls.some((c: string[]) => c[0].includes('Variant a'))).toBe(true);
  });

  it('produces crossover with 2 parents', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const pool = [makeVariant('a', 30), makeVariant('b', 20)];
    const ratings = makeRatings([['a', 30], ['b', 20]]);

    const result = await evolveVariants(pool, ratings, 1, llm, baseConfig);
    // 2 mutations + 1 crossover = 3 variants
    expect(result).toHaveLength(3);
    expect(result.some((v) => v.strategy === 'crossover')).toBe(true);
  });

  it('discards format-invalid variants', async () => {
    const llm = createV2MockLlm({ defaultText: 'bad format no heading' });
    const pool = [makeVariant('a', 30), makeVariant('b', 20)];
    const ratings = makeRatings([['a', 30], ['b', 20]]);

    const result = await evolveVariants(pool, ratings, 1, llm, baseConfig);
    expect(result).toHaveLength(0);
  });

  it('triggers creative exploration when diversityScore > 0 and < 0.5', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const pool = [makeVariant('a', 30), makeVariant('b', 20)];
    const ratings = makeRatings([['a', 30], ['b', 20]]);

    const result = await evolveVariants(pool, ratings, 1, llm, baseConfig, {
      diversityScore: 0.3,
    });
    // 2 mutations + 1 crossover + 1 creative = 4
    expect(result).toHaveLength(4);
    expect(result.some((v) => v.strategy === 'creative_exploration')).toBe(true);
  });

  it('does NOT trigger creative exploration when diversityScore = 0', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const pool = [makeVariant('a', 30), makeVariant('b', 20)];
    const ratings = makeRatings([['a', 30], ['b', 20]]);

    const result = await evolveVariants(pool, ratings, 1, llm, baseConfig, {
      diversityScore: 0,
    });
    expect(result).toHaveLength(3); // No creative
    expect(result.every((v) => v.strategy !== 'creative_exploration')).toBe(true);
  });

  it('injects feedback into mutation prompts', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const pool = [makeVariant('a', 30)];
    const ratings = makeRatings([['a', 30]]);

    await evolveVariants(pool, ratings, 1, llm, baseConfig, {
      feedback: { weakestDimension: 'flow', suggestions: ['improve transitions'] },
    });

    const calls = llm.complete.mock.calls;
    expect(calls.some((c: string[]) => c[0].includes('flow'))).toBe(true);
    expect(calls.some((c: string[]) => c[0].includes('improve transitions'))).toBe(true);
  });

  it('sets iterationBorn correctly', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const pool = [makeVariant('a', 30)];
    const ratings = makeRatings([['a', 30]]);

    const result = await evolveVariants(pool, ratings, 7, llm, baseConfig);
    expect(result.every((v) => v.iterationBorn === 7)).toBe(true);
  });

  it('propagates BudgetExceededError', async () => {
    const llm = createV2MockLlm();
    llm.complete.mockRejectedValue(new BudgetExceededError('evolution', 0.9, 0.1, 1.0));
    const pool = [makeVariant('a', 30)];
    const ratings = makeRatings([['a', 30]]);

    await expect(evolveVariants(pool, ratings, 1, llm, baseConfig)).rejects.toThrow(BudgetExceededError);
  });

  it('returns empty for empty pool', async () => {
    const llm = createV2MockLlm();
    const result = await evolveVariants([], new Map(), 1, llm, baseConfig);
    expect(result).toHaveLength(0);
  });

  it('skips crossover with single-variant pool (mutation only)', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const pool = [makeVariant('a', 30)];
    const ratings = makeRatings([['a', 30]]);

    const result = await evolveVariants(pool, ratings, 1, llm, baseConfig);
    // 2 mutations, no crossover (only 1 parent)
    expect(result).toHaveLength(2);
    expect(result.every((v) => v.strategy !== 'crossover')).toBe(true);
  });

  it('sets version = max(parent versions) + 1', async () => {
    const llm = createV2MockLlm({ defaultText: validText });
    const v1 = makeVariant('a', 30, 3);
    const v2 = makeVariant('b', 20, 5);
    const pool = [v1, v2];
    const ratings = makeRatings([['a', 30], ['b', 20]]);

    const result = await evolveVariants(pool, ratings, 1, llm, baseConfig);
    expect(result.every((v) => v.version === 6)).toBe(true);
  });
});
