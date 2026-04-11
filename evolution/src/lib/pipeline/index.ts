// V2 barrel module. Single entry point for all V2 consumers.

// ─── Types ──────────────────────────────────────────────────────
export type { V2Match, EvolutionConfig, EvolutionResult, StrategyConfig } from './infra/types';
export type { Variant, EvolutionLLMClient, LLMCompletionOptions } from '../types';
/** @deprecated Use Variant */ export type { TextVariation } from '../types';
export type { Rating, ComparisonResult, CachedMatch, ReversalConfig } from '../shared/computeRatings';
export type { FormatResult } from '../shared/enforceVariantFormat';

// ─── Error classes ──────────────────────────────────────────────
export { BudgetExceededError } from '../types';

// ─── Ratings, comparisons, cache ─────────────────────────────────
export {
  createRating,
  updateRating,
  updateDraw,
  toEloScale,
  isConverged,
  computeEloPerDollar,
  DEFAULT_MU,
  DEFAULT_SIGMA,
  DEFAULT_CONVERGENCE_SIGMA,
  ELO_SIGMA_SCALE,
  DECISIVE_CONFIDENCE_THRESHOLD,
  compareWithBiasMitigation,
  parseWinner,
  aggregateWinners,
  buildComparisonPrompt,
  run2PassReversal,
  ComparisonCache,
  MAX_CACHE_SIZE,
} from '../shared/computeRatings';

// ─── Format validation ───────────────────────────────────────────
export { validateFormat, FORMAT_RULES } from '../shared/enforceVariantFormat';

// ─── Factory ─────────────────────────────────────────────────────
export { createVariant } from '../types';
/** @deprecated Use createVariant */ export { createTextVariation } from '../types';

// ─── Error classification ────────────────────────────────────────
export { isTransientError } from '../shared/classifyErrors';

// ─── V2 strategy (forked from V1, no Zod/AgentName deps) ────────
export { hashStrategyConfig, labelStrategyConfig, upsertStrategy } from './setup/findOrCreateStrategy';

// ─── V2 errors (M2) ─────────────────────────────────────────────
export { BudgetExceededWithPartialResults } from '../types';

// ─── V2 cost tracking (M3) ──────────────────────────────────────
export type { V2CostTracker } from './infra/trackBudget';
export { createCostTracker } from './infra/trackBudget';

// ─── V2 LLM client (M3) ─────────────────────────────────────────
export { createEvolutionLLMClient } from './infra/createEvolutionLLMClient';

// ─── V2 invocations + logging (M3) ──────────────────────────────
export { createInvocation, updateInvocation } from './infra/trackInvocations';
export type { EntityLogger, EntityLogContext, EntityType } from './infra/createEntityLogger';
export { createEntityLogger } from './infra/createEntityLogger';

// ─── V2 main function (M3) ──────────────────────────────────────
export { evolveArticle } from './loop/runIterationLoop';

// ─── V2 runner (M4) ─────────────────────────────────────────────
export { claimAndExecuteRun } from './claimAndExecuteRun';
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
// Parallelized pipeline (generate_rank_evolution_parallel_20260331).
export { GenerateFromSeedArticleAgent } from '../core/agents/generateFromSeedArticle';
export type { GenerateFromSeedInput, GenerateFromSeedOutput } from '../core/agents/generateFromSeedArticle';
export { SwissRankingAgent } from '../core/agents/SwissRankingAgent';
export type { SwissRankingInput, SwissRankingOutput } from '../core/agents/SwissRankingAgent';
export { MergeRatingsAgent } from '../core/agents/MergeRatingsAgent';
export type { MergeRatingsInput, MergeRatingsOutput, MergeMatchEntry } from '../core/agents/MergeRatingsAgent';

// ─── Pipeline schemas (Phase 2) ─────────────────────────────────
export {
  variantSchema,
  strategyConfigSchema,
  evolutionConfigSchema,
  v2MatchSchema,
  evolutionResultSchema,
  ratingSchema,
  cachedMatchSchema,
  critiqueSchema,
  metaFeedbackSchema,
  agentExecutionDetailSchema,
} from '../schemas';
