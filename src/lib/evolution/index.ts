// Public API for the evolution pipeline subsystem.
// Re-exports the types, config, and key classes needed by server actions and admin UI.

export type {
  TextVariation,
  AgentResult,
  ExecutionContext,
  PipelineState,
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
} from './types';
export { BudgetExceededError, LLMRefusalError, BASELINE_STRATEGY, EvolutionRunSummarySchema } from './types';
export type { EvolutionRunSummary } from './types';
export { DEFAULT_EVOLUTION_CONFIG, resolveConfig } from './config';
export { PipelineStateImpl, serializeState, deserializeState } from './core/state';
export { createRating, updateRating, updateDraw, getOrdinal, isConverged, ratingToDisplay, eloToRating, ordinalToEloScale, DEFAULT_CONVERGENCE_SIGMA } from './core/rating';
export type { Rating } from './core/rating';
export { createCostTracker } from './core/costTracker';
export { ComparisonCache } from './core/comparisonCache';
export type { CachedMatch } from './core/comparisonCache';
export { buildComparisonPrompt, parseWinner, compareWithBiasMitigation } from './comparison';
export type { ComparisonResult } from './comparison';
export { createEvolutionLogger } from './core/logger';
export { createEvolutionLLMClient } from './core/llmClient';
export { executeMinimalPipeline, executeFullPipeline } from './core/pipeline';
export type { PipelineAgents, FullPipelineOptions } from './core/pipeline';
export { PoolSupervisor, supervisorConfigFromRunConfig } from './core/supervisor';
export type { PhaseConfig, SupervisorResumeState, SupervisorConfig } from './core/supervisor';
export { GenerationAgent } from './agents/generationAgent';
export { CalibrationRanker } from './agents/calibrationRanker';
export { PairwiseRanker } from './agents/pairwiseRanker';
export { Tournament } from './agents/tournament';
export { EvolutionAgent } from './agents/evolvePool';
export { ReflectionAgent, CRITIQUE_DIMENSIONS, getCritiqueForVariant, getWeakestDimension, getImprovementSuggestions } from './agents/reflectionAgent';
export type { CritiqueDimension } from './agents/reflectionAgent';
export { MetaReviewAgent } from './agents/metaReviewAgent';
export { DebateAgent } from './agents/debateAgent';
export { IterativeEditingAgent, DEFAULT_ITERATIVE_EDITING_CONFIG } from './agents/iterativeEditingAgent';
export type { IterativeEditingConfig } from './agents/iterativeEditingAgent';
export { TreeSearchAgent } from './agents/treeSearchAgent';
export { compareWithDiff } from './diffComparison';
export type { DiffComparisonResult } from './diffComparison';
export type { DebateTranscript } from './types';
export { ProximityAgent, cosineSimilarity } from './agents/proximityAgent';
export { PoolDiversityTracker, DIVERSITY_THRESHOLDS } from './core/diversityTracker';
export type { DiversityStatus } from './core/diversityTracker';
export { fetchEvolutionFeatureFlags, DEFAULT_EVOLUTION_FLAGS } from './core/featureFlags';
export type { EvolutionFeatureFlags } from './core/featureFlags';
