// V2 barrel module. Single entry point for all V2 consumers.
// Re-exports V1 reused symbols and V2-defined types/functions.

// ─── V2-defined types ────────────────────────────────────────────
export type { V2Match, EvolutionConfig, EvolutionResult, V2StrategyConfig } from './types';

// ─── V1 re-exported types (from ../types) ────────────────────────
export type { TextVariation, EvolutionLLMClient, LLMCompletionOptions } from '../types';

// ─── V1 re-exported types (from other V1 modules) ───────────────
export type { Rating } from '../core/rating';
export type { ComparisonResult } from '../comparison';
export type { CachedMatch } from '../core/comparisonCache';
export type { ReversalConfig } from '../core/reversalComparison';
export type { FormatResult } from '../agents/formatValidator';

// ─── V1 classes (runtime) ────────────────────────────────────────
export { BudgetExceededError } from '../types';

// ─── Rating functions ────────────────────────────────────────────
export {
  createRating,
  updateRating,
  updateDraw,
  toEloScale,
  isConverged,
  eloToRating,
  computeEloPerDollar,
} from '../core/rating';

// ─── Rating constants ────────────────────────────────────────────
export {
  DEFAULT_MU,
  DEFAULT_SIGMA,
  DEFAULT_CONVERGENCE_SIGMA,
  ELO_SIGMA_SCALE,
  DECISIVE_CONFIDENCE_THRESHOLD,
} from '../core/rating';

// ─── Comparison ──────────────────────────────────────────────────
export {
  compareWithBiasMitigation,
  parseWinner,
  aggregateWinners,
  buildComparisonPrompt,
} from '../comparison';

// ─── Reversal ────────────────────────────────────────────────────
export { run2PassReversal } from '../core/reversalComparison';

// ─── Cache ───────────────────────────────────────────────────────
export { ComparisonCache, MAX_CACHE_SIZE } from '../core/comparisonCache';

// ─── Format validation (reads FORMAT_VALIDATION_MODE env var) ────
export { validateFormat } from '../agents/formatValidator';
export { FORMAT_RULES } from '../agents/formatRules';

// ─── Factory ─────────────────────────────────────────────────────
export { createTextVariation } from '../core/textVariationFactory';

// ─── Error classification ────────────────────────────────────────
export { isTransientError } from '../core/errorClassification';

// ─── V2 strategy (forked from V1, no Zod/AgentName deps) ────────
export { hashStrategyConfig, labelStrategyConfig } from './strategy';

// ─── V2 errors (M2) ─────────────────────────────────────────────
export { BudgetExceededWithPartialResults } from './errors';
