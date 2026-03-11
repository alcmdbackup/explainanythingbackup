// Unit tests for PipelineStateImpl.
// Verifies pool management, rating initialization, serialization round-trip, and backward compat.

import { PipelineStateImpl, serializeState, deserializeState, MAX_MATCH_HISTORY, MAX_CRITIQUE_ITERATIONS } from './state';
import type { TextVariation, SerializedPipelineState, Match, Critique } from '../types';
import { createRating } from './rating';

function makeVariation(id: string, strategy = 'test', iterationBorn = 0): TextVariation {
  return {
    id,
    text: `content-${id}`,
    version: 1,
    parentIds: [],
    strategy,
    createdAt: Date.now() / 1000,
    iterationBorn,
  };
}

function makeMatch(a: string, b: string): Match {
  return { variationA: a, variationB: b, winner: a, confidence: 0.8, turns: 1, dimensionScores: {} };
}

function makeCritique(variationId: string): Critique {
  return {
    variationId,
    dimensionScores: { clarity: 7 },
    goodExamples: {},
    badExamples: {},
    notes: {},
    reviewer: 'llm',
  };
}

describe('PipelineStateImpl', () => {
  describe('addToPool', () => {
    it('adds variant and initializes rating', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      expect(state.pool).toHaveLength(1);
      expect(state.poolIds.has('v1')).toBe(true);
      const r = state.ratings.get('v1');
      expect(r).toBeDefined();
      expect(r!.mu).toBeCloseTo(25, 0);
      expect(r!.sigma).toBeCloseTo(25 / 3, 1);
      expect(state.matchCounts.get('v1')).toBe(0);
    });

    it('tracks new entrants', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      state.addToPool(makeVariation('v2'));
      expect(state.newEntrantsThisIteration).toEqual(['v1', 'v2']);
    });

    it('ignores duplicate ids', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      state.addToPool(makeVariation('v1'));
      expect(state.pool).toHaveLength(1);
    });

    it('does not overwrite existing rating', () => {
      const state = new PipelineStateImpl('original');
      state.ratings.set('v1', { mu: 30, sigma: 3 });
      state.matchCounts.set('v1', 10);
      state.addToPool(makeVariation('v1'));
      expect(state.ratings.get('v1')!.mu).toBe(30);
      expect(state.matchCounts.get('v1')).toBe(10);
    });
  });

  describe('startNewIteration', () => {
    it('increments iteration and clears new entrants', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      expect(state.iteration).toBe(0);
      state.startNewIteration();
      expect(state.iteration).toBe(1);
      expect(state.newEntrantsThisIteration).toEqual([]);
    });
  });

  describe('getTopByRating', () => {
    it('returns top N by ordinal descending', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      state.addToPool(makeVariation('v2'));
      state.addToPool(makeVariation('v3'));
      state.ratings.set('v1', { mu: 20, sigma: 3 }); // mu = 20
      state.ratings.set('v2', { mu: 30, sigma: 3 }); // mu = 30
      state.ratings.set('v3', { mu: 25, sigma: 3 }); // mu = 25
      const top = state.getTopByRating(2);
      expect(top.map((v) => v.id)).toEqual(['v2', 'v3']);
    });

    it('returns pool slice when no ratings', () => {
      const state = new PipelineStateImpl('original');
      state.pool.push(makeVariation('v1'), makeVariation('v2'));
      state.ratings.clear();
      const top = state.getTopByRating(1);
      expect(top).toHaveLength(1);
      expect(top[0].id).toBe('v1');
    });

    it('handles empty pool', () => {
      const state = new PipelineStateImpl('original');
      expect(state.getTopByRating(5)).toEqual([]);
    });

    it('invalidates cache when addToPool is called', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      state.addToPool(makeVariation('v2'));
      state.ratings.set('v1', { mu: 30, sigma: 3 }); // mu = 30
      state.ratings.set('v2', { mu: 20, sigma: 3 }); // mu = 20
      state.invalidateCache();

      const top1 = state.getTopByRating(2);
      expect(top1.map((v) => v.id)).toEqual(['v1', 'v2']);

      // Add a new variant with highest rating — cache should be invalidated by addToPool
      state.addToPool(makeVariation('v3'));
      state.ratings.set('v3', { mu: 40, sigma: 3 }); // mu = 40
      state.invalidateCache();

      const top2 = state.getTopByRating(2);
      expect(top2.map((v) => v.id)).toEqual(['v3', 'v1']);
    });

    it('invalidates cache on startNewIteration', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      state.ratings.set('v1', { mu: 30, sigma: 3 });
      state.invalidateCache();

      const top1 = state.getTopByRating(1);
      expect(top1[0].id).toBe('v1');

      state.startNewIteration();
      state.addToPool(makeVariation('v2'));
      state.ratings.set('v2', { mu: 40, sigma: 3 });
      state.invalidateCache();

      const top2 = state.getTopByRating(1);
      expect(top2[0].id).toBe('v2');
    });

    it('returns cached result on repeated calls without mutation', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      state.addToPool(makeVariation('v2'));
      state.ratings.set('v1', { mu: 30, sigma: 3 });
      state.ratings.set('v2', { mu: 20, sigma: 3 });
      state.invalidateCache();

      const top1 = state.getTopByRating(2);
      const top2 = state.getTopByRating(1);
      // Second call should use cache — same underlying array, just sliced
      expect(top2).toEqual([top1[0]]);
    });
  });

  describe('getPoolSize', () => {
    it('returns pool length', () => {
      const state = new PipelineStateImpl('original');
      expect(state.getPoolSize()).toBe(0);
      state.addToPool(makeVariation('v1'));
      expect(state.getPoolSize()).toBe(1);
    });
  });
});

describe('serializeState / deserializeState', () => {
  it('round-trips state correctly', () => {
    const state = new PipelineStateImpl('hello world');
    state.addToPool(makeVariation('v1', 'structural'));
    state.addToPool(makeVariation('v2', 'lexical'));
    state.ratings.set('v1', { mu: 28, sigma: 5 });
    state.ratings.set('v2', { mu: 22, sigma: 6 });
    state.matchCounts.set('v1', 3);
    state.matchCounts.set('v2', 3);
    state.iteration = 2;
    state.matchHistory = [
      { variationA: 'v1', variationB: 'v2', winner: 'v1', confidence: 0.8, turns: 1, dimensionScores: {} },
    ];

    const serialized = serializeState(state);
    const restored = deserializeState(serialized);

    expect(restored.originalText).toBe('hello world');
    expect(restored.iteration).toBe(2);
    expect(restored.pool).toHaveLength(2);
    expect(restored.poolIds.size).toBe(2);
    expect(restored.ratings.get('v1')!.mu).toBe(28);
    expect(restored.ratings.get('v1')!.sigma).toBe(5);
    expect(restored.matchCounts.get('v1')).toBe(3);
    expect(restored.matchHistory).toHaveLength(1);
    expect(restored.debateTranscripts).toEqual([]);
  });

  it('round-trips debateTranscripts', () => {
    const state = new PipelineStateImpl('test');
    state.debateTranscripts = [{
      variantAId: 'v1',
      variantBId: 'v2',
      turns: [{ role: 'advocate_a', content: 'A is better' }],
      synthesisVariantId: 'v3',
      iteration: 1,
    }];

    const serialized = serializeState(state);
    expect(serialized.debateTranscripts).toHaveLength(1);

    const restored = deserializeState(serialized);
    expect(restored.debateTranscripts).toHaveLength(1);
    expect(restored.debateTranscripts[0].variantAId).toBe('v1');
    expect(restored.debateTranscripts[0].turns[0].role).toBe('advocate_a');
  });

  it('deserializes missing debateTranscripts as empty array', () => {
    const snapshot = serializeState(new PipelineStateImpl('test'));
    // Simulate old checkpoint without debateTranscripts
    const legacy = { ...snapshot } as Record<string, unknown>;
    delete legacy.debateTranscripts;
    const restored = deserializeState(legacy as never);
    expect(restored.debateTranscripts).toEqual([]);
  });
});

describe('treeSearchResults / treeSearchStates serialization', () => {
  it('round-trips treeSearchResults and treeSearchStates', () => {
    const state = new PipelineStateImpl('test');
    state.treeSearchResults = [{
      bestLeafNodeId: 'leaf-1',
      bestVariantId: 'v-leaf',
      revisionPath: [{ type: 'edit_dimension', dimension: 'clarity', description: 'Improve clarity' }],
      treeSize: 5,
      maxDepth: 2,
      prunedBranches: 3,
    }];
    state.treeSearchStates = [{
      rootNodeId: 'root-1',
      nodes: {
        'root-1': {
          id: 'root-1', variantId: 'v-root', parentNodeId: null,
          childNodeIds: ['leaf-1'], depth: 0,
          revisionAction: { type: 'edit_dimension', description: 'root' },
          value: 0, pruned: false,
        },
        'leaf-1': {
          id: 'leaf-1', variantId: 'v-leaf', parentNodeId: 'root-1',
          childNodeIds: [], depth: 1,
          revisionAction: { type: 'edit_dimension', dimension: 'clarity', description: 'Improve clarity' },
          value: 1, pruned: false,
        },
      },
    }];

    const serialized = serializeState(state);
    expect(serialized.treeSearchResults).toHaveLength(1);
    expect(serialized.treeSearchStates).toHaveLength(1);

    const restored = deserializeState(serialized);
    expect(restored.treeSearchResults).toHaveLength(1);
    expect(restored.treeSearchResults![0].bestLeafNodeId).toBe('leaf-1');
    expect(restored.treeSearchResults![0].revisionPath[0].type).toBe('edit_dimension');
    expect(restored.treeSearchStates).toHaveLength(1);
    expect(restored.treeSearchStates![0].nodes['leaf-1'].value).toBe(1);
    expect(restored.treeSearchStates![0].nodes['root-1'].childNodeIds).toEqual(['leaf-1']);
  });

  it('deserializes missing treeSearchResults as null (backward compat)', () => {
    const snapshot = serializeState(new PipelineStateImpl('test'));
    const legacy = { ...snapshot } as Record<string, unknown>;
    delete legacy.treeSearchResults;
    delete legacy.treeSearchStates;
    const restored = deserializeState(legacy as never);
    expect(restored.treeSearchResults).toBeNull();
    expect(restored.treeSearchStates).toBeNull();
  });

  it('preserves null treeSearchResults through round-trip', () => {
    const state = new PipelineStateImpl('test');
    expect(state.treeSearchResults).toBeNull();
    const serialized = serializeState(state);
    const restored = deserializeState(serialized);
    expect(restored.treeSearchResults).toBeNull();
    expect(restored.treeSearchStates).toBeNull();
  });
});

describe('backward compat: eloRatings deserialization', () => {
  it('converts old eloRatings snapshot to new ratings format', () => {
    const snapshot: SerializedPipelineState = {
      iteration: 5,
      originalText: 'test',
      pool: [makeVariation('v1'), makeVariation('v2')],
      newEntrantsThisIteration: [],
      ratings: {},
      eloRatings: { v1: 1400, v2: 1000 },
      matchCounts: { v1: 6, v2: 4 },
      matchHistory: [],
      dimensionScores: null,
      allCritiques: null,
      similarityMatrix: null,
      diversityScore: null,
      metaFeedback: null,
      debateTranscripts: [],
    };

    const state = deserializeState(snapshot);
    expect(state.ratings.has('v1')).toBe(true);
    expect(state.ratings.has('v2')).toBe(true);
    // Higher old Elo → higher mu
    expect(state.ratings.get('v1')!.mu).toBeGreaterThan(
      state.ratings.get('v2')!.mu,
    );
  });

  it('prefers new ratings format over legacy eloRatings', () => {
    const snapshot: SerializedPipelineState = {
      iteration: 5,
      originalText: 'test',
      pool: [makeVariation('v1')],
      newEntrantsThisIteration: [],
      ratings: { v1: { mu: 30, sigma: 4 } },
      eloRatings: { v1: 1000 },
      matchCounts: { v1: 5 },
      matchHistory: [],
      dimensionScores: null,
      allCritiques: null,
      similarityMatrix: null,
      diversityScore: null,
      metaFeedback: null,
      debateTranscripts: [],
    };

    const state = deserializeState(snapshot);
    // Should use new format (mu=30), not convert from eloRatings (1000)
    expect(state.ratings.get('v1')!.mu).toBe(30);
  });
});

// ─── Phase 11: Bounded State Growth ───────────────────────────────

describe('bounded matchHistory serialization', () => {
  it('serializes full matchHistory when under MAX_MATCH_HISTORY', () => {
    const state = new PipelineStateImpl('test');
    state.addToPool(makeVariation('v1'));
    state.addToPool(makeVariation('v2'));
    state.matchHistory = Array.from({ length: 100 }, (_, i) => makeMatch(`v${i % 2 + 1}`, `v${(i + 1) % 2 + 1}`));

    const serialized = serializeState(state);
    expect(serialized.matchHistory).toHaveLength(100);
  });

  it('truncates matchHistory to last MAX_MATCH_HISTORY entries', () => {
    const state = new PipelineStateImpl('test');
    state.addToPool(makeVariation('v1'));
    state.addToPool(makeVariation('v2'));
    const total = MAX_MATCH_HISTORY + 500;
    state.matchHistory = Array.from({ length: total }, (_, i) =>
      makeMatch(`v${i % 2 + 1}`, `v${(i + 1) % 2 + 1}`),
    );

    const serialized = serializeState(state);
    expect(serialized.matchHistory).toHaveLength(MAX_MATCH_HISTORY);
    // Should keep the LAST entries (tail)
    expect(serialized.matchHistory[0]).toEqual(state.matchHistory[500]);
    expect(serialized.matchHistory[MAX_MATCH_HISTORY - 1]).toEqual(state.matchHistory[total - 1]);
  });

  it('keeps full matchHistory in-memory after serialization', () => {
    const state = new PipelineStateImpl('test');
    state.addToPool(makeVariation('v1'));
    const total = MAX_MATCH_HISTORY + 100;
    state.matchHistory = Array.from({ length: total }, (_, i) => makeMatch('v1', 'v1'));

    serializeState(state);
    // In-memory state is unchanged
    expect(state.matchHistory).toHaveLength(total);
  });

  it('deserialized state works correctly with truncated history', () => {
    const state = new PipelineStateImpl('test');
    state.addToPool(makeVariation('v1'));
    state.addToPool(makeVariation('v2'));
    state.iteration = 3;
    state.ratings.set('v1', { mu: 28, sigma: 5 });
    state.ratings.set('v2', { mu: 22, sigma: 6 });
    state.matchCounts.set('v1', 3);
    state.matchCounts.set('v2', 3);
    const total = MAX_MATCH_HISTORY + 200;
    state.matchHistory = Array.from({ length: total }, (_, i) => makeMatch('v1', 'v2'));

    const serialized = serializeState(state);
    expect(serialized.matchHistory).toHaveLength(MAX_MATCH_HISTORY);

    const restored = deserializeState(serialized);
    expect(restored.matchHistory).toHaveLength(MAX_MATCH_HISTORY);
    expect(restored.iteration).toBe(3);
    expect(restored.ratings.get('v1')!.mu).toBe(28);
    expect(restored.pool).toHaveLength(2);
  });

  it('handles exactly MAX_MATCH_HISTORY entries without truncation', () => {
    const state = new PipelineStateImpl('test');
    state.addToPool(makeVariation('v1'));
    state.matchHistory = Array.from({ length: MAX_MATCH_HISTORY }, () => makeMatch('v1', 'v1'));

    const serialized = serializeState(state);
    expect(serialized.matchHistory).toHaveLength(MAX_MATCH_HISTORY);
  });
});

describe('bounded allCritiques serialization', () => {
  it('serializes all critiques when iteration < MAX_CRITIQUE_ITERATIONS', () => {
    const state = new PipelineStateImpl('test');
    state.iteration = 3; // < 5
    // Variants from iteration 0, 1, 2
    for (let i = 0; i < 3; i++) {
      state.addToPool(makeVariation(`v${i}`, 'test', i));
    }
    state.allCritiques = [makeCritique('v0'), makeCritique('v1'), makeCritique('v2')];

    const serialized = serializeState(state);
    expect(serialized.allCritiques).toHaveLength(3);
  });

  it('filters critiques to last MAX_CRITIQUE_ITERATIONS iterations', () => {
    const state = new PipelineStateImpl('test');
    state.iteration = 10;
    // Variants from iterations 0-10
    for (let i = 0; i <= 10; i++) {
      const v = makeVariation(`v${i}`, 'test', i);
      state.pool.push(v);
      state.poolIds.add(v.id);
    }
    // Critiques for all variants
    state.allCritiques = Array.from({ length: 11 }, (_, i) => makeCritique(`v${i}`));

    const serialized = serializeState(state);
    // iteration=10, MAX_CRITIQUE_ITERATIONS=5, minIteration = 10 - 5 + 1 = 6
    // Keep critiques for v6, v7, v8, v9, v10
    expect(serialized.allCritiques).toHaveLength(5);
    const ids = serialized.allCritiques!.map((c) => c.variationId);
    expect(ids).toEqual(['v6', 'v7', 'v8', 'v9', 'v10']);
  });

  it('keeps full allCritiques in-memory after serialization', () => {
    const state = new PipelineStateImpl('test');
    state.iteration = 10;
    for (let i = 0; i <= 10; i++) {
      const v = makeVariation(`v${i}`, 'test', i);
      state.pool.push(v);
      state.poolIds.add(v.id);
    }
    state.allCritiques = Array.from({ length: 11 }, (_, i) => makeCritique(`v${i}`));

    serializeState(state);
    // In-memory unchanged
    expect(state.allCritiques).toHaveLength(11);
  });

  it('preserves critiques for unknown variants (defensive)', () => {
    const state = new PipelineStateImpl('test');
    state.iteration = 10;
    // Only add recent variants to pool
    for (let i = 8; i <= 10; i++) {
      const v = makeVariation(`v${i}`, 'test', i);
      state.pool.push(v);
      state.poolIds.add(v.id);
    }
    // Critique for unknown variant (not in pool)
    state.allCritiques = [makeCritique('unknown'), makeCritique('v8'), makeCritique('v10')];

    const serialized = serializeState(state);
    // 'unknown' variant not in pool → kept (defensive)
    // v8 born at iteration 8 >= minIteration (6) → kept
    // v10 born at iteration 10 >= minIteration (6) → kept
    expect(serialized.allCritiques).toHaveLength(3);
  });

  it('handles null allCritiques', () => {
    const state = new PipelineStateImpl('test');
    state.iteration = 10;
    state.allCritiques = null;

    const serialized = serializeState(state);
    expect(serialized.allCritiques).toBeNull();
  });

  it('handles empty allCritiques', () => {
    const state = new PipelineStateImpl('test');
    state.iteration = 10;
    state.allCritiques = [];

    const serialized = serializeState(state);
    expect(serialized.allCritiques).toEqual([]);
  });
});

describe('lastSyncedMatchIndex serialization', () => {
  it('serializes lastSyncedMatchIndex', () => {
    const state = new PipelineStateImpl('test');
    state.lastSyncedMatchIndex = 42;
    const serialized = serializeState(state);
    expect(serialized.lastSyncedMatchIndex).toBe(42);
  });

  it('deserializes lastSyncedMatchIndex', () => {
    const state = new PipelineStateImpl('test');
    state.lastSyncedMatchIndex = 42;
    const serialized = serializeState(state);
    const restored = deserializeState(serialized);
    expect(restored.lastSyncedMatchIndex).toBe(42);
  });

  it('defaults to 0 when lastSyncedMatchIndex is missing (backward compat)', () => {
    const snapshot: SerializedPipelineState = {
      iteration: 1,
      originalText: 'test',
      pool: [],
      newEntrantsThisIteration: [],
      ratings: {},
      matchCounts: {},
      matchHistory: [],
      dimensionScores: null,
      allCritiques: null,
      similarityMatrix: null,
      diversityScore: null,
      metaFeedback: null,
      debateTranscripts: [],
    };
    const state = deserializeState(snapshot);
    expect(state.lastSyncedMatchIndex).toBe(0);
  });

  it('defaults to 0 on new PipelineStateImpl', () => {
    const state = new PipelineStateImpl('test');
    expect(state.lastSyncedMatchIndex).toBe(0);
  });
});
