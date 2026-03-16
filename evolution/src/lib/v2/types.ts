// V2 evolution pipeline types. Re-exports V1 types that V2 reuses, defines V2-specific types.

// ─── V1 re-exports (single source of truth) ─────────────────────
export type { TextVariation } from '../types';
export type { Rating } from '../core/rating';

// ─── V2 Match ────────────────────────────────────────────────────
/** V2 match result — distinct from V1 Match (which uses variationA/variationB/winner fields). */
export interface V2Match {
  winnerId: string;
  loserId: string;
  result: 'win' | 'draw';
  confidence: number;
  judgeModel: string;
  reversed: boolean;
}

// ─── V2 Evolution Config ─────────────────────────────────────────
/** Simplified, flat run config for V2. No Zod schema — validated at evolveArticle entry (M3). */
export interface EvolutionConfig {
  /** Number of generate→rank→evolve iterations. Maps to V1 maxIterations. */
  iterations: number;
  /** Total budget in USD. Maps to V1 budgetCapUsd. */
  budgetUsd: number;
  /** Model for comparison/judge calls. */
  judgeModel: string;
  /** Model for text generation calls. */
  generationModel: string;
  /** Number of generation strategies per round (default: 3). Maps to V1 generation.strategies. */
  strategiesPerRound?: number;
  /** Number of triage opponents (default: 5). Maps to V1 calibration.opponents. */
  calibrationOpponents?: number;
  /** Top-K for tournament fine-ranking (default: 5). Maps to V1 tournament.topK. */
  tournamentTopK?: number;
}

// ─── V2 Evolution Result ─────────────────────────────────────────
export interface EvolutionResult {
  winner: import('../types').TextVariation;
  pool: import('../types').TextVariation[];
  ratings: Map<string, import('../core/rating').Rating>;
  matchHistory: V2Match[];
  totalCost: number;
  /** Actual iterations completed (distinct from config.iterations). */
  iterationsRun: number;
  stopReason: 'budget_exceeded' | 'iterations_complete' | 'converged' | 'killed';
  /** muHistory[i] = array of mu values for top-K variants after iteration i. */
  muHistory: number[][];
  /** diversityHistory[i] = pairwise text diversity score after iteration i. */
  diversityHistory: number[];
}

// ─── V2 Strategy Config ──────────────────────────────────────────
/** V2 strategy config — structurally incompatible with V1 StrategyConfig (separate type). */
export interface V2StrategyConfig {
  generationModel: string;
  judgeModel: string;
  iterations: number;
  strategiesPerRound?: number;
  budgetUsd?: number;
}
