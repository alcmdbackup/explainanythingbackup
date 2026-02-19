// Unit tests for outline generation types: isOutlineVariant type guard, parseStepScore, and serialization.
// Validates type discrimination, score parsing edge cases, and backward compatibility.

import { isOutlineVariant, parseStepScore } from './types';
import type { TextVariation, OutlineVariant, GenerationStep } from './types';
import { PipelineStateImpl, serializeState, deserializeState } from './core/state';

function makePlainVariation(id = 'plain-1'): TextVariation {
  return {
    id,
    text: 'plain text',
    version: 1,
    parentIds: [],
    strategy: 'structural_transform',
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
  };
}

function makeOutlineVariant(id = 'outline-1'): OutlineVariant {
  const steps: GenerationStep[] = [
    { name: 'outline', input: 'original', output: '## Section 1\nSummary', score: 0.85, costUsd: 0.001 },
    { name: 'expand', input: '## Section 1\nSummary', output: 'Expanded text here.', score: 0.7, costUsd: 0.002 },
    { name: 'polish', input: 'Expanded text here.', output: 'Polished text here.', score: 0.9, costUsd: 0.001 },
  ];
  return {
    id,
    text: 'Polished text here.',
    version: 1,
    parentIds: [],
    strategy: 'outline_generation',
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
    costUsd: 0.004,
    steps,
    outline: '## Section 1\nSummary',
    weakestStep: 'expand',
  };
}

describe('isOutlineVariant', () => {
  it('returns true for a valid OutlineVariant', () => {
    expect(isOutlineVariant(makeOutlineVariant())).toBe(true);
  });

  it('returns false for a plain TextVariation', () => {
    expect(isOutlineVariant(makePlainVariation())).toBe(false);
  });

  it('returns false when steps is empty array', () => {
    const variant = { ...makeOutlineVariant(), steps: [] };
    expect(isOutlineVariant(variant)).toBe(false);
  });

  it('returns false when steps is missing', () => {
    const variant = makePlainVariation();
    expect(isOutlineVariant(variant)).toBe(false);
  });

  it('returns false when steps items lack name field', () => {
    const variant = {
      ...makePlainVariation(),
      steps: [{ input: 'x', output: 'y', score: 0.5, costUsd: 0 }],
      outline: 'outline',
      weakestStep: null,
    } as unknown as TextVariation;
    expect(isOutlineVariant(variant)).toBe(false);
  });

  it('narrows type correctly for TypeScript', () => {
    const variant: TextVariation = makeOutlineVariant();
    if (isOutlineVariant(variant)) {
      // TypeScript should allow accessing OutlineVariant fields
      expect(variant.steps).toHaveLength(3);
      expect(variant.outline).toBeDefined();
      expect(variant.weakestStep).toBe('expand');
    } else {
      fail('Expected isOutlineVariant to return true');
    }
  });
});

describe('parseStepScore', () => {
  it('parses a simple float', () => {
    expect(parseStepScore('0.85')).toBeCloseTo(0.85);
  });

  it('parses "0.8/1" by extracting leading float', () => {
    expect(parseStepScore('0.8/1')).toBeCloseTo(0.8);
  });

  it('parses "1" as 1.0', () => {
    expect(parseStepScore('1')).toBe(1);
  });

  it('parses "0" as 0.0', () => {
    expect(parseStepScore('0')).toBe(0);
  });

  it('clamps values above 1 to 1', () => {
    expect(parseStepScore('1.5')).toBe(1);
  });

  it('clamps values below 0 to 0', () => {
    expect(parseStepScore('-0.3')).toBe(0);
  });

  it('defaults to 0.5 for non-numeric text', () => {
    expect(parseStepScore('great')).toBe(0.5);
  });

  it('defaults to 0.5 for empty string', () => {
    expect(parseStepScore('')).toBe(0.5);
  });

  it('defaults to 0.5 for NaN-producing input', () => {
    expect(parseStepScore('NaN')).toBe(0.5);
  });

  it('defaults to 0.5 for Infinity', () => {
    expect(parseStepScore('Infinity')).toBe(0.5);
  });

  it('handles whitespace-padded numbers', () => {
    expect(parseStepScore('  0.75  ')).toBeCloseTo(0.75);
  });
});

describe('OutlineVariant serialization', () => {
  it('round-trips through PipelineState serialize/deserialize', () => {
    const state = new PipelineStateImpl('original text');
    const outlineVariant = makeOutlineVariant('ov-1');
    state.addToPool(outlineVariant);
    state.addToPool(makePlainVariation('pv-1'));

    const serialized = serializeState(state);
    const restored = deserializeState(serialized);

    // Both variants present
    expect(restored.pool).toHaveLength(2);

    // OutlineVariant preserved with step data
    const restoredOutline = restored.pool.find(v => v.id === 'ov-1')!;
    expect(isOutlineVariant(restoredOutline)).toBe(true);
    if (isOutlineVariant(restoredOutline)) {
      expect(restoredOutline.steps).toHaveLength(3);
      expect(restoredOutline.steps[0].name).toBe('outline');
      expect(restoredOutline.steps[0].score).toBeCloseTo(0.85);
      expect(restoredOutline.outline).toBe('## Section 1\nSummary');
      expect(restoredOutline.weakestStep).toBe('expand');
    }

    // Plain TextVariation unchanged
    const restoredPlain = restored.pool.find(v => v.id === 'pv-1')!;
    expect(isOutlineVariant(restoredPlain)).toBe(false);
  });

  it('handles old checkpoint without outline variants (backward compat)', () => {
    const state = new PipelineStateImpl('old text');
    state.addToPool(makePlainVariation('old-v1'));
    state.addToPool(makePlainVariation('old-v2'));

    const serialized = serializeState(state);
    const restored = deserializeState(serialized);

    expect(restored.pool).toHaveLength(2);
    for (const v of restored.pool) {
      expect(isOutlineVariant(v)).toBe(false);
    }
  });

  it('preserves costUsd on OutlineVariant', () => {
    const state = new PipelineStateImpl('text');
    const ov = makeOutlineVariant('cost-test');
    ov.costUsd = 0.0123;
    state.addToPool(ov);

    const serialized = serializeState(state);
    const restored = deserializeState(serialized);
    const restoredOv = restored.pool[0];

    expect(restoredOv.costUsd).toBeCloseTo(0.0123);
  });

  it('serializes to JSON and back preserving all step fields', () => {
    const variant = makeOutlineVariant('json-test');
    const json = JSON.stringify(variant);
    const parsed = JSON.parse(json) as OutlineVariant;

    expect(isOutlineVariant(parsed)).toBe(true);
    expect(parsed.steps).toHaveLength(3);
    expect(parsed.steps[1].name).toBe('expand');
    expect(parsed.steps[1].score).toBeCloseTo(0.7);
    expect(parsed.steps[1].costUsd).toBeCloseTo(0.002);
    expect(parsed.outline).toBe('## Section 1\nSummary');
    expect(parsed.weakestStep).toBe('expand');
  });
});
