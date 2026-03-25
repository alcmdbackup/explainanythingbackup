// V2 barrel module. Single entry point for all V2 consumers.

// ─── Types ──────────────────────────────────────────────────────
export type { V2Match, EvolutionConfig, EvolutionResult, V2StrategyConfig } from './infra/types';
export type { Variant, EvolutionLLMClient, LLMCompletionOptions } from '../types';
/** @deprecated Use Variant */ export type { TextVariation } from '../types';
export type { Rating, ComparisonResult, CachedMatch, ReversalConfig } from '../shared/computeRatings';
export type { FormatResult } from '../shared/enforceVariantFormat';

// ─── Error classes ──────────────────────────────────────────────
export { BudgetExceededError } from '../types';

// ─── Rating functions ────────────────────────────────────────────
export {
  createRating,
  updateRating,
  updateDraw,
  toEloScale,
  isConverged,
  computeEloPerDollar,
} from '../shared/computeRatings';

// ─── Rating constants ────────────────────────────────────────────
export {
  DEFAULT_MU,
  DEFAULT_SIGMA,
  DEFAULT_CONVERGENCE_SIGMA,
  ELO_SIGMA_SCALE,
  DECISIVE_CONFIDENCE_THRESHOLD,
} from '../shared/computeRatings';

// ─── Comparison ──────────────────────────────────────────────────
export {
  compareWithBiasMitigation,
  parseWinner,
  aggregateWinners,
  buildComparisonPrompt,
} from '../shared/computeRatings';

// ─── Reversal ────────────────────────────────────────────────────
export { run2PassReversal } from '../shared/computeRatings';

// ─── Cache ───────────────────────────────────────────────────────
export { ComparisonCache, MAX_CACHE_SIZE } from '../shared/computeRatings';

// ─── Format validation (reads FORMAT_VALIDATION_MODE env var) ────
export { validateFormat } from '../shared/enforceVariantFormat';
export { FORMAT_RULES } from '../shared/enforceVariantFormat';

// ─── Factory ─────────────────────────────────────────────────────
export { createVariant } from '../types';
/** @deprecated Use createVariant */ export { createTextVariation } from '../types';

// ─── Error classification ────────────────────────────────────────
export { isTransientError } from '../shared/classifyErrors';

// ─── V2 strategy (forked from V1, no Zod/AgentName deps) ────────
export { hashStrategyConfig, labelStrategyConfig, upsertStrategy } from './setup/findOrCreateStrategy';

// ─── V2 errors (M2) ─────────────────────────────────────────────
export { BudgetExceededWithPartialResults } from './infra/errors';

// ─── V2 cost tracking (M3) ──────────────────────────────────────
export type { V2CostTracker } from './infra/trackBudget';
export { createCostTracker } from './infra/trackBudget';

// ─── V2 LLM client (M3) ─────────────────────────────────────────
export { createV2LLMClient } from './infra/createLLMClient';

// ─── V2 invocations + logging (M3) ──────────────────────────────
export { createInvocation, updateInvocation } from './infra/trackInvocations';
export type { EntityLogger, EntityLogContext, EntityType } from './infra/createEntityLogger';
export { createEntityLogger } from './infra/createEntityLogger';

// ─── V2 main function (M3) ──────────────────────────────────────
export { evolveArticle } from './loop/runIterationLoop';

// ─── V2 runner (M4) ─────────────────────────────────────────────
export { claimAndExecuteRun, executeV2Run } from './claimAndExecuteRun';
export type { RunnerOptions, RunnerResult } from './claimAndExecuteRun';
export type { ClaimedRun, RunContext } from './setup/buildRunContext';
export { buildRunContext } from './setup/buildRunContext';
export { generateSeedArticle } from './setup/generateSeedArticle';
export type { SeedResult } from './setup/generateSeedArticle';

// ─── V2 finalize (M5) ───────────────────────────────────────────
export { finalizeRun } from './finalize/persistRunResults';

// ─── V2 arena (M10) ─────────────────────────────────────────────
export { loadArenaEntries, isArenaEntry } from './setup/buildRunContext';
export { syncToArena } from './finalize/persistRunResults';
export type { ArenaTextVariation } from './setup/buildRunContext';

// ─── V2 experiments (M11) ───────────────────────────────────────
export { createExperiment, addRunToExperiment, computeExperimentMetrics } from './manageExperiments';
export type { ExperimentMetrics } from './manageExperiments';

// ─── Entity/Agent classes ────────────────────────────────────────
export { GenerationAgent, type GenerationInput } from '../core/agents/GenerationAgent';
export { RankingAgent, type RankingInput, type RankResult } from '../core/agents/RankingAgent';

// ─── Pipeline schemas (Phase 2) ─────────────────────────────────
export {
  variantSchema,
  v2StrategyConfigSchema,
  evolutionConfigSchema,
  v2MatchSchema,
  evolutionResultSchema,
  ratingSchema,
  cachedMatchSchema,
  critiqueSchema,
  metaFeedbackSchema,
  agentExecutionDetailSchema,
} from '../schemas';
