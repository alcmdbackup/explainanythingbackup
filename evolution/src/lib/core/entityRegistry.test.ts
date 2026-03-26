// Tests for entityRegistry: lazy init, singleton, 6 entity types, validation, helpers.

import {
  getEntity,
  getEntityMetrics,
  validateEntityRegistry,
  getAllEntityMetricDefs,
  getEntityListViewMetrics,
  getEntityMetricDef,
  isValidEntityMetricName,
  _resetRegistryForTesting,
} from './entityRegistry';
import type { EntityType } from './types';

const ALL_ENTITY_TYPES: EntityType[] = ['run', 'strategy', 'experiment', 'variant', 'invocation', 'prompt'];

describe('entityRegistry', () => {
  beforeEach(() => {
    _resetRegistryForTesting();
  });

  // ─── Lazy Initialization ─────────────────────────────────────

  describe('lazy initialization', () => {
    it('initializes registry on first getEntity call', () => {
      const entity = getEntity('run');
      expect(entity).toBeDefined();
    });

    it('returns same entity instance on subsequent calls (singleton)', () => {
      const first = getEntity('run');
      const second = getEntity('run');
      expect(first).toBe(second);
    });

    it('resets correctly via _resetRegistryForTesting', () => {
      const first = getEntity('run');
      _resetRegistryForTesting();
      const second = getEntity('run');
      // After reset, a new instance should be created
      expect(first).not.toBe(second);
    });
  });

  // ─── Entity Types ────────────────────────────────────────────

  describe('entity types', () => {
    it.each(ALL_ENTITY_TYPES)('returns entity for type "%s"', (type) => {
      const entity = getEntity(type);
      expect(entity).toBeDefined();
      expect(entity.metrics).toBeDefined();
    });

    it('all entities have duringExecution metrics array', () => {
      for (const type of ALL_ENTITY_TYPES) {
        const metrics = getEntityMetrics(type);
        expect(Array.isArray(metrics.duringExecution)).toBe(true);
      }
    });

    it('all entities have atFinalization metrics array', () => {
      for (const type of ALL_ENTITY_TYPES) {
        const metrics = getEntityMetrics(type);
        expect(Array.isArray(metrics.atFinalization)).toBe(true);
      }
    });

    it('all entities have atPropagation metrics array', () => {
      for (const type of ALL_ENTITY_TYPES) {
        const metrics = getEntityMetrics(type);
        expect(Array.isArray(metrics.atPropagation)).toBe(true);
      }
    });
  });

  // ─── getEntityMetrics ────────────────────────────────────────

  describe('getEntityMetrics', () => {
    it('returns metric registry for entity type', () => {
      const metrics = getEntityMetrics('run');
      expect(metrics).toBeDefined();
      expect(metrics.duringExecution).toBeDefined();
      expect(metrics.atFinalization).toBeDefined();
      expect(metrics.atPropagation).toBeDefined();
    });

    it('returns same metrics as entity.metrics', () => {
      const entity = getEntity('run');
      const metrics = getEntityMetrics('run');
      expect(metrics).toBe(entity.metrics);
    });
  });

  // ─── Validation ──────────────────────────────────────────────

  describe('validateEntityRegistry', () => {
    it('does not throw for valid registry', () => {
      // Initialize the registry first
      getEntity('run');
      expect(() => validateEntityRegistry()).not.toThrow();
    });

    it('returns silently when registry is not initialized', () => {
      // After reset, registry is null
      expect(() => validateEntityRegistry()).not.toThrow();
    });

    it('validates no duplicate metric names within entity', () => {
      // The real registry should have no duplicates
      getEntity('run');
      expect(() => validateEntityRegistry()).not.toThrow();
    });

    it('validates propagation source entities exist', () => {
      // The real registry should have valid propagation sources
      getEntity('strategy');
      expect(() => validateEntityRegistry()).not.toThrow();
    });
  });

  // ─── getAllEntityMetricDefs ───────────────────────────────────

  describe('getAllEntityMetricDefs', () => {
    it('returns combined metrics from all timing phases', () => {
      const defs = getAllEntityMetricDefs('run');
      const metrics = getEntityMetrics('run');
      const expectedLength =
        metrics.duringExecution.length +
        metrics.atFinalization.length +
        metrics.atPropagation.length;
      expect(defs).toHaveLength(expectedLength);
    });

    it('returns array of CatalogMetricDef objects', () => {
      const defs = getAllEntityMetricDefs('run');
      expect(defs.length).toBeGreaterThan(0);
      for (const def of defs) {
        expect(def).toHaveProperty('name');
      }
    });

    it.each(ALL_ENTITY_TYPES)('returns defs array for "%s"', (type) => {
      const defs = getAllEntityMetricDefs(type);
      expect(Array.isArray(defs)).toBe(true);
    });
  });

  // ─── getEntityListViewMetrics ────────────────────────────────

  describe('getEntityListViewMetrics', () => {
    it('returns only metrics with listView=true', () => {
      const listMetrics = getEntityListViewMetrics('run');
      for (const def of listMetrics) {
        expect(def.listView).toBe(true);
      }
    });

    it('returns subset of all metric defs', () => {
      const all = getAllEntityMetricDefs('run');
      const listView = getEntityListViewMetrics('run');
      expect(listView.length).toBeLessThanOrEqual(all.length);
    });

    it('does not include cost in run list view (cost shown via server action)', () => {
      const names = getEntityListViewMetrics('run').map(d => d.name);
      expect(names).not.toContain('cost');
    });
  });

  // ─── getEntityMetricDef ──────────────────────────────────────

  describe('getEntityMetricDef', () => {
    it('returns definition for known metric name', () => {
      const def = getEntityMetricDef('run', 'cost');
      expect(def).toBeDefined();
      expect(def!.name).toBe('cost');
    });

    it('returns undefined for unknown metric name', () => {
      const def = getEntityMetricDef('run', 'nonexistent_metric_xyz');
      expect(def).toBeUndefined();
    });

    it('finds metrics across all timing phases', () => {
      // Should find metrics regardless of timing
      const allDefs = getAllEntityMetricDefs('run');
      for (const expected of allDefs) {
        const found = getEntityMetricDef('run', expected.name);
        expect(found).toBeDefined();
        expect(found!.name).toBe(expected.name);
      }
    });
  });

  // ─── isValidEntityMetricName ─────────────────────────────────

  describe('isValidEntityMetricName', () => {
    it('returns true for known metric name', () => {
      expect(isValidEntityMetricName('run', 'cost')).toBe(true);
    });

    it('returns false for unknown static metric name', () => {
      expect(isValidEntityMetricName('run', 'nonexistent_metric_xyz')).toBe(false);
    });

    it('returns true for dynamic metric names (containing colon)', () => {
      expect(isValidEntityMetricName('run', 'custom:something')).toBe(true);
    });

    it('returns true for all defined metrics', () => {
      for (const type of ALL_ENTITY_TYPES) {
        const defs = getAllEntityMetricDefs(type);
        for (const def of defs) {
          expect(isValidEntityMetricName(type, def.name)).toBe(true);
        }
      }
    });
  });
});
