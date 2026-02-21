// Shared interfaces for the evolution pipeline subsystem.
// All cross-module types live here to enforce a clean import DAG and prevent circular deps.

import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import type { Rating } from './core/rating';
import type { TreeSearchResult, TreeState } from './treeOfThought/types';
import type { SectionEvolutionState } from './section/types';
import { z } from 'zod';

// ─── Agent name union ────────────────────────────────────────────
// String literal union (not derived from keyof PipelineAgents) to avoid importing pipeline types.

export type AgentName =
  | 'generation' | 'calibration' | 'tournament' | 'evolution'
  | 'reflection' | 'iterativeEditing' | 'treeSearch' | 'sectionDecomposition'
  | 'debate' | 'proximity' | 'metaReview' | 'outlineGeneration'
  | 'flowCritique';

// ─── Pipeline phases ─────────────────────────────────────────────

export type PipelinePhase = 'EXPANSION' | 'COMPETITION';

/**
 * Agent-step phases used by validation.ts for state contracts.
 * Unrelated to the supervisor's EXPANSION/COMPETITION phases.
 */
export type AgentStepPhase = 0 | 1 | 2 | 3 | 4 | 5;

// ─── Core data types ─────────────────────────────────────────────

export interface TextVariation {
  id: string;
  text: string;
  version: number;
  parentIds: string[];
  strategy: string;
  createdAt: number; // unix timestamp
  iterationBorn: number;
  /** Cost in USD to generate this variant (for per-variant attribution). */
  costUsd?: number;
}

// ─── Outline generation types (step-level scoring) ──────────────

export type GenerationStepName = 'outline' | 'expand' | 'polish' | 'verify';

/** A single step in the outline generation pipeline with its score and cost. */
export interface GenerationStep {
  name: GenerationStepName;
  input: string;
  output: string;
  /** Step quality score from LLM judge, 0-1. Defaults to 0.5 on parse failure. */
  score: number;
  /** LLM cost in USD for this step. */
  costUsd: number;
}

/** Extends TextVariation with step-level scoring for outline-based generation. */
export interface OutlineVariant extends TextVariation {
  steps: GenerationStep[];
  /** The intermediate outline text (section headings + summaries). */
  outline: string;
  /** Cached weakest step name for mutation targeting. Null if no steps scored. */
  weakestStep: GenerationStepName | null;
}

/** Type guard: returns true if a TextVariation is an OutlineVariant with step data. */
export function isOutlineVariant(v: TextVariation): v is OutlineVariant {
  const candidate = v as OutlineVariant;
  return Array.isArray(candidate.steps) && candidate.steps.length > 0 && 'name' in candidate.steps[0];
}

/** Parse a raw LLM score output to a number in [0, 1], defaulting to 0.5 on failure. */
export function parseStepScore(rawOutput: string): number {
  const parsed = parseFloat(rawOutput);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.5;
}

export interface Critique {
  variationId: string;
  dimensionScores: Record<string, number>;
  goodExamples: Record<string, string[]>;
  badExamples: Record<string, string[]>;
  notes: Record<string, string>;
  reviewer: string;
  /** Score scale: '1-10' for quality critiques (default), '0-5' for flow critiques. */
  scale?: '1-10' | '0-5';
}

export interface MetaFeedback {
  recurringWeaknesses: string[];
  priorityImprovements: string[];
  successfulStrategies: string[];
  patternsToAvoid: string[];
}

export interface DebateTranscript {
  variantAId: string;
  variantBId: string;
  turns: Array<{ role: 'advocate_a' | 'advocate_b' | 'judge'; content: string }>;
  synthesisVariantId: string | null;
  iteration: number;
}

export interface Match {
  variationA: string;
  variationB: string;
  winner: string;
  confidence: number;
  turns: number;
  dimensionScores: Record<string, string>;
  /** Friction sentences from flow comparison (optional, only present when flow is enabled). */
  frictionSpots?: { a: string[]; b: string[] };
}

// ─── Agent types ─────────────────────────────────────────────────

export interface AgentPayload {
  originalText: string;
  title: string;
  explanationId: number | null;
  runId: string;
  config: EvolutionRunConfig;
}

export interface AgentResult {
  agentType: string;
  success: boolean;
  costUsd: number;
  error?: string;
  variantsAdded?: number;
  matchesPlayed?: number;
  convergence?: number;
  skipped?: boolean;
  reason?: string;
  executionDetail?: AgentExecutionDetail;
}

// ─── Agent execution detail types ───────────────────────────────
// Discriminated union for per-agent-invocation structured data.
// Each agent populates its specific detail type during execute().

/** Common fields shared by all execution detail types. */
interface ExecutionDetailBase {
  totalCost: number;
  /** Set by truncateDetail() when JSONB exceeds 100KB cap. */
  _truncated?: boolean;
}

export interface GenerationExecutionDetail extends ExecutionDetailBase {
  detailType: 'generation';
  strategies: Array<{
    name: string;
    promptLength: number;
    status: 'success' | 'format_rejected' | 'error';
    formatIssues?: string[];
    variantId?: string;
    textLength?: number;
    error?: string;
  }>;
  feedbackUsed: boolean;
}

export interface CalibrationExecutionDetail extends ExecutionDetailBase {
  detailType: 'calibration';
  entrants: Array<{
    variantId: string;
    opponents: string[];
    matches: Array<{
      opponentId: string;
      winner: string;
      confidence: number;
      cacheHit: boolean;
    }>;
    earlyExit: boolean;
    ratingBefore: { mu: number; sigma: number };
    ratingAfter: { mu: number; sigma: number };
  }>;
  avgConfidence: number;
  totalMatches: number;
}

export interface TournamentExecutionDetail extends ExecutionDetailBase {
  detailType: 'tournament';
  budgetPressure: number;
  budgetTier: 'low' | 'medium' | 'high';
  rounds: Array<{
    roundNumber: number;
    pairs: Array<{ variantA: string; variantB: string }>;
    matches: Array<Match>;
    multiTurnUsed: number;
  }>;
  exitReason: 'budget' | 'convergence' | 'stale' | 'maxRounds' | 'time_limit';
  convergenceStreak: number;
  staleRounds: number;
  totalComparisons: number;
  flowEnabled: boolean;
}

export interface IterativeEditingExecutionDetail extends ExecutionDetailBase {
  detailType: 'iterativeEditing';
  targetVariantId: string;
  config: { maxCycles: number; maxConsecutiveRejections: number; qualityThreshold: number };
  cycles: Array<{
    cycleNumber: number;
    target: { dimension?: string; description: string; score?: number; source: string };
    verdict: 'ACCEPT' | 'REJECT';
    confidence: number;
    formatValid: boolean;
    formatIssues?: string[];
    newVariantId?: string;
  }>;
  initialCritique: { dimensionScores: Record<string, number> };
  finalCritique?: { dimensionScores: Record<string, number> };
  stopReason: 'threshold_met' | 'max_rejections' | 'max_cycles' | 'no_targets';
  consecutiveRejections: number;
}

export interface ReflectionExecutionDetail extends ExecutionDetailBase {
  detailType: 'reflection';
  variantsCritiqued: Array<{
    variantId: string;
    status: 'success' | 'parse_failed' | 'error';
    avgScore?: number;
    dimensionScores?: Record<string, number>;
    goodExamples?: Record<string, string[]>;
    badExamples?: Record<string, string[]>;
    notes?: Record<string, string>;
    error?: string;
  }>;
  dimensions: string[];
}

export interface DebateExecutionDetail extends ExecutionDetailBase {
  detailType: 'debate';
  variantA: { id: string; ordinal: number };
  variantB: { id: string; ordinal: number };
  transcript: Array<{ role: 'advocate_a' | 'advocate_b' | 'judge'; content: string }>;
  judgeVerdict?: {
    winner: 'A' | 'B' | 'tie';
    reasoning: string;
    strengthsFromA: string[];
    strengthsFromB: string[];
    improvements: string[];
  };
  synthesisVariantId?: string;
  synthesisTextLength?: number;
  formatValid?: boolean;
  formatIssues?: string[];
  failurePoint?: 'advocate_a' | 'advocate_b' | 'judge' | 'parse' | 'format' | 'synthesis';
}

export interface SectionDecompositionExecutionDetail extends ExecutionDetailBase {
  detailType: 'sectionDecomposition';
  targetVariantId: string;
  weakness: { dimension: string; description: string };
  sections: Array<{
    index: number;
    heading: string | null;
    eligible: boolean;
    improved: boolean;
    charCount: number;
  }>;
  sectionsImproved: number;
  totalEligible: number;
  formatValid: boolean;
  newVariantId?: string;
}

export interface EvolutionExecutionDetail extends ExecutionDetailBase {
  detailType: 'evolution';
  parents: Array<{ id: string; ordinal: number }>;
  mutations: Array<{
    strategy: string;
    status: 'success' | 'format_rejected' | 'error';
    variantId?: string;
    textLength?: number;
    error?: string;
  }>;
  creativeExploration: boolean;
  creativeReason?: 'random' | 'low_diversity';
  overrepresentedStrategies?: string[];
  feedbackUsed: boolean;
}

export interface TreeSearchExecutionDetail extends ExecutionDetailBase {
  detailType: 'treeSearch';
  rootVariantId: string;
  config: { beamWidth: number; branchingFactor: number; maxDepth: number };
  result: {
    treeSize: number;
    maxDepth: number;
    prunedBranches: number;
    revisionPath: Array<{ type: string; dimension?: string; description: string }>;
  };
  bestLeafVariantId?: string;
  addedToPool: boolean;
}

export interface OutlineGenerationExecutionDetail extends ExecutionDetailBase {
  detailType: 'outlineGeneration';
  steps: Array<{
    name: 'outline' | 'expand' | 'polish' | 'verify';
    score: number;
    costUsd: number;
    inputLength: number;
    outputLength: number;
  }>;
  weakestStep: string | null;
  variantId: string;
}

export interface ProximityExecutionDetail extends ExecutionDetailBase {
  detailType: 'proximity';
  newEntrants: number;
  existingVariants: number;
  diversityScore: number;
  totalPairsComputed: number;
}

export interface MetaReviewExecutionDetail extends ExecutionDetailBase {
  detailType: 'metaReview';
  successfulStrategies: string[];
  recurringWeaknesses: string[];
  patternsToAvoid: string[];
  priorityImprovements: string[];
  analysis: {
    strategyOrdinals: Record<string, number>;
    bottomQuartileCount: number;
    poolDiversity: number;
    ordinalRange: number;
    activeStrategies: number;
    topVariantAge: number;
  };
}

/** Discriminated union of all agent execution detail types. */
export type AgentExecutionDetail =
  | GenerationExecutionDetail
  | CalibrationExecutionDetail
  | TournamentExecutionDetail
  | IterativeEditingExecutionDetail
  | ReflectionExecutionDetail
  | DebateExecutionDetail
  | SectionDecompositionExecutionDetail
  | EvolutionExecutionDetail
  | TreeSearchExecutionDetail
  | OutlineGenerationExecutionDetail
  | ProximityExecutionDetail
  | MetaReviewExecutionDetail;

// ─── Execution context (Decision 4) ─────────────────────────────

export interface ExecutionContext {
  payload: AgentPayload;
  state: PipelineState;
  llmClient: EvolutionLLMClient;
  logger: EvolutionLogger;
  costTracker: CostTracker;
  runId: string;
  /** Optional comparison cache shared across agents within a run. */
  comparisonCache?: import('./core/comparisonCache').ComparisonCache;
  /** Time context for intra-agent time awareness (e.g., tournament yielding before Vercel deadline). */
  timeContext?: {
    startMs: number;
    maxDurationMs: number;
  };
}

// ─── Pipeline state interface ────────────────────────────────────

export interface PipelineState {
  // Phase 0: Pool fields
  iteration: number;
  originalText: string;
  pool: TextVariation[];
  poolIds: Set<string>;
  newEntrantsThisIteration: string[];

  // Phase 1+2: Ranking fields
  ratings: Map<string, Rating>;
  matchCounts: Map<string, number>;
  matchHistory: Match[];

  // Phase 3: Review fields
  dimensionScores: Record<string, Record<string, number>> | null;
  allCritiques: Critique[] | null;

  // Phase 4: Proximity fields
  similarityMatrix: Record<string, Record<string, number>> | null;
  diversityScore: number | null;

  // Phase 5: Meta-review fields
  metaFeedback: MetaFeedback | null;

  // Phase 6: Debate fields
  debateTranscripts: DebateTranscript[];

  // Tree search fields (optional — populated when TreeSearchAgent runs)
  treeSearchResults: TreeSearchResult[] | null;
  treeSearchStates: TreeState[] | null;

  // Section decomposition state (null when not used)
  sectionState: SectionEvolutionState | null;

  // Pool management methods
  addToPool(variation: TextVariation): void;
  startNewIteration(): void;
  getTopByRating(n: number): TextVariation[];
  getPoolSize(): number;
}

// ─── LLM client interface (Decision 10) ──────────────────────────

export interface LLMCompletionOptions {
  model?: AllowedLLMModelType;
  debug?: boolean;
}

export interface EvolutionLLMClient {
  complete(
    prompt: string,
    agentName: string,
    options?: LLMCompletionOptions,
  ): Promise<string>;

  completeStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    schemaName: string,
    agentName: string,
    options?: LLMCompletionOptions,
  ): Promise<T>;
}

// ─── Logger interface (Decision 8) ───────────────────────────────

export interface EvolutionLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  /** Flush buffered DB log entries. No-op if DB logging is not enabled. */
  flush?(): Promise<void>;
}

// ─── Cost tracker interface (Decision 6) ─────────────────────────

export interface CostTracker {
  reserveBudget(agentName: string, estimatedCost: number): Promise<void>;
  recordSpend(agentName: string, actualCost: number): void;
  getAgentCost(agentName: string): number;
  getTotalSpent(): number;
  getAvailableBudget(): number;
  /** Returns all agent costs as a record for persistence/reporting. */
  getAllAgentCosts(): Record<string, number>;
  /** Sum of outstanding (not yet reconciled) budget reservations. */
  getTotalReserved(): number;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly spent: number,
    public readonly cap: number,
  ) {
    super(`Budget exceeded for ${agentName}: spent $${spent.toFixed(4)}, cap $${cap.toFixed(4)}`);
    this.name = 'BudgetExceededError';
  }
}

export class LLMRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMRefusalError';
  }
}

export class CheckpointNotFoundError extends Error {
  constructor(runId: string) {
    super(`No checkpoint found for run ${runId}`);
    this.name = 'CheckpointNotFoundError';
  }
}

export class CheckpointCorruptedError extends Error {
  constructor(runId: string, cause?: string) {
    super(`Checkpoint corrupted for run ${runId}${cause ? `: ${cause}` : ''}`);
    this.name = 'CheckpointCorruptedError';
  }
}

// ─── Evolution run config (per-run overrides) ────────────────────

export interface EvolutionRunConfig {
  maxIterations: number;
  budgetCapUsd: number;
  plateau: { window: number; threshold: number };
  expansion: {
    minPool: number;
    diversityThreshold: number;
    maxIterations: number;
  };
  generation: { strategies: number };
  calibration: { opponents: number; minOpponents?: number };
  /** Tournament-phase settings. topK limits comparisons to the top K variants above baseline. */
  tournament: { topK: number };
  budgetCaps: Record<string, number>;
  /** Model for comparison/judge calls (calibration, pairwise, tournament). */
  judgeModel?: AllowedLLMModelType;
  /** Model for text generation calls (generation, evolution). */
  generationModel?: AllowedLLMModelType;
  /** When true, runs single-article mode: no generation/evolution, just sequential improvement. */
  singleArticle?: boolean;
  /** Optional agents to enable for this run. Undefined = all agents (backward compat). */
  enabledAgents?: AgentName[];
}

// ─── Checkpoint types ────────────────────────────────────────────

export interface Checkpoint {
  runId: string;
  iteration: number;
  phase: PipelinePhase;
  lastAgent: string;
  stateSnapshot: SerializedPipelineState;
}

/** JSON-serializable version of PipelineState for checkpoint storage. */
export interface SerializedPipelineState {
  iteration: number;
  originalText: string;
  pool: TextVariation[];
  newEntrantsThisIteration: string[];
  ratings: Record<string, { mu: number; sigma: number }>;
  /** @deprecated Old Elo format — only present in legacy checkpoints. */
  eloRatings?: Record<string, number>;
  matchCounts: Record<string, number>;
  matchHistory: Match[];
  dimensionScores: Record<string, Record<string, number>> | null;
  allCritiques: Critique[] | null;
  similarityMatrix: Record<string, Record<string, number>> | null;
  diversityScore: number | null;
  metaFeedback: MetaFeedback | null;
  debateTranscripts: DebateTranscript[];
  treeSearchResults?: TreeSearchResult[] | null;
  treeSearchStates?: TreeState[] | null;
  sectionState?: SectionEvolutionState | null;
  /** COST-6: CostTracker totalSpent at checkpoint time (default 0 for backward compat). */
  costTrackerTotalSpent?: number;
  /** ERR-3: ComparisonCache entries for resume (default empty for backward compat). */
  comparisonCacheEntries?: Array<[string, { winnerId: string | null; loserId: string | null; confidence: number; isDraw: boolean }]>;
}

/** Superset of SerializedPipelineState with sidecar fields stored alongside the checkpoint. */
export interface SerializedCheckpoint extends SerializedPipelineState {
  supervisorState?: import('./core/supervisor').SupervisorResumeState;
  /** Agent names remaining when a mid-iteration continuation yield occurred. */
  resumeAgentNames?: string[];
}

// ─── Evolution run status ────────────────────────────────────────

export type EvolutionRunStatus = 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'paused' | 'continuation_pending';

export type PipelineType = 'full' | 'minimal' | 'batch' | 'single';

export const PIPELINE_TYPES = ['full', 'minimal', 'batch', 'single'] as const satisfies readonly PipelineType[];

/** Metadata columns on hall_of_fame_topics (prompt registry). */
export interface PromptMetadata {
  id: string;
  prompt: string;
  title: string;
  difficulty_tier: string | null;
  domain_tags: string[];
  status: 'active' | 'archived';
  deleted_at: string | null;
  created_at: string;
}

export const BASELINE_STRATEGY = 'original_baseline' as const;

// ─── Evolution run summary (persisted as JSONB) ─────────────────

export interface EvolutionRunSummary {
  version: 2;
  stopReason: string;
  finalPhase: PipelinePhase;
  totalIterations: number;
  durationSeconds: number;
  ordinalHistory: number[];
  diversityHistory: number[];
  matchStats: {
    totalMatches: number;
    avgConfidence: number;
    decisiveRate: number;
  };
  topVariants: Array<{
    id: string;
    strategy: string;
    ordinal: number;
    isBaseline: boolean;
  }>;
  baselineRank: number | null;
  baselineOrdinal: number | null;
  strategyEffectiveness: Record<string, {
    count: number;
    avgOrdinal: number;
  }>;
  metaFeedback: {
    successfulStrategies: string[];
    recurringWeaknesses: string[];
    patternsToAvoid: string[];
    priorityImprovements: string[];
  } | null;
}

/** V2 schema — the canonical shape used by current code. */
const EvolutionRunSummaryV2Schema = z.object({
  version: z.literal(2),
  stopReason: z.string().max(200),
  finalPhase: z.enum(['EXPANSION', 'COMPETITION']),
  totalIterations: z.number().int().min(0).max(100),
  durationSeconds: z.number().min(0),
  ordinalHistory: z.array(z.number()).max(100),
  diversityHistory: z.array(z.number()).max(100),
  matchStats: z.object({
    totalMatches: z.number().int().min(0),
    avgConfidence: z.number().min(0).max(1),
    decisiveRate: z.number().min(0).max(1),
  }),
  topVariants: z.array(z.object({
    id: z.string().max(200),
    strategy: z.string().max(100),
    ordinal: z.number(),
    isBaseline: z.boolean(),
  })).max(10),
  baselineRank: z.number().int().min(1).nullable(),
  baselineOrdinal: z.number().nullable(),
  strategyEffectiveness: z.record(z.string(), z.object({
    count: z.number().int().min(0),
    avgOrdinal: z.number(),
  })),
  metaFeedback: z.object({
    successfulStrategies: z.array(z.string().min(1).max(200)).max(10),
    recurringWeaknesses: z.array(z.string().min(1).max(200)).max(10),
    patternsToAvoid: z.array(z.string().min(1).max(200)).max(10),
    priorityImprovements: z.array(z.string().min(1).max(200)).max(10),
  }).nullable(),
}).strict();

/** V1 schema — legacy format with Elo field names. Auto-transforms to V2 on parse. */
const EvolutionRunSummaryV1Schema = z.object({
  version: z.literal(1).optional(),
  stopReason: z.string().max(200),
  finalPhase: z.enum(['EXPANSION', 'COMPETITION']),
  totalIterations: z.number().int().min(0).max(100),
  durationSeconds: z.number().min(0),
  eloHistory: z.array(z.number()).max(100),
  diversityHistory: z.array(z.number()).max(100),
  matchStats: z.object({
    totalMatches: z.number().int().min(0),
    avgConfidence: z.number().min(0).max(1),
    decisiveRate: z.number().min(0).max(1),
  }),
  topVariants: z.array(z.object({
    id: z.string().max(200),
    strategy: z.string().max(100),
    elo: z.number(),
    isBaseline: z.boolean(),
  })).max(10),
  baselineRank: z.number().int().min(1).nullable(),
  baselineElo: z.number().nullable(),
  strategyEffectiveness: z.record(z.string(), z.object({
    count: z.number().int().min(0),
    avgElo: z.number(),
  })),
  metaFeedback: z.object({
    successfulStrategies: z.array(z.string().min(1).max(200)).max(10),
    recurringWeaknesses: z.array(z.string().min(1).max(200)).max(10),
    patternsToAvoid: z.array(z.string().min(1).max(200)).max(10),
    priorityImprovements: z.array(z.string().min(1).max(200)).max(10),
  }).nullable(),
}).transform((v1): EvolutionRunSummary => ({
  version: 2,
  stopReason: v1.stopReason,
  finalPhase: v1.finalPhase,
  totalIterations: v1.totalIterations,
  durationSeconds: v1.durationSeconds,
  ordinalHistory: v1.eloHistory,
  diversityHistory: v1.diversityHistory,
  matchStats: v1.matchStats,
  topVariants: v1.topVariants.map((tv) => ({
    id: tv.id, strategy: tv.strategy, ordinal: tv.elo, isBaseline: tv.isBaseline,
  })),
  baselineRank: v1.baselineRank,
  baselineOrdinal: v1.baselineElo,
  strategyEffectiveness: Object.fromEntries(
    Object.entries(v1.strategyEffectiveness).map(([k, v]) => [k, { count: v.count, avgOrdinal: v.avgElo }]),
  ),
  metaFeedback: v1.metaFeedback,
}));

/** Accepts both V1 (legacy Elo) and V2 (OpenSkill ordinal) summary formats. */
export const EvolutionRunSummarySchema = z.union([
  EvolutionRunSummaryV2Schema,
  EvolutionRunSummaryV1Schema,
]);
