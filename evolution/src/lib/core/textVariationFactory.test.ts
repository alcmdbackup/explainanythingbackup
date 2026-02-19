// Tests for the TextVariation factory — verifies defaults, required fields, unique IDs, and optional overrides.
import { createTextVariation } from './textVariationFactory';

describe('createTextVariation', () => {
  it('creates a variation with required fields', () => {
    const v = createTextVariation({ text: 'hello', strategy: 'test', iterationBorn: 1 });
    expect(v.id).toBeDefined();
    expect(v.text).toBe('hello');
    expect(v.strategy).toBe('test');
    expect(v.iterationBorn).toBe(1);
    expect(typeof v.createdAt).toBe('number');
    // createdAt should be epoch seconds (not ms)
    expect(v.createdAt).toBeLessThan(Date.now());
    expect(v.createdAt).toBeGreaterThan(Date.now() / 1000 - 10);
  });

  it('defaults parentIds to empty array', () => {
    const v = createTextVariation({ text: 'x', strategy: 's', iterationBorn: 0 });
    expect(v.parentIds).toEqual([]);
  });

  it('defaults version to 0', () => {
    const v = createTextVariation({ text: 'x', strategy: 's', iterationBorn: 0 });
    expect(v.version).toBe(0);
  });

  it('accepts optional parentIds and version', () => {
    const v = createTextVariation({
      text: 'x',
      strategy: 's',
      iterationBorn: 2,
      parentIds: ['p1', 'p2'],
      version: 5,
    });
    expect(v.parentIds).toEqual(['p1', 'p2']);
    expect(v.version).toBe(5);
  });

  it('accepts optional costUsd', () => {
    const v = createTextVariation({ text: 'x', strategy: 's', iterationBorn: 0, costUsd: 0.05 });
    expect(v.costUsd).toBe(0.05);
  });

  it('omits costUsd when not provided', () => {
    const v = createTextVariation({ text: 'x', strategy: 's', iterationBorn: 0 });
    expect(v.costUsd).toBeUndefined();
  });

  it('generates a unique id on each call', () => {
    const a = createTextVariation({ text: 'x', strategy: 's', iterationBorn: 0 });
    const b = createTextVariation({ text: 'x', strategy: 's', iterationBorn: 0 });
    expect(a.id).not.toBe(b.id);
  });
});
