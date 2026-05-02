// Property-based tests for deriveSeed + SeededRandom.shuffle: cross-invocation
// determinism is the load-bearing property the reflection wrapper relies on (every
// retry of the same dispatch must see the same shuffled candidate list, otherwise
// reproducibility breaks). Companion to the example-based suite in seededRandom.test.ts.

import * as fc from 'fast-check';
import { SeededRandom, deriveSeed } from './seededRandom';

describe('seededRandom — property-based determinism', () => {
  it('deriveSeed: identical (parentSeed, namespace) tuples always produce identical sub-seeds', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: BigInt(0), max: BigInt('0xFFFFFFFFFFFFFFFF') }),
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 5 }),
        (parentSeed, namespace) => {
          const a = deriveSeed(parentSeed, ...namespace);
          const b = deriveSeed(parentSeed, ...namespace);
          expect(a).toBe(b);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('deriveSeed: different namespaces produce different sub-seeds (collision rate < 1%)', () => {
    let collisions = 0;
    let comparisons = 0;
    fc.assert(
      fc.property(
        fc.bigInt({ min: BigInt(0), max: BigInt('0xFFFFFFFFFFFFFFFF') }),
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (parentSeed, ns1, ns2) => {
          if (ns1 === ns2) return;
          comparisons++;
          if (deriveSeed(parentSeed, ns1) === deriveSeed(parentSeed, ns2)) collisions++;
        },
      ),
      { numRuns: 200 },
    );
    if (comparisons > 0) {
      expect(collisions / comparisons).toBeLessThan(0.01);
    }
  });

  it('shuffle: same seed → same permutation (reflection retry reproducibility)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: BigInt(1), max: BigInt('0xFFFFFFFFFFFFFFFF') }),
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 2, maxLength: 24 }),
        (seed, candidates) => {
          const arrA = [...candidates];
          const arrB = [...candidates];
          new SeededRandom(seed).shuffle(arrA);
          new SeededRandom(seed).shuffle(arrB);
          expect(arrA).toEqual(arrB);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('shuffle: preserves the multiset of input elements', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: BigInt(1), max: BigInt('0xFFFFFFFFFFFFFFFF') }),
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 0, maxLength: 30 }),
        (seed, candidates) => {
          const shuffled = [...candidates];
          new SeededRandom(seed).shuffle(shuffled);
          expect([...shuffled].sort()).toEqual([...candidates].sort());
        },
      ),
      { numRuns: 30 },
    );
  });

  it('cross-invocation reproducibility: derived seed → shuffle is stable', () => {
    // The reflection wrapper builds a per-dispatch seed via:
    //   deriveSeed(runSeed, `iter${i}`, `reflect_shuffle${execOrder}`)
    // and uses it to shuffle the 24-tactic list. Retries of the same dispatch must
    // produce an identical prompt (otherwise cost-tracking + tracing diverge).
    fc.assert(
      fc.property(
        fc.bigInt({ min: BigInt(1), max: BigInt('0xFFFFFFFFFFFFFFFF') }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 100 }),
        (runSeed, iterIdx, execOrder) => {
          const candidates = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
          const seed1 = deriveSeed(runSeed, `iter${iterIdx}`, `reflect_shuffle${execOrder}`);
          const seed2 = deriveSeed(runSeed, `iter${iterIdx}`, `reflect_shuffle${execOrder}`);
          const arrA = [...candidates];
          const arrB = [...candidates];
          new SeededRandom(seed1).shuffle(arrA);
          new SeededRandom(seed2).shuffle(arrB);
          expect(arrA).toEqual(arrB);
        },
      ),
      { numRuns: 30 },
    );
  });
});
