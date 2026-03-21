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
export { createRating, updateRating, updateDraw, isConverged, toEloScale, computeEloPerDollar, DEFAULT_MU, DEFAULT_SIGMA, DEFAULT_CONVERGENCE_SIGMA } from './core/rating';
export type { Rating } from './core/rating';

// ─── Comparison ──────────────────────────────────────────────────
export { buildComparisonPrompt, parseWinner, compareWithBiasMitigation } from './comparison';
export type { ComparisonResult } from './comparison';
export { ComparisonCache, MAX_CACHE_SIZE } from './core/comparisonCache';
export type { CachedMatch } from './core/comparisonCache';

// ─── Cost tracking ──────────────────────────────────────────────
export { createCostTracker, createCostTrackerFromCheckpoint } from './core/costTracker';

// ─── Logger + LLM client ─────────────────────────────────────────
export { createEvolutionLogger, createDbEvolutionLogger, LogBuffer } from './core/logger';
export { createEvolutionLLMClient } from './core/llmClient';

// ─── Error classification ────────────────────────────────────────
export { isTransientError } from './core/errorClassification';

// ─── Text variation factory ──────────────────────────────────────
export { createTextVariation } from './core/textVariationFactory';

// ─── Format validation ──────────────────────────────────────────
export { validateFormat } from './agents/formatValidator';
export type { FormatResult } from './agents/formatValidator';
export { FORMAT_RULES } from './agents/formatRules';

// ─── Strategy config ────────────────────────────────────────────
export { labelStrategyConfig, defaultStrategyName } from './core/strategyConfig';
export type { StrategyConfig, StrategyConfigRow } from './core/strategyConfig';

// ─── Reversal comparison ────────────────────────────────────────
export { run2PassReversal } from './core/reversalComparison';
export type { ReversalConfig } from './core/reversalComparison';
