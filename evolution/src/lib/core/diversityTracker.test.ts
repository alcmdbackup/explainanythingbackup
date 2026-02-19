// Unit tests for PoolDiversityTracker — threshold-based status, recommendations, lineage/strategy counting, trends.

import { PoolDiversityTracker, DIVERSITY_THRESHOLDS } from './diversityTracker';
import { PipelineStateImpl } from './state';
import type { TextVariation } from '../types';

function makeVariation(overrides: Partial<TextVariation> = {}): TextVariation {
  const id = overrides.id ?? `v-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    text: `Text for ${id}`,
    version: 1,
    parentIds: [],
    strategy: 'structural_transform',
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
    ...overrides,
  };
}

function makeStateWithPool(variants: TextVariation[]): PipelineStateImpl {
  const state = new PipelineStateImpl('original');
  for (const v of variants) {
    state.addToPool(v);
  }
  return state;
}

describe('PoolDiversityTracker', () => {
  const tracker = new PoolDiversityTracker();

  describe('status', () => {
    it('returns HEALTHY for score >= 0.4', () => {
      expect(tracker.status(0.5)).toBe('HEALTHY');
      expect(tracker.status(0.4)).toBe('HEALTHY');
      expect(tracker.status(1.0)).toBe('HEALTHY');
    });

    it('returns LOW for score >= 0.2 and < 0.4', () => {
      expect(tracker.status(0.3)).toBe('LOW');
      expect(tracker.status(0.2)).toBe('LOW');
    });

    it('returns CRITICAL for score >= 0.1 and < 0.2', () => {
      expect(tracker.status(0.15)).toBe('CRITICAL');
      expect(tracker.status(0.1)).toBe('CRITICAL');
    });

    it('returns COLLAPSED for score < 0.1', () => {
      expect(tracker.status(0.05)).toBe('COLLAPSED');
      expect(tracker.status(0.0)).toBe('COLLAPSED');
    });
  });

  describe('getRecommendations', () => {
    it('recommends exploration for critical diversity', () => {
      const state = makeStateWithPool([makeVariation()]);
      state.diversityScore = 0.05;
      const recs = tracker.getRecommendations(state);
      expect(recs).toContain('Force exploration mode in generation');
      expect(recs).toContain('Skip evolution, focus on fresh variants');
    });

    it('recommends mutation for low diversity', () => {
      const state = makeStateWithPool([makeVariation()]);
      state.diversityScore = 0.25;
      const recs = tracker.getRecommendations(state);
      expect(recs).toContain('Increase exploration rate');
      expect(recs).toContain('Consider mutation operators');
    });

    it('detects dominant lineage', () => {
      const root = makeVariation({ id: 'root-1', strategy: 'structural_transform' });
      const variants = [
        root,
        ...Array.from({ length: 6 }, (_, i) =>
          makeVariation({ id: `child-${i}`, parentIds: ['root-1'], strategy: 'structural_transform' }),
        ),
      ];
      const state = makeStateWithPool(variants);
      state.diversityScore = 0.5;
      const recs = tracker.getRecommendations(state);
      expect(recs.some((r) => r.includes('dominates'))).toBe(true);
    });

    it('detects low strategy diversity', () => {
      const variants = Array.from({ length: 8 }, (_, i) =>
        makeVariation({ id: `v-${i}`, strategy: i < 4 ? 'A' : 'B' }),
      );
      const state = makeStateWithPool(variants);
      state.diversityScore = 0.5;
      const recs = tracker.getRecommendations(state);
      expect(recs).toContain('Low strategy diversity - try different approaches');
    });

    it('returns no recommendations for healthy pool', () => {
      const variants = Array.from({ length: 6 }, (_, i) =>
        makeVariation({ id: `v-${i}`, strategy: ['A', 'B', 'C'][i % 3] }),
      );
      const state = makeStateWithPool(variants);
      state.diversityScore = 0.6;
      const recs = tracker.getRecommendations(state);
      expect(recs.length).toBe(0);
    });
  });

  describe('_findRoot', () => {
    it('returns own id for root variant', () => {
      const v = makeVariation({ id: 'root' });
      const state = makeStateWithPool([v]);
      expect(tracker._findRoot(v, state)).toBe('root');
    });

    it('traces lineage to root', () => {
      const root = makeVariation({ id: 'root' });
      const child = makeVariation({ id: 'child', parentIds: ['root'] });
      const grandchild = makeVariation({ id: 'grandchild', parentIds: ['child'] });
      const state = makeStateWithPool([root, child, grandchild]);
      expect(tracker._findRoot(grandchild, state)).toBe('root');
    });

    it('handles missing parent gracefully', () => {
      const orphan = makeVariation({ id: 'orphan', parentIds: ['missing'] });
      const state = makeStateWithPool([orphan]);
      expect(tracker._findRoot(orphan, state)).toBe('orphan');
    });

    it('handles circular reference', () => {
      const a = makeVariation({ id: 'a', parentIds: ['b'] });
      const b = makeVariation({ id: 'b', parentIds: ['a'] });
      const state = makeStateWithPool([a, b]);
      // Should not infinite loop — returns either a or b
      const root = tracker._findRoot(a, state);
      expect(['a', 'b']).toContain(root);
    });
  });

  describe('computeTrend', () => {
    it('returns stable for single-element history', () => {
      expect(tracker.computeTrend([0.5])).toBe('stable');
    });

    it('returns improving for increasing scores', () => {
      expect(tracker.computeTrend([0.2, 0.3, 0.5, 0.7])).toBe('improving');
    });

    it('returns declining for decreasing scores', () => {
      expect(tracker.computeTrend([0.8, 0.7, 0.4, 0.2])).toBe('declining');
    });

    it('returns stable for flat scores', () => {
      expect(tracker.computeTrend([0.5, 0.5, 0.5, 0.5])).toBe('stable');
    });
  });

  describe('DIVERSITY_THRESHOLDS', () => {
    it('exports expected thresholds', () => {
      expect(DIVERSITY_THRESHOLDS.HEALTHY).toBe(0.4);
      expect(DIVERSITY_THRESHOLDS.LOW).toBe(0.2);
      expect(DIVERSITY_THRESHOLDS.CRITICAL).toBe(0.1);
    });
  });
});
