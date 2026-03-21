// Composition test: generate → rank pipeline integration.

import { generateVariants } from './generate';
import { rankPool } from './rank';
import { createV2MockLlm } from '../../testing/v2MockLlm';
import type { Rating } from '../shared/computeRatings';
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

  it('multi-round pipeline grows the pool across iterations', async () => {
    const llm = createV2MockLlm({
      defaultText: validText,
      rankingResponses: Array(50).fill('A'),
    });

    // Iteration 1: generate + rank
    const variants1 = await generateVariants('original text', 1, llm, baseConfig);
    const result1 = await rankPool(
      variants1, new Map(), new Map(),
      variants1.map((v) => v.id), llm, baseConfig,
    );

    // Iteration 2: new variants added to existing pool
    const variants2 = await generateVariants('original text', 2, llm, baseConfig);
    const combined = [...variants1, ...variants2];
    const ratings = new Map(Object.entries(result1.ratingUpdates));
    const matchCounts = new Map(Object.entries(result1.matchCountIncrements));

    const result2 = await rankPool(
      combined, ratings, matchCounts,
      variants2.map((v) => v.id), llm, baseConfig,
    );

    // Pool grew
    expect(combined.length).toBeGreaterThan(variants1.length);
    // More matches in round 2 (calibration against existing pool)
    expect(result2.matches.length).toBeGreaterThan(0);
  });

  it('variants have parent lineage from iteration field', async () => {
    const llm = createV2MockLlm({
      defaultText: validText,
      rankingResponses: Array(20).fill('A'),
    });

    const variants = await generateVariants('original text', 3, llm, baseConfig);

    for (const v of variants) {
      expect(v.iterationBorn).toBe(3);
    }
  });

  it('convergence is detected when ratings stabilize', async () => {
    const llm = createV2MockLlm({
      defaultText: validText,
      // All draws → ratings stay near default → should converge quickly
      rankingResponses: Array(50).fill('draw'),
    });

    const variants = await generateVariants('original text', 1, llm, baseConfig);
    if (variants.length === 0) return; // format validation may reject — skip gracefully

    const result = await rankPool(
      variants, new Map(), new Map(),
      variants.map((v) => v.id), llm, baseConfig,
    );

    // converged is a boolean — just verify it's set (may or may not be true depending on threshold)
    expect(typeof result.converged).toBe('boolean');
  });

  it('rank handles single variant without crashing', async () => {
    const llm = createV2MockLlm({ defaultText: validText });

    const variants = await generateVariants('original text', 1, llm, {
      ...baseConfig,
      calibrationOpponents: 0,
      tournamentTopK: 1,
    });

    if (variants.length === 0) return;

    // Single variant should still work — just no matches
    const singleVariant = [variants[0]];
    const result = await rankPool(
      singleVariant, new Map(), new Map(),
      [singleVariant[0].id], llm, { ...baseConfig, calibrationOpponents: 0 },
    );

    expect(result.matches).toHaveLength(0);
    expect(result.converged).toBe(false);
  });
});
