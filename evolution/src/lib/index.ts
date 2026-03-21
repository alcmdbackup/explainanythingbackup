// Public API for the evolution pipeline subsystem.
// V2 rebuild: V1 pipeline/agents/state removed. Kept: types, reused core modules, config.

// ─── Types ───────────────────────────────────────────────────────
export type {
  TextVariation,
  ExecutionContext,
  ReadonlyPipelineState,
  EvolutionRunStatus,
  Match,
  Critique,
  MetaFeedback,
  EvolutionLLMClient,
  EvolutionLogger,
  CostTracker,
  Checkpoint,
  SerializedPipelineState,
  BudgetEventLogger,
  EvolutionRunSummary,
  AgentName,
  AgentExecutionDetail,
  PromptMetadata,
  PipelineType,
  LLMCompletionOptions,
} from './types';

export {
  BudgetExceededError,
  LLMRefusalError,
  BASELINE_STRATEGY,
  PIPELINE_TYPES,
  EvolutionRunSummarySchema,
  EvolutionRunSummaryV3Schema,
} from './types';

// ─── Rating ──────────────────────────────────────────────────────
export { createRating, updateRating, updateDraw, isConverged, toEloScale, computeEloPerDollar, DEFAULT_MU, DEFAULT_SIGMA, DEFAULT_CONVERGENCE_SIGMA } from './shared/rating';
export type { Rating } from './shared/rating';

// ─── Comparison ──────────────────────────────────────────────────
export { buildComparisonPrompt, parseWinner, compareWithBiasMitigation } from './comparison';
export type { ComparisonResult } from './comparison';
export { ComparisonCache, MAX_CACHE_SIZE } from './shared/comparisonCache';
export type { CachedMatch } from './shared/comparisonCache';

// ─── Error classification ────────────────────────────────────────
export { isTransientError } from './shared/errorClassification';

// ─── Text variation factory ──────────────────────────────────────
export { createTextVariation } from './shared/textVariationFactory';

// ─── Format validation ──────────────────────────────────────────
export { validateFormat } from './shared/formatValidator';
export type { FormatResult } from './shared/formatValidator';
export { FORMAT_RULES } from './shared/formatRules';

// ─── Strategy config ────────────────────────────────────────────
export { labelStrategyConfig, defaultStrategyName } from './shared/strategyConfig';
export type { StrategyConfig, StrategyConfigRow } from './shared/strategyConfig';

// ─── Reversal comparison ────────────────────────────────────────
export { run2PassReversal } from './shared/reversalComparison';
export type { ReversalConfig } from './shared/reversalComparison';
