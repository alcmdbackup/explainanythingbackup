// Resolves the parent variant (seed or pool pick) for one generate-agent invocation.
// Called by runIterationLoop before dispatching each parallel agent.

import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import type { QualityCutoff } from '../../schemas';
import { computeTopNIds, computeTopPercentIds } from './cutoffHelpers';

export interface ResolveParentArgs {
  sourceMode: 'seed' | 'pool';
  qualityCutoff?: QualityCutoff;
  seedVariant: { id: string; text: string };
  pool: ReadonlyArray<Variant>;
  ratings: ReadonlyMap<string, Rating>;
  rng: () => number;
  /** Optional logger for fallback warnings. */
  warn?: (msg: string, ctx?: Record<string, unknown>) => void;
}

export interface ResolvedParent {
  variantId: string;
  text: string;
  /** 'seed' | 'pool' | 'seed_fallback_from_pool' — captured for per-invocation `sourceModeEffective` */
  effectiveMode: 'seed' | 'pool' | 'seed_fallback_from_pool';
  fallbackReason?: 'empty_pool' | 'no_eligible_variants';
}

export function resolveParent(args: ResolveParentArgs): ResolvedParent {
  const { sourceMode, qualityCutoff, seedVariant, pool, ratings, rng, warn } = args;

  if (sourceMode === 'seed') {
    return { variantId: seedVariant.id, text: seedVariant.text, effectiveMode: 'seed' };
  }

  // sourceMode === 'pool'
  if (!qualityCutoff) {
    // Schema should have rejected this, but guard defensively.
    warn?.('resolveParent: sourceMode=pool without qualityCutoff, falling back to seed');
    return {
      variantId: seedVariant.id,
      text: seedVariant.text,
      effectiveMode: 'seed_fallback_from_pool',
      fallbackReason: 'empty_pool',
    };
  }

  if (pool.length === 0) {
    warn?.('resolveParent: empty pool, falling back to seed');
    return {
      variantId: seedVariant.id,
      text: seedVariant.text,
      effectiveMode: 'seed_fallback_from_pool',
      fallbackReason: 'empty_pool',
    };
  }

  // Restrict ratings to pool members that are actually present (and have a rating).
  const poolRatings = new Map<string, Rating>();
  for (const v of pool) {
    const r = ratings.get(v.id);
    if (r) poolRatings.set(v.id, r);
  }

  const eligibleIds = qualityCutoff.mode === 'topN'
    ? computeTopNIds(poolRatings, Math.floor(qualityCutoff.value))
    : computeTopPercentIds(poolRatings, qualityCutoff.value);

  if (eligibleIds.length === 0) {
    warn?.('resolveParent: cutoff yielded no eligible variants, falling back to seed', {
      cutoff: qualityCutoff,
      poolSize: pool.length,
    });
    return {
      variantId: seedVariant.id,
      text: seedVariant.text,
      effectiveMode: 'seed_fallback_from_pool',
      fallbackReason: 'no_eligible_variants',
    };
  }

  // Uniform random pick via supplied RNG.
  const idx = Math.floor(rng() * eligibleIds.length);
  const pickedId = eligibleIds[idx];
  const pickedVariant = pool.find((v) => v.id === pickedId);
  if (!pickedVariant) {
    // Should not happen (pickedId came from poolRatings which is scoped to pool).
    warn?.('resolveParent: picked variant not in pool (invariant broken), falling back to seed', {
      pickedId,
    });
    return {
      variantId: seedVariant.id,
      text: seedVariant.text,
      effectiveMode: 'seed_fallback_from_pool',
      fallbackReason: 'no_eligible_variants',
    };
  }

  return { variantId: pickedVariant.id, text: pickedVariant.text, effectiveMode: 'pool' };
}

/**
 * Deterministic 32-bit seed derived from (runId, iteration, executionOrder) via FNV-1a.
 * Used by runIterationLoop to make pool-mode parent picks reproducible across retries.
 */
export function hashSeed(runId: string, iteration: number, executionOrder: number): number {
  const input = `${runId}:${iteration}:${executionOrder}`;
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV-1a prime multiplication with 32-bit wrap via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  // Ensure unsigned 32-bit result.
  return hash >>> 0;
}
