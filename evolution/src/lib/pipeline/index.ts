// V2 barrel module. Single entry point for all V2 consumers.

// ─── Types ──────────────────────────────────────────────────────
export type { V2Match, EvolutionConfig, EvolutionResult, V2StrategyConfig } from './types';
export type { TextVariation, EvolutionLLMClient, LLMCompletionOptions } from '../types';
export type { Rating } from '../shared/computeRatings';
export type { ComparisonResult } from '../shared/computeRatings';
export type { CachedMatch } from '../shared/computeRatings';
export type { ReversalConfig } from '../shared/computeRatings';
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
export { createTextVariation } from '../types';

// ─── Error classification ────────────────────────────────────────
export { isTransientError } from '../shared/classifyErrors';

// ─── V2 strategy (forked from V1, no Zod/AgentName deps) ────────
export { hashStrategyConfig, labelStrategyConfig, upsertStrategy } from './strategy';

// ─── V2 errors (M2) ─────────────────────────────────────────────
export { BudgetExceededWithPartialResults } from './errors';

// ─── V2 cost tracking (M3) ──────────────────────────────────────
export type { V2CostTracker } from './cost-tracker';
export { createCostTracker } from './cost-tracker';

// ─── V2 LLM client (M3) ─────────────────────────────────────────
export { createV2LLMClient } from './llm-client';

// ─── V2 invocations + logging (M3) ──────────────────────────────
export { createInvocation, updateInvocation } from './invocations';
export type { RunLogger } from './run-logger';
export { createRunLogger } from './run-logger';

// ─── V2 main function (M3) ──────────────────────────────────────
export { evolveArticle } from './evolve-article';

// ─── V2 runner (M4) ─────────────────────────────────────────────
export { claimAndExecuteRun, executeV2Run } from './claimAndExecuteRun';
export type { RunnerOptions, RunnerResult } from './claimAndExecuteRun';
export type { ClaimedRun, RunContext } from './setup/buildRunContext';
export { buildRunContext } from './setup/buildRunContext';
export { generateSeedArticle } from './seed-article';
export type { SeedResult } from './seed-article';

// ─── V2 finalize (M5) ───────────────────────────────────────────
export { finalizeRun } from './finalize';

// ─── V2 arena (M10) ─────────────────────────────────────────────
export { loadArenaEntries, syncToArena, isArenaEntry } from './arena';
export type { ArenaTextVariation } from './arena';

// ─── V2 experiments (M11) ───────────────────────────────────────
export { createExperiment, addRunToExperiment, computeExperimentMetrics } from './experiments';
export type { ExperimentMetrics } from './experiments';
