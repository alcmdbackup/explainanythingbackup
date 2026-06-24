// Unit tests for the Judge Rubrics weight helpers (T21 regression).
import { evenSplit, hydrateDimensionWeights } from './rubricWeights';

const d = (criteria_id: string, weight: number) => ({ criteria_id, weight });

describe('hydrateDimensionWeights (T21)', () => {
  it('scales a 0–1 fraction set (sum≈1) to 0–100 summing to exactly 100', () => {
    const out = hydrateDimensionWeights([
      d('a', 0.17296817485878563),
      d('b', 0.29818540818191736),
      d('c', 0.5288464169592971),
    ]);
    expect(out.map((x) => x.weight)).toEqual([17, 30, 53]);
    expect(out.reduce((s, x) => s + x.weight, 0)).toBe(100);
  });

  it('leaves an already-0–100 set unchanged (no double-scaling)', () => {
    const input = [d('a', 33), d('b', 33), d('c', 34)];
    expect(hydrateDimensionWeights(input)).toEqual(input);
  });

  it('converts a single 0–1 dimension (1.0) to 100', () => {
    expect(hydrateDimensionWeights([d('a', 1)])).toEqual([d('a', 100)]);
  });

  it('puts the rounding remainder on the first dim so the result sums to exactly 100', () => {
    // 0.333/0.333/0.334 → naive round = 33/33/33 = 99; remainder (+1) lands on first.
    const out = hydrateDimensionWeights([d('a', 0.333), d('b', 0.333), d('c', 0.334)]);
    expect(out.reduce((s, x) => s + x.weight, 0)).toBe(100);
    expect(out[0]!.weight).toBe(34);
  });

  it('passes through degenerate/empty input', () => {
    expect(hydrateDimensionWeights([])).toEqual([]);
    // all-zero (sum < 0.5) is not treated as fractions → left as-is, not fabricated to 100.
    expect(hydrateDimensionWeights([d('a', 0), d('b', 0)])).toEqual([d('a', 0), d('b', 0)]);
  });
});

describe('evenSplit', () => {
  it('distributes 100 with the remainder on the first dim', () => {
    const out = evenSplit([d('a', 0), d('b', 0), d('c', 0)]);
    expect(out.map((x) => x.weight)).toEqual([34, 33, 33]);
    expect(out.reduce((s, x) => s + x.weight, 0)).toBe(100);
  });
});
