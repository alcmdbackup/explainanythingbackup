// Public API for the evolution pipeline subsystem.
// Re-exports the types, config, and key classes needed by server actions and admin UI.

// Local imports for factories (re-exports below don't create local bindings)
import { PipelineStateImpl as _PipelineStateImpl } from './core/state';
import { createCostTracker as _createCostTracker, createCostTrackerFromCheckpoint as _createCostTrackerFromCheckpoint } from './core/costTracker';
import { createDbEvolutionLogger as _createDbEvolutionLogger } from './core/logger';
import { createEvolutionLLMClient as _createEvolutionLLMClient } from './core/llmClient';
import { resolveConfig as _resolveConfig } from './config';
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
export { DEFAULT_EVOLUTION_CONFIG, resolveConfig, MAX_RUN_BUDGET_USD, MAX_EXPERIMENT_BUDGET_USD } from './config';
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
export { isTransientError } from './core/errorClassification';
export { loadCheckpointForResume, checkpointAndMarkContinuationPending } from './core/persistence';
export type { CheckpointResumeData } from './core/persistence';
export { CheckpointNotFoundError, CheckpointCorruptedError } from './types';
export { createTextVariation } from './core/textVariationFactory';
export { validateAgentSelection, enabledAgentsSchema, REQUIRED_AGENTS, OPTIONAL_AGENTS, AGENT_DEPENDENCIES, isAgentActive, SINGLE_ARTICLE_DISABLED } from './core/agentConfiguration';
export { isTestEntry, validateStrategyConfig, validateRunConfig } from './core/configValidation';
export { toggleAgent } from './core/agentConfiguration';
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

/** Inputs for preparePipelineRun(). For fresh runs, provide originalText. For resumes, provide checkpointData. */
export interface PipelineRunInputs {
  runId: string;
  title: string;
  explanationId: number | null;
  configOverrides?: Partial<EvolutionRunConfig>;
  /** Identifier for the LLM client (e.g. 'evolution-cron'). Ignored when llmClient is set. */
  llmClientId?: string;
  /** Pre-built LLM client. If omitted, creates standard client using llmClientId. */
  llmClient?: EvolutionLLMClient;
  /** Original text for fresh runs. Required when checkpointData is not provided. */
  originalText?: string;
  /** Checkpoint data for resumed runs. When set, state/cost are restored from checkpoint. */
  checkpointData?: import('./core/persistence').CheckpointResumeData;
}

/** Output of preparePipelineRun() — everything needed to call executeFullPipeline. */
export interface PreparedPipelineRun {
  ctx: ExecutionContext;
  agents: PipelineAgents;
  config: EvolutionRunConfig;
  costTracker: CostTrackerImpl;
  logger: import('./types').EvolutionLogger;
  supervisorResume?: import('./core/supervisor').SupervisorResumeState;
}

/**
 * Create a fully-configured pipeline context and agents.
 * For fresh runs, provide originalText. For resumed runs, provide checkpointData.
 */
export function preparePipelineRun(inputs: PipelineRunInputs): PreparedPipelineRun {
  const config = _resolveConfig(inputs.configOverrides ?? {});

  const validation = _validateRunConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid run config: ${validation.errors.join('; ')}`);
  }

  const isResume = !!inputs.checkpointData;
  const originalText = isResume ? inputs.checkpointData!.state.originalText : inputs.originalText;
  if (!originalText) {
    throw new Error('preparePipelineRun: either originalText or checkpointData must be provided');
  }

  const state = isResume ? inputs.checkpointData!.state : new _PipelineStateImpl(originalText);
  const costTracker = isResume
    ? _createCostTrackerFromCheckpoint(config, inputs.checkpointData!.costTrackerTotalSpent)
    : _createCostTracker(config);
  const logger = _createDbEvolutionLogger(inputs.runId);

  if (!inputs.llmClient && !inputs.llmClientId) {
    throw new Error('preparePipelineRun: either llmClient or llmClientId must be provided');
  }

  const llmClient = inputs.llmClient ?? _createEvolutionLLMClient(costTracker, logger);

  const ctx: ExecutionContext = {
    payload: {
      originalText,
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

  return {
    ctx,
    agents: createDefaultAgents(),
    config,
    costTracker,
    logger,
    ...(isResume && { supervisorResume: inputs.checkpointData!.supervisorState }),
  };
}

