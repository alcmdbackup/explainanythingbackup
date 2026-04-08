// Tests for SeededRandom and deriveSeed: determinism, distribution, parallel-safety.
// Uses BigInt() constructors instead of literal `n` syntax (project tsc target ES2017).

import { SeededRandom, deriveSeed } from './seededRandom';

describe('SeededRandom', () => {
  it('produces deterministic sequences for the same seed', () => {
    const a = new SeededRandom(BigInt(42));
    const b = new SeededRandom(BigInt(42));
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRandom(BigInt(1));
    const b = new SeededRandom(BigInt(2));
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('next() returns values in [0, 1)', () => {
    const rng = new SeededRandom(BigInt(123));
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('handles seed=0 without producing all zeros', () => {
    const rng = new SeededRandom(BigInt(0));
    const values = Array.from({ length: 5 }, () => rng.next());
    // None should be 0 (state was non-zero after the fallback constant).
    expect(values.every((v) => v > 0)).toBe(true);
  });

  it('accepts a number seed and behaves consistently with bigint', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(BigInt(42));
    expect(Array.from({ length: 5 }, () => a.next()))
      .toEqual(Array.from({ length: 5 }, () => b.next()));
  });

  it('nextInt(max) returns an integer in [0, max)', () => {
    const rng = new SeededRandom(BigInt(7));
    for (let i = 0; i < 200; i++) {
      const v = rng.nextInt(10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it('nextInt throws on non-positive max', () => {
    const rng = new SeededRandom(BigInt(1));
    expect(() => rng.nextInt(0)).toThrow();
    expect(() => rng.nextInt(-1)).toThrow();
  });

  describe('shuffle()', () => {
    it('returns the same elements (permutation)', () => {
      const rng = new SeededRandom(BigInt(99));
      const arr = [1, 2, 3, 4, 5];
      const shuffled = rng.shuffle([...arr]);
      const sortedShuffled = [...shuffled];
      sortedShuffled.sort();
      const sortedOriginal = [...arr];
      sortedOriginal.sort();
      expect(sortedShuffled).toEqual(sortedOriginal);
    });

    it('is deterministic for the same seed', () => {
      const a = new SeededRandom(BigInt(99));
      const b = new SeededRandom(BigInt(99));
      expect(a.shuffle([1, 2, 3, 4, 5])).toEqual(b.shuffle([1, 2, 3, 4, 5]));
    });

    it('actually permutes the array (not identity)', () => {
      // Try multiple seeds; at least one should reorder.
      let foundPermutation = false;
      for (let s = 1; s < 10; s++) {
        const rng = new SeededRandom(BigInt(s));
        const result = rng.shuffle([1, 2, 3, 4, 5]);
        if (JSON.stringify(result) !== JSON.stringify([1, 2, 3, 4, 5])) {
          foundPermutation = true;
          break;
        }
      }
      expect(foundPermutation).toBe(true);
    });

    it('approaches uniform distribution over many samples', () => {
      // Coarse sanity check: each element should land in each position roughly equally.
      const counts: Record<number, number[]> = {};
      const TRIALS = 2000;
      for (let i = 0; i < TRIALS; i++) {
        const rng = new SeededRandom(BigInt(i + 1));
        const arr = rng.shuffle([0, 1, 2, 3]);
        for (let pos = 0; pos < 4; pos++) {
          const v = arr[pos]!;
          if (!counts[v]) counts[v] = [0, 0, 0, 0];
          (counts[v] as number[])[pos]!++;
        }
      }
      // Each position should have ~25% of trials. Allow ±15% slack.
      const expected = TRIALS / 4;
      for (const v of [0, 1, 2, 3]) {
        const row = counts[v];
        expect(row).toBeDefined();
        for (let pos = 0; pos < 4; pos++) {
          const ratio = (row as number[])[pos]! / expected;
          expect(ratio).toBeGreaterThan(0.85);
          expect(ratio).toBeLessThan(1.15);
        }
      }
    });
  });
});

describe('deriveSeed', () => {
  it('is deterministic for the same parent + namespace', () => {
    const a = deriveSeed(BigInt(42), 'iter1', 'exec3');
    const b = deriveSeed(BigInt(42), 'iter1', 'exec3');
    expect(a).toBe(b);
  });

  it('produces different sub-seeds for different namespaces', () => {
    const a = deriveSeed(BigInt(42), 'iter1', 'exec1');
    const b = deriveSeed(BigInt(42), 'iter1', 'exec2');
    expect(a).not.toBe(b);
  });

  it('produces different sub-seeds for different parent seeds', () => {
    const a = deriveSeed(BigInt(1), 'foo');
    const b = deriveSeed(BigInt(2), 'foo');
    expect(a).not.toBe(b);
  });

  it('returns a 64-bit-range bigint', () => {
    const seed = deriveSeed(BigInt(42), 'iter1', 'exec3');
    expect(typeof seed).toBe('bigint');
    expect(seed).toBeGreaterThanOrEqual(BigInt(0));
    expect(seed).toBeLessThan(BigInt(2) ** BigInt(64));
  });

  it('two SeededRandom instances seeded with the same derived seed produce identical sequences', () => {
    const sub = deriveSeed(BigInt(99), 'agent', 'A');
    const a = new SeededRandom(sub);
    const b = new SeededRandom(sub);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });
});
