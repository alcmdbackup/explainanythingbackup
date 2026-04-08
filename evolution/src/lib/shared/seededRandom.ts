// Seeded PRNG and sub-seed derivation for the parallelized evolution pipeline.
// SeededRandom is a simple xorshift64* generator (deterministic, fast, no native deps).
// deriveSeed() produces deterministic per-agent sub-seeds via SHA-256 of the parent seed
// plus a namespace, so two agents started with the same parent seed and same namespace
// produce identical RNG sequences regardless of dispatch timing.
//
// Note: project tsc target is ES2017 which lacks BigInt literal syntax (`0n`).
// We use BigInt() constructors throughout to remain compatible.

import { createHash } from 'crypto';

const TWO_POW_64 = BigInt(2) ** BigInt(64);
const MASK_64 = TWO_POW_64 - BigInt(1);
const FALLBACK_SEED = BigInt('0xdeadbeefcafebabe');
const SHIFT_12 = BigInt(12);
const SHIFT_25 = BigInt(25);
const SHIFT_27 = BigInt(27);
const SHIFT_11 = BigInt(11);
const SHIFT_8 = BigInt(8);
const XORSHIFT_MAGIC = BigInt('0x2545f4914f6cdd1d');
const TWO_POW_53 = 2 ** 53;

/** Seeded PRNG (xorshift64*) producing a [0,1) double per next() call. */
export class SeededRandom {
  private state: bigint;

  constructor(seed: number | bigint) {
    let s = typeof seed === 'bigint' ? seed : BigInt(seed);
    // xorshift requires non-zero state — fall back to a fixed constant if zero.
    if (s === BigInt(0)) s = FALLBACK_SEED;
    // Mask to 64 bits.
    this.state = s & MASK_64;
  }

  /** Advance state and return a [0,1) double (53-bit precision). */
  next(): number {
    let x = this.state;
    x ^= x >> SHIFT_12;
    x ^= (x << SHIFT_25) & MASK_64;
    x ^= x >> SHIFT_27;
    this.state = x;
    // Multiply by xorshift64* magic constant, then mask to 64 bits.
    const mixed = (x * XORSHIFT_MAGIC) & MASK_64;
    // Use top 53 bits for double precision (matches Math.random behavior).
    return Number(mixed >> SHIFT_11) / TWO_POW_53;
  }

  /** Return an integer in [0, max). max must be a positive integer. */
  nextInt(max: number): number {
    if (max <= 0) throw new Error(`SeededRandom.nextInt: max must be > 0, got ${max}`);
    return Math.floor(this.next() * max);
  }

  /** Fisher-Yates shuffle in-place. Mutates and returns the array. */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = array[i]!;
      array[i] = array[j]!;
      array[j] = tmp;
    }
    return array;
  }
}

/**
 * Derive a deterministic sub-seed from a parent seed plus a namespace.
 * Uses SHA-256 of `${parentSeed}:${namespace.join(':')}` and takes the low 64 bits.
 *
 * Two callers with the same (parentSeed, namespace) tuple will get the same derived seed,
 * regardless of dispatch timing or order. This is the foundation for parallel-safe
 * reproducibility — each agent constructs its own SeededRandom from a derived sub-seed.
 */
export function deriveSeed(parentSeed: bigint, ...namespace: string[]): bigint {
  const payload = `${parentSeed.toString()}:${namespace.join(':')}`;
  const hash = createHash('sha256').update(payload).digest();
  // Read 8 bytes as big-endian uint64
  let result = BigInt(0);
  for (let i = 0; i < 8; i++) {
    result = (result << SHIFT_8) | BigInt(hash[i]!);
  }
  return result;
}
