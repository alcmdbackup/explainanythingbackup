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

// ─── Iteration Stop Reasons ─────────────────────────────────────
/** Per-iteration stop reason (distinct from run-level stopReason). */
export type IterationStopReason = 'iteration_budget_exceeded' | 'iteration_converged' | 'iteration_no_pairs' | 'iteration_complete';

/** Per-iteration result recorded in EvolutionResult.iterationResults. */
export interface IterationResult {
  iteration: number;
  agentType: 'generate' | 'reflect_and_generate' | 'criteria_and_generate' | 'iterative_editing' | 'swiss';
  stopReason: IterationStopReason;
  budgetAllocated: number;
  budgetSpent: number;
  variantsCreated: number;
  matchesCompleted: number;
}

// ─── V2 Evolution Result ─────────────────────────────────────────
export interface EvolutionResult {
  winner: z.infer<typeof variantSchema>;
  pool: z.infer<typeof variantSchema>[];
  ratings: Map<string, z.infer<typeof ratingSchema>>;
  matchHistory: V2Match[];
  totalCost: number;
  /** Actual iterations completed (distinct from config.iterations). */
  iterationsRun: number;
  stopReason: 'total_budget_exceeded' | 'killed' | 'deadline' | 'completed';
  /** Per-iteration results with stop reasons, budget usage, and counts. */
  iterationResults?: IterationResult[];
  /** eloHistory[i] = array of elo values for top-K variants after iteration i. */
  eloHistory: number[][];
  /** Phase 4b: parallel array — uncertainty values matching eloHistory[i] index-for-index.
   *  Enables EloTab to render a shaded band around each line. Optional for back-compat. */
  uncertaintyHistory?: number[][];
  /** diversityHistory[i] = pairwise text diversity score after iteration i. */
  diversityHistory: number[];
  /** Per-variant match counts (total comparisons played). */
  matchCounts: Record<string, number>;
  /** Variants that were generated but discarded by their owning agent (Phase 1+).
   *  Persisted at finalization with persisted=false so generation cost stays queryable. */
  discardedVariants?: z.infer<typeof variantSchema>[];
  /** Per-discarded-variant local-rank rating from the agent's binary search, keyed by variantId.
   *  Used by persistRunResults to give discarded rows honest (non-default) ELO so Phase 3/5
   *  metrics don't suffer survivorship bias. Populated by runIterationLoop during dispatch. */
  discardedLocalRatings?: Map<string, z.infer<typeof ratingSchema>>;
  /** Iteration snapshots captured at the start and end of every orchestrator iteration. */
  iterationSnapshots?: import('../../schemas').IterationSnapshot[];
  /** Random seed used for the run (for reproducibility). */
  randomSeed?: bigint;
  /** True when a CreateSeedArticleAgent successfully generated the baseline for this run. */
  isSeeded?: boolean;
  /** Budget-floor-related observables captured during dispatch for post-hoc
   *  projected-vs-actual analysis. Written as first-class evolution_metrics rows
   *  during finalizeRun via BudgetFloorObservables. */
  budgetFloorObservables?: {
    initialAgentCostEstimate: number;
    actualAvgCostPerAgent: number | null;
    parallelDispatched: number;
    sequentialDispatched: number;
  };
  /** Static floor config captured at run start — written into run_summary.budgetFloorConfig. */
  budgetFloorConfig?: {
    minBudgetAfterParallelFraction?: number;
    minBudgetAfterParallelAgentMultiple?: number;
    minBudgetAfterSequentialFraction?: number;
    minBudgetAfterSequentialAgentMultiple?: number;
    /** @deprecated Removed in favor of DISPATCH_SAFETY_CAP = 100 constant in code.
     *  Kept optional for legacy run_summary rows that still carry the field. */
    numVariants?: number;
  };
  /** Wall-clock durations (ms) of sequential-phase GFSA invocations, in dispatch order.
   *  Computed in runIterationLoop; persistRunResults derives median/avg metrics from it. */
  sequentialGfsaDurationsMs?: number[];
}

// ─── V2 Strategy Config ──────────────────────────────────────────
/** V2 strategy config — structurally incompatible with V1 StrategyConfig (separate type). */
export type StrategyConfig = z.infer<typeof strategyConfigSchema>;
