// Unit tests for the centralized factor type registry.
// Verifies delegation to existing sources, ordering, expansion, and validation.

import { describe, it, expect } from '@jest/globals';
import { FACTOR_REGISTRY, ITERATION_LEVELS, EDITOR_OPTIONS } from './factorRegistry';
import { allowedLLMModelSchema } from '@/lib/schemas/schemas';
import { OPTIONAL_AGENTS } from '@evolution/lib/core/budgetRedistribution';

describe('FACTOR_REGISTRY', () => {
  it('contains exactly 5 factors', () => {
    expect(FACTOR_REGISTRY.size).toBe(5);
    expect([...FACTOR_REGISTRY.keys()]).toEqual([
      'genModel', 'judgeModel', 'iterations', 'supportAgents', 'editor',
    ]);
  });

  it('every factor has required interface methods', () => {
    for (const [key, def] of FACTOR_REGISTRY) {
      expect(def.key).toBe(key);
      expect(typeof def.label).toBe('string');
      expect(typeof def.type).toBe('string');
      expect(typeof def.getValidValues).toBe('function');
      expect(typeof def.orderValues).toBe('function');
      expect(typeof def.expandAroundWinner).toBe('function');
      expect(typeof def.validate).toBe('function');
      expect(typeof def.estimateCostImpact).toBe('function');
    }
  });
});

describe('genModel factor', () => {
  const factor = FACTOR_REGISTRY.get('genModel')!;

  it('delegates getValidValues to allowedLLMModelSchema', () => {
    const values = factor.getValidValues();
    expect(values).toEqual([...allowedLLMModelSchema.options]);
    expect(values.length).toBeGreaterThanOrEqual(10);
  });

  it('orders models by input price ascending', () => {
    const ordered = factor.orderValues(factor.getValidValues());
    // gpt-5-nano ($0.05) should be before gpt-4o ($2.50)
    const nanoIdx = ordered.indexOf('gpt-5-nano');
    const gpt4oIdx = ordered.indexOf('gpt-4o');
    expect(nanoIdx).toBeLessThan(gpt4oIdx);
  });

  it('validates allowed models', () => {
    expect(factor.validate('deepseek-chat')).toBe(true);
    expect(factor.validate('gpt-4.1-mini')).toBe(true);
    expect(factor.validate('invalid-model')).toBe(false);
  });

  it('expandAroundWinner returns 3 neighbors for mid-range model', () => {
    const expanded = factor.expandAroundWinner('gpt-4.1-mini');
    expect(expanded.length).toBeGreaterThanOrEqual(2);
    expect(expanded.length).toBeLessThanOrEqual(3);
    expect(expanded).toContain('gpt-4.1-mini');
  });

  it('expandAroundWinner handles boundary (cheapest model)', () => {
    const ordered = factor.orderValues(factor.getValidValues());
    const cheapest = ordered[0];
    const expanded = factor.expandAroundWinner(cheapest);
    expect(expanded).toContain(cheapest);
    // Should still have 2-3 entries (deduped if at boundary)
    expect(expanded.length).toBeGreaterThanOrEqual(1);
    expect(expanded.length).toBeLessThanOrEqual(3);
  });

  it('estimateCostImpact returns > 1 for expensive models', () => {
    const impact = factor.estimateCostImpact('gpt-4o');
    expect(impact).toBeGreaterThan(1);
  });

  it('estimateCostImpact returns ~1 for cheapest model', () => {
    const ordered = factor.orderValues(factor.getValidValues());
    const cheapest = ordered[0];
    const impact = factor.estimateCostImpact(cheapest);
    expect(impact).toBeCloseTo(1, 0);
  });
});

describe('judgeModel factor', () => {
  const factor = FACTOR_REGISTRY.get('judgeModel')!;

  it('shares valid values with genModel (same source)', () => {
    const genValues = FACTOR_REGISTRY.get('genModel')!.getValidValues();
    expect(factor.getValidValues()).toEqual(genValues);
  });
});

describe('iterations factor', () => {
  const factor = FACTOR_REGISTRY.get('iterations')!;

  it('returns curated iteration levels', () => {
    const values = factor.getValidValues();
    expect(values).toEqual([...ITERATION_LEVELS]);
    expect(values).toEqual([2, 3, 5, 8, 10, 15, 20, 30]);
  });

  it('validates within bounds', () => {
    expect(factor.validate(1)).toBe(true);
    expect(factor.validate(30)).toBe(true);
    expect(factor.validate(0)).toBe(false);
    expect(factor.validate(31)).toBe(false);
    expect(factor.validate(3.5)).toBe(false);
  });

  it('expandAroundWinner brackets a curated value', () => {
    const expanded = factor.expandAroundWinner(8);
    expect(expanded).toContain(5);
    expect(expanded).toContain(8);
    expect(expanded).toContain(10);
  });

  it('expandAroundWinner brackets a non-curated value', () => {
    const expanded = factor.expandAroundWinner(6);
    expect(expanded).toContain(5);
    expect(expanded).toContain(6);
    expect(expanded).toContain(8);
  });

  it('expandAroundWinner handles boundary (min)', () => {
    const expanded = factor.expandAroundWinner(2);
    expect(expanded).toContain(2);
    expect(expanded).toContain(3);
    expect(expanded.length).toBeLessThanOrEqual(3);
  });

  it('estimateCostImpact scales linearly', () => {
    expect(factor.estimateCostImpact(2)).toBe(1);
    expect(factor.estimateCostImpact(10)).toBe(5);
  });
});

describe('supportAgents factor', () => {
  const factor = FACTOR_REGISTRY.get('supportAgents')!;

  it('has binary valid values', () => {
    expect(factor.getValidValues()).toEqual(['off', 'on']);
  });

  it('validates on/off', () => {
    expect(factor.validate('on')).toBe(true);
    expect(factor.validate('off')).toBe(true);
    expect(factor.validate('maybe')).toBe(false);
  });

  it('expandAroundWinner always returns both', () => {
    expect(factor.expandAroundWinner('on')).toEqual(['off', 'on']);
  });

  it('estimateCostImpact is higher for on', () => {
    expect(factor.estimateCostImpact('on')).toBeGreaterThan(
      factor.estimateCostImpact('off'),
    );
  });
});

describe('editor factor', () => {
  const factor = FACTOR_REGISTRY.get('editor')!;

  it('has two editing approaches', () => {
    expect(factor.getValidValues()).toEqual([...EDITOR_OPTIONS]);
  });

  it('validates known approaches', () => {
    expect(factor.validate('iterativeEditing')).toBe(true);
    expect(factor.validate('treeSearch')).toBe(true);
    expect(factor.validate('unknown')).toBe(false);
  });

  it('expandAroundWinner returns both options', () => {
    expect(factor.expandAroundWinner('iterativeEditing')).toEqual([...EDITOR_OPTIONS]);
  });
});
