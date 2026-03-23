// V2 evolution pipeline types. Re-exports V1 types that V2 reuses, derives V2-specific types from schemas.

import { z } from 'zod';
import {
  v2MatchSchema,
  evolutionConfigSchema,
  v2StrategyConfigSchema,
  variantSchema,
  ratingSchema,
} from '../../schemas';

// ─── V1 re-exports (single source of truth) ─────────────────────
export type { Variant } from '../../types';
export type { Rating } from '../../shared/computeRatings';

// ─── V2 Match ────────────────────────────────────────────────────
/** V2 match result — distinct from V1 Match (which uses variationA/variationB/winner fields). */
export type V2Match = z.infer<typeof v2MatchSchema>;

// ─── V2 Evolution Config ─────────────────────────────────────────
/** Simplified, flat run config for V2. Validated via evolutionConfigSchema. */
export type EvolutionConfig = z.infer<typeof evolutionConfigSchema>;

// ─── V2 Evolution Result ─────────────────────────────────────────
export interface EvolutionResult {
  winner: z.infer<typeof variantSchema>;
  pool: z.infer<typeof variantSchema>[];
  ratings: Map<string, z.infer<typeof ratingSchema>>;
  matchHistory: V2Match[];
  totalCost: number;
  /** Actual iterations completed (distinct from config.iterations). */
  iterationsRun: number;
  stopReason: 'budget_exceeded' | 'iterations_complete' | 'converged' | 'killed';
  /** muHistory[i] = array of mu values for top-K variants after iteration i. */
  muHistory: number[][];
  /** diversityHistory[i] = pairwise text diversity score after iteration i. */
  diversityHistory: number[];
  /** Per-variant match counts (total comparisons played). */
  matchCounts: Record<string, number>;
}

// ─── V2 Strategy Config ──────────────────────────────────────────
/** V2 strategy config — structurally incompatible with V1 StrategyConfig (separate type). */
export type V2StrategyConfig = z.infer<typeof v2StrategyConfigSchema>;
