// Unit tests for creator-based Elo attribution: per-variant and per-agent aggregation.

import { computeEloAttribution, aggregateByAgent, buildParentRatingResolver } from './eloAttribution';
import { createRating } from './rating';
import type { Rating } from './rating';
import type { TextVariation } from '../types';

const DEFAULT_MU = createRating().mu; // 25
const ELO_SCALE = 400 / DEFAULT_MU;  // 16

function makeRating(mu: number, sigma: number): Rating {
  return { mu, sigma };
}

function makeVariant(overrides: Partial<TextVariation> & { id: string; strategy: string }): TextVariation {
  return {
    text: 'test',
    version: 1,
    parentIds: [],
    createdAt: 0,
    iterationBorn: 0,
    ...overrides,
  };
}

describe('computeEloAttribution', () => {
  it('computes gain relative to default for 0 parents', () => {
    const variant = makeRating(30, 5);
    const result = computeEloAttribution(variant, []);

    expect(result.deltaMu).toBeCloseTo(30 - DEFAULT_MU);
    expect(result.gain).toBeCloseTo((30 - DEFAULT_MU) * ELO_SCALE);
    // sigma from variant only (no parent sigma)
    expect(result.sigmaDelta).toBeCloseTo(5);
    expect(result.ci).toBeCloseTo(1.96 * 5 * ELO_SCALE);
    expect(result.zScore).toBeCloseTo((30 - DEFAULT_MU) / 5);
  });

  it('computes gain relative to single parent', () => {
    const variant = makeRating(35, 4);
    const parent = makeRating(28, 6);
    const result = computeEloAttribution(variant, [parent]);

    expect(result.deltaMu).toBeCloseTo(35 - 28);
    expect(result.gain).toBeCloseTo(7 * ELO_SCALE);
    // sigmaDelta = sqrt(4² + 6²) = sqrt(16 + 36) = sqrt(52)
    expect(result.sigmaDelta).toBeCloseTo(Math.sqrt(52));
  });

  it('computes gain relative to average of 2 parents', () => {
    const variant = makeRating(40, 3);
    const parent0 = makeRating(30, 5);
    const parent1 = makeRating(20, 7);
    const result = computeEloAttribution(variant, [parent0, parent1]);

    const avgParentMu = (30 + 20) / 2;
    expect(result.deltaMu).toBeCloseTo(40 - avgParentMu);
    expect(result.gain).toBeCloseTo((40 - avgParentMu) * ELO_SCALE);

    // avgParentSigma2 = (25 + 49) / 2 = 37
    const avgParentSigma2 = (25 + 49) / 2;
    expect(result.sigmaDelta).toBeCloseTo(Math.sqrt(9 + avgParentSigma2));
  });

  it('returns zScore = 0 when sigmaDelta = 0', () => {
    const variant = makeRating(30, 0);
    const result = computeEloAttribution(variant, []);

    expect(result.zScore).toBe(0);
    expect(result.gain).toBeCloseTo((30 - DEFAULT_MU) * ELO_SCALE);
    expect(result.ci).toBe(0);
  });

  it('handles negative gain (variant worse than parent)', () => {
    const variant = makeRating(20, 4);
    const parent = makeRating(30, 3);
    const result = computeEloAttribution(variant, [parent]);

    expect(result.gain).toBeLessThan(0);
    expect(result.deltaMu).toBeCloseTo(-10);
    expect(result.zScore).toBeLessThan(0);
  });

  it('uses default rating for missing parent (fallback test)', () => {
    const variant = makeRating(30, 4);
    const defaultParent = createRating();
    const result = computeEloAttribution(variant, [defaultParent]);

    expect(result.deltaMu).toBeCloseTo(30 - DEFAULT_MU);
  });
});

describe('aggregateByAgent', () => {
  it('groups variants by creating agent', () => {
    const pool: TextVariation[] = [
      makeVariant({ id: 'v1', strategy: 'structural_transform', parentIds: [] }),
      makeVariant({ id: 'v2', strategy: 'lexical_simplify', parentIds: [] }),
      makeVariant({ id: 'v3', strategy: 'mutate_clarity', parentIds: ['v1'] }),
    ];

    const ratings = new Map<string, Rating>([
      ['v1', makeRating(30, 4)],
      ['v2', makeRating(28, 5)],
      ['v3', makeRating(35, 3)],
    ]);

    const results = aggregateByAgent(pool, ratings, buildParentRatingResolver(ratings));

    // v1 (structural_transform) and v2 (lexical_simplify) → 'generation'
    // v3 (mutate_clarity) → 'evolution'
    const generation = results.find(r => r.agentName === 'generation');
    const evolution = results.find(r => r.agentName === 'evolution');

    expect(generation).toBeDefined();
    expect(generation!.variantCount).toBe(2);
    expect(evolution).toBeDefined();
    expect(evolution!.variantCount).toBe(1);
  });

  it('computes correct root-sum-of-squares CI', () => {
    const pool: TextVariation[] = [
      makeVariant({ id: 'v1', strategy: 'structural_transform', parentIds: [] }),
      makeVariant({ id: 'v2', strategy: 'lexical_simplify', parentIds: [] }),
    ];

    const ratings = new Map<string, Rating>([
      ['v1', makeRating(30, 4)],
      ['v2', makeRating(28, 5)],
    ]);

    const results = aggregateByAgent(pool, ratings, buildParentRatingResolver(ratings));
    const generation = results.find(r => r.agentName === 'generation')!;

    // Each variant has 0 parents → sigmaDelta = variant.sigma only
    const ci1 = 1.96 * 4 * ELO_SCALE;
    const ci2 = 1.96 * 5 * ELO_SCALE;
    const expectedAvgCi = Math.sqrt(ci1 ** 2 + ci2 ** 2) / 2;

    expect(generation.avgCi).toBeCloseTo(expectedAvgCi);
  });

  it('computes correct totalGain and avgGain', () => {
    const pool: TextVariation[] = [
      makeVariant({ id: 'v1', strategy: 'structural_transform', parentIds: [] }),
      makeVariant({ id: 'v2', strategy: 'lexical_simplify', parentIds: [] }),
    ];

    const ratings = new Map<string, Rating>([
      ['v1', makeRating(30, 4)],
      ['v2', makeRating(20, 5)],
    ]);

    const results = aggregateByAgent(pool, ratings, buildParentRatingResolver(ratings));
    const generation = results.find(r => r.agentName === 'generation')!;

    const gain1 = (30 - DEFAULT_MU) * ELO_SCALE;
    const gain2 = (20 - DEFAULT_MU) * ELO_SCALE;

    expect(generation.totalGain).toBeCloseTo(gain1 + gain2);
    expect(generation.avgGain).toBeCloseTo((gain1 + gain2) / 2);
  });

  it('skips variants with unknown strategy', () => {
    const pool: TextVariation[] = [
      makeVariant({ id: 'v1', strategy: 'unknown_strategy', parentIds: [] }),
    ];

    const ratings = new Map<string, Rating>([
      ['v1', makeRating(30, 4)],
    ]);

    const results = aggregateByAgent(pool, ratings, buildParentRatingResolver(ratings));
    expect(results).toHaveLength(0);
  });

  it('handles iterativeEditing strategy prefix', () => {
    const pool: TextVariation[] = [
      makeVariant({ id: 'v1', strategy: 'critique_edit_clarity', parentIds: [] }),
    ];

    const ratings = new Map<string, Rating>([
      ['v1', makeRating(32, 4)],
    ]);

    const results = aggregateByAgent(pool, ratings, buildParentRatingResolver(ratings));
    expect(results).toHaveLength(1);
    expect(results[0].agentName).toBe('iterativeEditing');
  });
});

describe('buildParentRatingResolver', () => {
  it('returns parent ratings from map', () => {
    const ratings = new Map<string, Rating>([
      ['p1', makeRating(30, 4)],
      ['p2', makeRating(28, 5)],
    ]);

    const resolver = buildParentRatingResolver(ratings);
    const v = makeVariant({ id: 'v1', strategy: 'test', parentIds: ['p1', 'p2'] });
    const parents = resolver(v);

    expect(parents).toHaveLength(2);
    expect(parents[0].mu).toBe(30);
    expect(parents[1].mu).toBe(28);
  });

  it('falls back to default rating for missing parents', () => {
    const ratings = new Map<string, Rating>();
    const resolver = buildParentRatingResolver(ratings);
    const v = makeVariant({ id: 'v1', strategy: 'test', parentIds: ['missing'] });
    const parents = resolver(v);

    expect(parents).toHaveLength(1);
    expect(parents[0].mu).toBe(DEFAULT_MU);
  });
});
