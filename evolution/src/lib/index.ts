// Public API for the evolution pipeline subsystem.
// V2 rebuild: V1 pipeline/agents/state removed. Kept: types, reused core modules, config.

// ─── Types ───────────────────────────────────────────────────────
export type {
  TextVariation,
  AgentResult,
  ExecutionContext,
  ReadonlyPipelineState,
  PipelinePhase,
  EvolutionRunConfig,
  EvolutionRunStatus,
  Match,
  Critique,
  MetaFeedback,
  EvolutionLLMClient,
  EvolutionLogger,
  CostTracker,
  Checkpoint,
  SerializedPipelineState,
  SerializedCheckpoint,
  OutlineVariant,
  GenerationStep,
  GenerationStepName,
  BudgetEventLogger,
  EvolutionRunSummary,
  DebateTranscript,
  AgentName,
  AgentExecutionDetail,
  DiffMetrics,
  PromptMetadata,
  PipelineType,
  EloAttribution,
  AgentAttribution,
  LLMCompletionOptions,
} from './types';

export {
  BudgetExceededError,
  LLMRefusalError,
  CheckpointNotFoundError,
  CheckpointCorruptedError,
  BASELINE_STRATEGY,
  PIPELINE_TYPES,
  EvolutionRunSummarySchema,
  EvolutionRunSummaryV3Schema,
  isOutlineVariant,
  parseStepScore,
} from './types';

// ─── Config ──────────────────────────────────────────────────────
export { DEFAULT_EVOLUTION_CONFIG, resolveConfig, MAX_RUN_BUDGET_USD, MAX_EXPERIMENT_BUDGET_USD } from './config';

// ─── Rating ──────────────────────────────────────────────────────
export { createRating, updateRating, updateDraw, isConverged, eloToRating, toEloScale, computeEloPerDollar, DEFAULT_MU, DEFAULT_SIGMA, DEFAULT_CONVERGENCE_SIGMA } from './core/rating';
export type { Rating } from './core/rating';

// ─── Comparison ──────────────────────────────────────────────────
export { buildComparisonPrompt, parseWinner, compareWithBiasMitigation } from './comparison';
export type { ComparisonResult } from './comparison';
export { ComparisonCache, MAX_CACHE_SIZE } from './core/comparisonCache';
export type { CachedMatch } from './core/comparisonCache';

// ─── Cost tracking (V1) ─────────────────────────────────────────
export { createCostTracker, createCostTrackerFromCheckpoint } from './core/costTracker';
export { estimateRunCostWithAgentModels, computeCostPrediction, refreshAgentCostBaselines, RunCostEstimateSchema, CostPredictionSchema } from './core/costEstimator';
export type { RunCostEstimate, CostPrediction } from './core/costEstimator';

// ─── Logger + LLM client (V1) ────────────────────────────────────
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
export { hashStrategyConfig, labelStrategyConfig, extractStrategyConfig, diffStrategyConfigs, normalizeEnabledAgents, defaultStrategyName } from './core/strategyConfig';
export type { StrategyConfig, StrategyConfigRow } from './core/strategyConfig';

// ─── Config validation (kept — used by services) ────────────────
export { isTestEntry, validateStrategyConfig, validateRunConfig } from './core/configValidation';
export { validateAgentSelection, enabledAgentsSchema, REQUIRED_AGENTS, OPTIONAL_AGENTS, AGENT_DEPENDENCIES } from './core/budgetRedistribution';
export { toggleAgent } from './core/agentToggle';

// ─── Reversal comparison ────────────────────────────────────────
export { run2PassReversal } from './core/reversalComparison';
export type { ReversalConfig } from './core/reversalComparison';
