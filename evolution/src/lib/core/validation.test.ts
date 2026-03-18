// Tests for state validation: validateStateContracts, validateStateIntegrity, validatePoolAppendOnly.

import { validateStateContracts, validateStateIntegrity, validatePoolAppendOnly } from './validation';
import type { ReadonlyPipelineState, AgentStepPhase } from '../types';

function makeState(overrides: Partial<ReadonlyPipelineState> = {}): ReadonlyPipelineState {
  const pool = overrides.pool ?? [
    { id: 'v1', text: 'text1', version: 1, parentIds: [], strategy: 'gen', createdAt: 1, iterationBorn: 1 },
    { id: 'v2', text: 'text2', version: 1, parentIds: ['v1'], strategy: 'gen', createdAt: 2, iterationBorn: 1 },
  ];
  const poolIds = overrides.poolIds ?? new Set(pool.map((v) => v.id));
  return {
    originalText: 'original',
    pool,
    poolIds,
    iteration: 1,
    newEntrantsThisIteration: [],
    ratings: overrides.ratings ?? new Map([['v1', { mu: 25, sigma: 8 }], ['v2', { mu: 26, sigma: 7 }]]),
    matchCounts: new Map(),
    matchHistory: overrides.matchHistory ?? [{ variantA: 'v1', variantB: 'v2', winner: 'v1', confidence: 0.8 }],
    dimensionScores: overrides.dimensionScores ?? null,
    allCritiques: overrides.allCritiques ?? [],
    diversityScore: overrides.diversityScore ?? 0,
    metaFeedback: overrides.metaFeedback ?? null,
    lastSyncedMatchIndex: 0,
    getTopByRating: () => [],
    getVariationById: () => undefined,
    getPoolSize: () => pool.length,
    hasVariant: (id: string) => poolIds.has(id),
    similarityMatrix: null,
    debateTranscripts: [],
    ...overrides,
  } as unknown as ReadonlyPipelineState;
}

describe('validateStateContracts', () => {
  it('returns empty array for valid state at phase 0', () => {
    expect(validateStateContracts(makeState(), 0 as AgentStepPhase)).toEqual([]);
  });

  it('detects pool/poolIds size mismatch', () => {
    const state = makeState({ poolIds: new Set(['v1']) }); // missing v2
    const violations = validateStateContracts(state, 0 as AgentStepPhase);
    expect(violations).toContainEqual(expect.stringContaining('Pool size mismatch'));
  });

  it('detects variant in pool but not in poolIds', () => {
    const state = makeState({ poolIds: new Set(['v1']) }); // v2 not in poolIds
    const violations = validateStateContracts(state, 0 as AgentStepPhase);
    expect(violations.some((v) => v.includes('in pool but not in poolIds'))).toBe(true);
  });

  it('detects dangling parent reference', () => {
    const pool = [
      { id: 'v1', text: 't', version: 1, parentIds: ['nonexistent'], strategy: 'gen', createdAt: 1, iterationBorn: 1 },
    ];
    const state = makeState({ pool, poolIds: new Set(['v1']) });
    const violations = validateStateContracts(state, 0 as AgentStepPhase);
    expect(violations.some((v) => v.includes('parentId nonexistent not in pool'))).toBe(true);
  });

  it('detects missing ratings at phase 1', () => {
    const state = makeState({ ratings: new Map() });
    const violations = validateStateContracts(state, 1 as AgentStepPhase);
    expect(violations).toContainEqual(expect.stringContaining('no ratings'));
  });

  it('detects missing rating for pool member at phase 1', () => {
    const state = makeState({ ratings: new Map([['v1', { mu: 25, sigma: 8 }]]) }); // v2 missing
    const violations = validateStateContracts(state, 1 as AgentStepPhase);
    expect(violations.some((v) => v.includes('No rating for pool member v2'))).toBe(true);
  });

  it('detects empty matchHistory at phase 2', () => {
    const state = makeState({ matchHistory: [] });
    const violations = validateStateContracts(state, 2 as AgentStepPhase);
    expect(violations).toContainEqual(expect.stringContaining('no matchHistory'));
  });

  it('detects missing dimensionScores at phase 3', () => {
    const state = makeState({ dimensionScores: null, allCritiques: [] });
    const violations = validateStateContracts(state, 3 as AgentStepPhase);
    expect(violations).toContainEqual(expect.stringContaining('no dimensionScores'));
  });
});

describe('validateStateIntegrity', () => {
  it('returns empty for valid state', () => {
    expect(validateStateIntegrity(makeState())).toEqual([]);
  });

  it('detects orphan in poolIds', () => {
    const state = makeState({ poolIds: new Set(['v1', 'v2', 'v3']) }); // v3 not in pool
    const violations = validateStateIntegrity(state);
    expect(violations.some((v) => v.includes('v3 with no corresponding variant'))).toBe(true);
  });

  it('detects rating for unknown variant', () => {
    const ratings = new Map([['v1', { mu: 25, sigma: 8 }], ['unknown', { mu: 25, sigma: 8 }]]);
    const state = makeState({ ratings });
    const violations = validateStateIntegrity(state);
    expect(violations.some((v) => v.includes('ratings contains key unknown'))).toBe(true);
  });
});

describe('validatePoolAppendOnly', () => {
  it('returns empty when pool grew', () => {
    expect(validatePoolAppendOnly(['v1', 'v2'], ['v1', 'v2', 'v3'])).toEqual([]);
  });

  it('returns empty when pool unchanged', () => {
    expect(validatePoolAppendOnly(['v1'], ['v1'])).toEqual([]);
  });

  it('detects removed variant', () => {
    const violations = validatePoolAppendOnly(['v1', 'v2'], ['v1']);
    expect(violations).toContainEqual(expect.stringContaining('v2 was removed'));
  });
});
