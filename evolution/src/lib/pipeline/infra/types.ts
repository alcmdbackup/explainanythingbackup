// V2 evolution pipeline types. Re-exports V1 types that V2 reuses, derives V2-specific types from schemas.

import { z } from 'zod';
import {
  v2MatchSchema,
  evolutionConfigSchema,
  strategyConfigSchema,
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
  stopReason: 'budget_exceeded' | 'iterations_complete' | 'converged' | 'killed' | 'time_limit' | 'no_pairs' | 'seed_failed';
  /** eloHistory[i] = array of elo values for top-K variants after iteration i. */
  eloHistory: number[][];
  /** diversityHistory[i] = pairwise text diversity score after iteration i. */
  diversityHistory: number[];
  /** Per-variant match counts (total comparisons played). */
  matchCounts: Record<string, number>;
  /** Variants that were generated but discarded by their owning agent (Phase 1+).
   *  Persisted at finalization with persisted=false so generation cost stays queryable. */
  discardedVariants?: z.infer<typeof variantSchema>[];
  /** Iteration snapshots captured at the start and end of every orchestrator iteration. */
  iterationSnapshots?: import('../../schemas').IterationSnapshot[];
  /** Random seed used for the run (for reproducibility). */
  randomSeed?: bigint;
  /** True when a CreateSeedArticleAgent successfully generated the baseline for this run. */
  isSeeded?: boolean;
}

// ─── V2 Strategy Config ──────────────────────────────────────────
/** V2 strategy config — structurally incompatible with V1 StrategyConfig (separate type). */
export type StrategyConfig = z.infer<typeof strategyConfigSchema>;
