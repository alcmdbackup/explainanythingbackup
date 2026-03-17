// Composition test: generate → rank pipeline integration.

import { generateVariants } from './generate';
import { rankPool } from './rank';
import { createV2MockLlm } from '../../testing/v2MockLlm';
import type { Rating } from '../core/rating';
import type { EvolutionConfig } from './types';

const baseConfig: EvolutionConfig = {
  iterations: 5,
  budgetUsd: 1.0,
  judgeModel: 'gpt-4.1-nano',
  generationModel: 'gpt-4.1-mini',
  calibrationOpponents: 3,
  tournamentTopK: 3,
};

const validText = `# Composed Article

## Introduction

This is a composed test variant for pipeline integration. It demonstrates proper formatting with headings. The content validates correctly against all format rules.

## Analysis

The composition test verifies generate and rank work together. Variants flow from generation into ranking. Ratings update correctly after comparisons.`;

describe('generate → rank composition', () => {
  it('generate output feeds into rank and produces valid results', async () => {
    const llm = createV2MockLlm({
      defaultText: validText,
      rankingResponses: Array(20).fill('A'),
    });

    // Generate variants
    const variants = await generateVariants('original text', 1, llm, baseConfig);
    expect(variants.length).toBeGreaterThan(0);

    // Rank them
    const newEntrantIds = variants.map((v) => v.id);
    const result = await rankPool(
      variants,
      new Map<string, Rating>(),
      new Map<string, number>(),
      newEntrantIds,
      llm,
      baseConfig,
    );

    // Ratings updated with correct mu direction
    expect(Object.keys(result.ratingUpdates).length).toBeGreaterThan(0);
    expect(result.matches.length).toBeGreaterThan(0);

    // Match count increments should be non-zero
    const totalIncrements = Object.values(result.matchCountIncrements).reduce((s, n) => s + n, 0);
    expect(totalIncrements).toBeGreaterThan(0);
  });

  it('generate returns empty → rank with empty newEntrants returns empty matches', async () => {
    const llm = createV2MockLlm({ defaultText: 'bad format' });

    const variants = await generateVariants('original', 1, llm, baseConfig);
    expect(variants).toHaveLength(0);

    const result = await rankPool([], new Map(), new Map(), [], llm, baseConfig);
    expect(result.matches).toHaveLength(0);
    expect(result.converged).toBe(false);
  });
});
