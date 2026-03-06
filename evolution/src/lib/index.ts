// Public API for the evolution pipeline subsystem.
// Re-exports the types, config, and key classes needed by server actions and admin UI.

// Local imports for factories (re-exports below don't create local bindings)
import { PipelineStateImpl as _PipelineStateImpl } from './core/state';
import { createCostTracker as _createCostTracker, createCostTrackerFromCheckpoint as _createCostTrackerFromCheckpoint } from './core/costTracker';
import { createDbEvolutionLogger as _createDbEvolutionLogger } from './core/logger';
import { createEvolutionLLMClient as _createEvolutionLLMClient } from './core/llmClient';
import { resolveConfig as _resolveConfig } from './config';
import { computeEffectiveBudgetCaps as _computeEffectiveBudgetCaps } from './core/budgetRedistribution';
import { validateRunConfig as _validateRunConfig } from './core/configValidation';
import type { EvolutionRunConfig, EvolutionLLMClient, ExecutionContext } from './types';
import type { PipelineAgents } from './core/pipeline';
import type { CostTrackerImpl } from './core/costTracker';

import { GenerationAgent as _GenerationAgent } from './agents/generationAgent';
import { CalibrationRanker as _CalibrationRanker } from './agents/calibrationRanker';
import { Tournament as _Tournament } from './agents/tournament';
import { EvolutionAgent as _EvolutionAgent } from './agents/evolvePool';
import { ReflectionAgent as _ReflectionAgent } from './agents/reflectionAgent';
import { IterativeEditingAgent as _IterativeEditingAgent } from './agents/iterativeEditingAgent';
import { TreeSearchAgent as _TreeSearchAgent } from './agents/treeSearchAgent';
import { SectionDecompositionAgent as _SectionDecompositionAgent } from './agents/sectionDecompositionAgent';
import { DebateAgent as _DebateAgent } from './agents/debateAgent';
import { ProximityAgent as _ProximityAgent } from './agents/proximityAgent';
import { MetaReviewAgent as _MetaReviewAgent } from './agents/metaReviewAgent';
import { OutlineGenerationAgent as _OutlineGenerationAgent } from './agents/outlineGenerationAgent';

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
  SerializedCheckpoint,
  OutlineVariant,
  GenerationStep,
  GenerationStepName,
} from './types';
export { BudgetExceededError, LLMRefusalError, BASELINE_STRATEGY, EvolutionRunSummarySchema, isOutlineVariant, parseStepScore } from './types';
export type { EvolutionRunSummary } from './types';
export { DEFAULT_EVOLUTION_CONFIG, resolveConfig } from './config';
export { PipelineStateImpl, serializeState, deserializeState, MAX_MATCH_HISTORY, MAX_CRITIQUE_ITERATIONS } from './core/state';
export { createRating, updateRating, updateDraw, getOrdinal, isConverged, eloToRating, ordinalToEloScale, DEFAULT_CONVERGENCE_SIGMA } from './core/rating';
export type { Rating } from './core/rating';
export { createCostTracker, createCostTrackerFromCheckpoint } from './core/costTracker';
export { estimateRunCostWithAgentModels, computeCostPrediction, refreshAgentCostBaselines, RunCostEstimateSchema, CostPredictionSchema } from './core/costEstimator';
export type { RunCostEstimate, CostPrediction } from './core/costEstimator';
export { ComparisonCache, MAX_CACHE_SIZE } from './core/comparisonCache';
export type { CachedMatch } from './core/comparisonCache';
export { buildComparisonPrompt, parseWinner, compareWithBiasMitigation } from './comparison';
export type { ComparisonResult } from './comparison';
export { createEvolutionLogger, createDbEvolutionLogger, LogBuffer } from './core/logger';
export { createEvolutionLLMClient } from './core/llmClient';
export { executeMinimalPipeline, executeFullPipeline } from './core/pipeline';
export type { PipelineAgents, FullPipelineOptions } from './core/pipeline';
export { PoolSupervisor, supervisorConfigFromRunConfig } from './core/supervisor';
export type { PhaseConfig, SupervisorResumeState, SupervisorConfig } from './core/supervisor';
export { GenerationAgent } from './agents/generationAgent';
export { OutlineGenerationAgent } from './agents/outlineGenerationAgent';
export { CalibrationRanker } from './agents/calibrationRanker';
export { PairwiseRanker } from './agents/pairwiseRanker';
export { Tournament } from './agents/tournament';
export { EvolutionAgent } from './agents/evolvePool';
export { ReflectionAgent, getCritiqueForVariant, getWeakestDimension, getImprovementSuggestions } from './agents/reflectionAgent';
export type { CritiqueDimension } from './agents/reflectionAgent';
export { QUALITY_DIMENSIONS, FLOW_DIMENSIONS, normalizeScore, getFlowCritiqueForVariant, getWeakestDimensionAcrossCritiques, buildQualityCritiquePrompt } from './flowRubric';
export type { ScaleType, WeakestDimensionResult, FlowComparisonResult, FlowCritiqueResult } from './flowRubric';
export { MetaReviewAgent } from './agents/metaReviewAgent';
export { DebateAgent } from './agents/debateAgent';
export { IterativeEditingAgent, DEFAULT_ITERATIVE_EDITING_CONFIG } from './agents/iterativeEditingAgent';
export type { IterativeEditingConfig } from './agents/iterativeEditingAgent';
export { TreeSearchAgent } from './agents/treeSearchAgent';
export { SectionDecompositionAgent } from './agents/sectionDecompositionAgent';
export { compareWithDiff } from './diffComparison';
export type { DiffComparisonResult } from './diffComparison';
export type { DebateTranscript } from './types';
export { ProximityAgent, cosineSimilarity } from './agents/proximityAgent';
export { PoolDiversityTracker, DIVERSITY_THRESHOLDS } from './core/diversityTracker';
export type { DiversityStatus } from './core/diversityTracker';
export { isTransientError } from './core/errorClassification';
export { loadCheckpointForResume, checkpointAndMarkContinuationPending } from './core/persistence';
export type { CheckpointResumeData } from './core/persistence';
export { CheckpointNotFoundError, CheckpointCorruptedError } from './types';
export { createTextVariation } from './core/textVariationFactory';
export { computeEffectiveBudgetCaps, validateAgentSelection, enabledAgentsSchema, REQUIRED_AGENTS, OPTIONAL_AGENTS, AGENT_DEPENDENCIES } from './core/budgetRedistribution';
export { isTestEntry, validateStrategyConfig, validateRunConfig } from './core/configValidation';
export { toggleAgent } from './core/agentToggle';
export type { ArticleSection, ParsedArticle, SectionVariation, SectionEvolutionState } from './section/types';
export { parseArticleIntoSections } from './section/sectionParser';
export { stitchSections, stitchWithReplacements } from './section/sectionStitcher';
export type { StitchResult } from './section/sectionStitcher';

// ─── Agent Factory ───────────────────────────────────────────────

/**
 * Create the default set of all 12 pipeline agents.
 * Single source of truth for agent construction — all callsites should use this
 * instead of manually constructing agents to prevent agent-gap divergence.
 */
export function createDefaultAgents(): PipelineAgents {
  return {
    generation: new _GenerationAgent(),
    calibration: new _CalibrationRanker(),
    tournament: new _Tournament(),
    evolution: new _EvolutionAgent(),
    reflection: new _ReflectionAgent(),
    iterativeEditing: new _IterativeEditingAgent(),
    treeSearch: new _TreeSearchAgent(),
    sectionDecomposition: new _SectionDecompositionAgent(),
    debate: new _DebateAgent(),
    proximity: new _ProximityAgent(),
    metaReview: new _MetaReviewAgent(),
    outlineGeneration: new _OutlineGenerationAgent(),
  };
}

// ─── Pipeline Run Factory ───────────────────────────────────────

/** Inputs for preparePipelineRun(). llmClient OR llmClientId must be provided. */
export interface PipelineRunInputs {
  runId: string;
  originalText: string;
  title: string;
  explanationId: number | null;
  configOverrides?: Partial<EvolutionRunConfig>;
  /** Identifier for the LLM client (e.g. 'evolution-cron'). Ignored when llmClient is set. */
  llmClientId?: string;
  /** Pre-built LLM client. If omitted, creates standard client using llmClientId. */
  llmClient?: EvolutionLLMClient;
}

/** Output of preparePipelineRun() — everything needed to call executeFullPipeline. */
export interface PreparedPipelineRun {
  ctx: ExecutionContext;
  agents: PipelineAgents;
  config: EvolutionRunConfig;
  costTracker: CostTrackerImpl;
  logger: import('./types').EvolutionLogger;
}

/**
 * Create a fully-configured pipeline context and agents from minimal inputs.
 * Consolidates the ~15 lines of boilerplate repeated in every callsite.
 */
export function preparePipelineRun(inputs: PipelineRunInputs): PreparedPipelineRun {
  const config = _resolveConfig(inputs.configOverrides ?? {});

  // Validate complete config after resolveConfig merges defaults
  const validation = _validateRunConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid run config: ${validation.errors.join('; ')}`);
  }

  // Redistribute budget caps based on enabled agents (before CostTracker creation)
  config.budgetCaps = _computeEffectiveBudgetCaps(
    config.budgetCaps,
    config.enabledAgents,
    config.singleArticle ?? false,
  );
  const state = new _PipelineStateImpl(inputs.originalText);
  const costTracker = _createCostTracker(config);
  const logger = _createDbEvolutionLogger(inputs.runId);

  if (!inputs.llmClient && !inputs.llmClientId) {
    throw new Error('preparePipelineRun: either llmClient or llmClientId must be provided');
  }

  const llmClient = inputs.llmClient ?? _createEvolutionLLMClient(costTracker, logger);

  const ctx: ExecutionContext = {
    payload: {
      originalText: inputs.originalText,
      title: inputs.title,
      explanationId: inputs.explanationId,
      runId: inputs.runId,
      config,
    },
    state,
    llmClient,
    logger,
    costTracker,
    runId: inputs.runId,
  };

  return { ctx, agents: createDefaultAgents(), config, costTracker, logger };
}

// ─── Resumed Pipeline Run Factory ───────────────────────────────

/** Inputs for prepareResumedPipelineRun(). */
export interface ResumedPipelineRunInputs {
  runId: string;
  title: string;
  explanationId: number | null;
  configOverrides?: Partial<EvolutionRunConfig>;
  llmClientId: string;
  /** Checkpoint data from loadCheckpointForResume(). */
  checkpointData: import('./core/persistence').CheckpointResumeData;
}

/** Output of prepareResumedPipelineRun() — everything needed to call executeFullPipeline with resume. */
export interface PreparedResumedPipelineRun {
  ctx: ExecutionContext;
  agents: PipelineAgents;
  config: EvolutionRunConfig;
  costTracker: CostTrackerImpl;
  logger: import('./types').EvolutionLogger;
  supervisorResume?: import('./core/supervisor').SupervisorResumeState;
  resumeComparisonCacheEntries?: Array<[string, import('./core/comparisonCache').CachedMatch]>;
}

/**
 * Create a fully-configured pipeline context from checkpoint data for resume.
 * Mirrors preparePipelineRun but restores state, cost tracker, and supervisor from checkpoint.
 */
export function prepareResumedPipelineRun(inputs: ResumedPipelineRunInputs): PreparedResumedPipelineRun {
  const { checkpointData } = inputs;
  const config = _resolveConfig(inputs.configOverrides ?? {});

  const validation = _validateRunConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid run config: ${validation.errors.join('; ')}`);
  }

  config.budgetCaps = _computeEffectiveBudgetCaps(
    config.budgetCaps,
    config.enabledAgents,
    config.singleArticle ?? false,
  );

  // Restore cost tracker with prior spend from checkpoint
  const costTracker = _createCostTrackerFromCheckpoint(config, checkpointData.costTrackerTotalSpent);
  const logger = _createDbEvolutionLogger(inputs.runId);
  const llmClient = _createEvolutionLLMClient(costTracker, logger);

  const ctx: ExecutionContext = {
    payload: {
      originalText: checkpointData.state.originalText,
      title: inputs.title,
      explanationId: inputs.explanationId,
      runId: inputs.runId,
      config,
    },
    state: checkpointData.state,
    llmClient,
    logger,
    costTracker,
    runId: inputs.runId,
  };

  return {
    ctx,
    agents: createDefaultAgents(),
    config,
    costTracker,
    logger,
    supervisorResume: checkpointData.supervisorState,
    resumeComparisonCacheEntries: checkpointData.comparisonCacheEntries,
  };
}
