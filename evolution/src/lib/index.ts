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
export { createRating, updateRating, updateDraw, isConverged, toEloScale, computeEloPerDollar, DEFAULT_MU, DEFAULT_SIGMA, DEFAULT_CONVERGENCE_SIGMA } from './shared/computeRatings';
export type { Rating } from './shared/computeRatings';

// ─── Comparison ──────────────────────────────────────────────────
export { buildComparisonPrompt, parseWinner, compareWithBiasMitigation } from './shared/computeRatings';
export type { ComparisonResult } from './shared/computeRatings';
export { ComparisonCache, MAX_CACHE_SIZE } from './shared/computeRatings';
export type { CachedMatch } from './shared/computeRatings';

// ─── Error classification ────────────────────────────────────────
export { isTransientError } from './shared/classifyErrors';

// ─── Text variation factory ──────────────────────────────────────
export { createTextVariation } from './types';

// ─── Format validation ──────────────────────────────────────────
export { validateFormat } from './shared/enforceVariantFormat';
export type { FormatResult } from './shared/enforceVariantFormat';
export { FORMAT_RULES } from './shared/enforceVariantFormat';

// ─── Strategy config ────────────────────────────────────────────
export { labelStrategyConfig, defaultStrategyName } from './shared/hashStrategyConfig';
export type { StrategyConfig, StrategyConfigRow } from './shared/hashStrategyConfig';

// ─── Reversal comparison ────────────────────────────────────────
export { run2PassReversal } from './shared/computeRatings';
export type { ReversalConfig } from './shared/computeRatings';
