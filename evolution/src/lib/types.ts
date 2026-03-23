// Shared interfaces for the evolution pipeline subsystem.
// All cross-module types live here to enforce a clean import DAG and prevent circular deps.

import { z } from 'zod';

import type { AllowedLLMModelType } from '@/lib/schemas/schemas';

import { v4 as uuidv4 } from 'uuid';
import type { Rating } from './shared/computeRatings';
import type { VariantSchema, CritiqueSchema, MetaFeedbackSchema } from './schemas';

// Stub types retained for backward compatibility after V1 removal
type PipelineAction = { type: string; [key: string]: unknown };
type SectionEvolutionState = Record<string, unknown>;
type TreeSearchResult = Record<string, unknown>;
type TreeState = Record<string, unknown>;

// ─── Agent name union ────────────────────────────────────────────
// String literal union (not derived from keyof PipelineAgents) to avoid importing pipeline types.

export type AgentName =
  | 'generation' | 'ranking' | 'evolution'
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

/** Core in-memory variant type, derived from variantSchema. */
export type Variant = VariantSchema;

// ─── Variant factory ────────────────────────────────────────────

interface CreateVariantParams {
  text: string;
  strategy: string;
  iterationBorn: number;
  parentIds?: string[];
  version?: number;
  costUsd?: number;
}

export function createVariant(params: CreateVariantParams): Variant {
  return {
    id: uuidv4(),
    text: params.text,
    strategy: params.strategy,
    iterationBorn: params.iterationBorn,
    parentIds: params.parentIds ?? [],
    version: params.version ?? 0,
    createdAt: Date.now() / 1000,
    ...(params.costUsd !== undefined && { costUsd: params.costUsd }),
  };
}

/** @deprecated Use Variant */ export type TextVariation = Variant;
/** @deprecated Use CreateVariantParams */ export type CreateTextVariationParams = CreateVariantParams;
/** @deprecated Use createVariant */ export const createTextVariation = createVariant;

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

/** Extends Variant with step-level scoring for outline-based generation. */
export interface OutlineVariant extends Variant {
  steps: GenerationStep[];
  /** The intermediate outline text (section headings + summaries). */
  outline: string;
  /** Cached weakest step name for mutation targeting. Null if no steps scored. */
  weakestStep: GenerationStepName | null;
}

export function isOutlineVariant(v: Variant): v is OutlineVariant {
  const candidate = v as Partial<OutlineVariant>;
  return Array.isArray(candidate.steps) && candidate.steps.length > 0 && 'name' in candidate.steps[0]!;
}

/** Parse raw LLM score to [0, 1], defaulting to 0.5 on failure. */
export function parseStepScore(rawOutput: string): number {
  const parsed = parseFloat(rawOutput);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.5;
}

/** Quality feedback with dimension scores, derived from critiqueSchema. */
export type Critique = CritiqueSchema;

/** Aggregated insights from meta-review, derived from metaFeedbackSchema. */
export type MetaFeedback = MetaFeedbackSchema;

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
  config: import('./pipeline/infra/types').EvolutionConfig;
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
  /** State mutations as data — agents return actions instead of mutating state directly. */
  actions: PipelineAction[];
}

// ─── Agent execution detail types ───────────────────────────────

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
  variantA: { id: string; mu: number };
  variantB: { id: string; mu: number };
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
  parents: Array<{ id: string; mu: number }>;
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

export interface RankingExecutionDetail extends ExecutionDetailBase {
  detailType: 'ranking';
  triage: Array<{
    variantId: string;
    opponents: string[];
    matches: Array<{
      opponentId: string;
      winner: string;
      confidence: number;
      cacheHit: boolean;
    }>;
    eliminated: boolean;
    ratingBefore: { mu: number; sigma: number };
    ratingAfter: { mu: number; sigma: number };
  }>;
  fineRanking: {
    rounds: number;
    exitReason: 'budget' | 'convergence' | 'stale' | 'maxRounds' | 'time_limit' | 'no_contenders';
    convergenceStreak: number;
  };
  budgetPressure: number;
  budgetTier: 'low' | 'medium' | 'high';
  top20Cutoff: number;
  eligibleContenders: number;
  totalComparisons: number;
  flowEnabled: boolean;
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
    strategyMus: Record<string, number>;
    bottomQuartileCount: number;
    poolDiversity: number;
    muRange: number;
    activeStrategies: number;
    topVariantAge: number;
  };
}

export type AgentExecutionDetail =
  | GenerationExecutionDetail
  | RankingExecutionDetail
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
  state: ReadonlyPipelineState;
  llmClient: EvolutionLLMClient;
  logger: EvolutionLogger;
  costTracker: CostTracker;
  runId: string;
  /** UUID of the current invocation row — set by pipeline, immutable per agent scope. */
  invocationId?: string;
  /** Optional comparison cache shared across agents within a run. */
  comparisonCache?: import('./shared/computeRatings').ComparisonCache;
  /** Time context for intra-agent time awareness (e.g., tournament yielding before Vercel deadline). */
  timeContext?: {
    startMs: number;
    maxDurationMs: number;
  };
  /** Optional embedding function for semantic similarity (e.g., OpenAI text-embedding-3-large). */
  embedText?: (text: string) => Promise<number[]>;
  /** Arena topic ID resolved at pipeline start (used for syncToArena at finalization). */
  arenaTopicId?: string;
}

// ─── Pipeline state interface ────────────────────────────────────

export interface ReadonlyPipelineState {
  // --- Pool ---
  readonly originalText: string;
  readonly iteration: number;
  readonly pool: readonly Variant[];
  readonly poolIds: ReadonlySet<string>;
  readonly newEntrantsThisIteration: readonly string[];

  // --- Ranking ---
  readonly ratings: ReadonlyMap<string, Rating>;
  readonly matchCounts: ReadonlyMap<string, number>;
  readonly matchHistory: readonly Match[];

  // --- Analysis ---
  readonly dimensionScores: Readonly<Record<string, Record<string, number>>> | null;
  readonly allCritiques: readonly Critique[];
  readonly diversityScore: number;
  readonly metaFeedback: Readonly<MetaFeedback> | null;

  // --- Arena ---
  readonly lastSyncedMatchIndex: number;

  getTopByRating(n: number): Variant[];
  getVariationById(id: string): Variant | undefined;
  getPoolSize(): number;
  hasVariant(id: string): boolean;
}

// ─── LLM client interface (Decision 10) ──────────────────────────

export interface LLMCompletionOptions {
  model?: AllowedLLMModelType;
  debug?: boolean;
  /** Invocation UUID injected by createScopedLLMClient — flows through to recordSpend and callLLM. */
  invocationId?: string;
  /** Task type hint for cost estimation — 'comparison' uses fixed low output estimate. */
  taskType?: 'comparison' | 'generation';
  /** Comparison output complexity: simple=10 tokens (A/B/TIE), structured=50 (dimension scores), flow=150 (full rubric). */
  comparisonSubtype?: 'simple' | 'structured' | 'flow';
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

// ─── Budget event logger type ────────────────────────────────────

export type BudgetEventLogger = (event: {
  eventType: 'reserve' | 'spend' | 'release_ok' | 'release_failed';
  agentName: string;
  amountUsd: number;
  totalSpentUsd: number;
  totalReservedUsd: number;
  availableBudgetUsd: number;
  invocationId?: string;
  iteration?: number;
}) => void;

// ─── Cost tracker interface (Decision 6) ─────────────────────────

export interface CostTracker {
  reserveBudget(agentName: string, estimatedCost: number): Promise<void>;
  recordSpend(agentName: string, actualCost: number, invocationId?: string): void;
  /** Release the most recent reservation for an agent without recording spend. Used on LLM call failure. */
  releaseReservation(agentName: string): void;
  getAgentCost(agentName: string): number;
  getTotalSpent(): number;
  getAvailableBudget(): number;
  /** Returns all agent costs as a record for persistence/reporting. */
  getAllAgentCosts(): Record<string, number>;
  /** Sum of outstanding (not yet reconciled) budget reservations. */
  getTotalReserved(): number;
  /** Returns the accumulated cost for a specific invocation UUID. */
  getInvocationCost(invocationId: string): number;
  /** Attach an optional event logger for audit trail. */
  setEventLogger(logger: BudgetEventLogger): void;
  /** True once totalSpent has exceeded budgetCapUsd (latched). */
  readonly isOverflowed: boolean;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly spent: number,
    public readonly reserved: number,
    public readonly cap: number,
  ) {
    super(`Budget exceeded for ${agentName}: spent $${spent.toFixed(4)} + $${reserved.toFixed(4)} reserved = $${(spent + reserved).toFixed(4)} committed, cap $${cap.toFixed(4)}`);
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

// ─── Diff metrics (computed per-agent for checkpoint pruning support) ─────

/** Per-agent diff metrics stored in execution_detail._diffMetrics.
 *  Canonical type shared by the pipeline writer and the Timeline reader. */
export interface DiffMetrics {
  variantsAdded: number;
  newVariantIds: string[];
  matchesPlayed: number;
  /** Elo-scale deltas (via toEloScale), keyed by variant ID. */
  eloChanges: Record<string, number>;
  critiquesAdded: number;
  debatesAdded?: number;
  diversityScoreAfter: number;
  metaFeedbackPopulated: boolean;
}

// ─── Checkpoint types ────────────────────────────────────────────

export interface Checkpoint {
  runId: string;
  iteration: number;
  phase: PipelinePhase;
  lastAgent: string;
  stateSnapshot: SerializedPipelineState;
}

export interface SerializedPipelineState {
  iteration: number;
  originalText: string;
  pool: Variant[];
  newEntrantsThisIteration: string[];
  ratings: Record<string, { mu: number; sigma: number }>;
  /** @deprecated Old Elo format — only present in legacy checkpoints. */
  eloRatings?: Record<string, number>;
  matchCounts: Record<string, number>;
  matchHistory: Match[];
  dimensionScores: Record<string, Record<string, number>> | null;
  allCritiques: Critique[] | null;
  /** @deprecated Only present in legacy checkpoints. */
  similarityMatrix?: Record<string, Record<string, number>> | null;
  diversityScore: number | null;
  metaFeedback: MetaFeedback | null;
  /** @deprecated Only present in legacy checkpoints. */
  debateTranscripts?: DebateTranscript[];
  treeSearchResults?: TreeSearchResult[] | null;
  treeSearchStates?: TreeState[] | null;
  sectionState?: SectionEvolutionState | null;
  /** Arena sync watermark: index into matchHistory up to which comparisons have been synced. */
  lastSyncedMatchIndex?: number;
  /** COST-6: CostTracker totalSpent at checkpoint time (default 0 for backward compat). */
  costTrackerTotalSpent?: number;
  /** ERR-3: ComparisonCache entries for resume (default empty for backward compat). */
  comparisonCacheEntries?: Array<[string, { winnerId: string | null; loserId: string | null; confidence: number; isDraw: boolean }]>;
}

export interface SerializedCheckpoint extends SerializedPipelineState {
  supervisorState?: { phaseIndex: number; agentIndex: number; iterationsCompleted: number };
  /** Agent names remaining when a mid-iteration continuation yield occurred. */
  resumeAgentNames?: string[];
}

// ─── Evolution run status ────────────────────────────────────────

export type EvolutionRunStatus = 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';

export type PipelineType = 'full' | 'single';

export const PIPELINE_TYPES = ['full', 'single'] as const satisfies readonly PipelineType[];

/** Metadata columns on evolution_prompts (prompt registry). */
export interface PromptMetadata {
  id: string;
  prompt: string;
  title: string;
  status: 'active' | 'archived';
  deleted_at: string | null;
  created_at: string;
}

export const BASELINE_STRATEGY = 'original_baseline' as const;

// ─── Elo attribution types (creator-based) ──────────────────────

/** Per-variant Elo attribution: how much did this variant improve over its parents? */
export interface EloAttribution {
  gain: number;      // deltaMu * ELO_SCALE
  ci: number;        // 1.96 * sigmaDelta * ELO_SCALE
  zScore: number;    // deltaMu / sigmaDelta
  deltaMu: number;
  sigmaDelta: number;
}

/** Aggregated attribution for a creating agent across all its variants. */
export interface AgentAttribution {
  agentName: string;
  variantCount: number;
  totalGain: number;
  avgGain: number;
  avgCi: number;     // root-sum-of-squares: sqrt(sum(ci²)) / N
  variants: Array<{ variantId: string; attribution: EloAttribution }>;
}

// ─── Evolution run summary (persisted as JSONB) ─────────────────
// Schemas moved to schemas.ts. Re-exported here for backward compatibility.

export { EvolutionRunSummaryV3Schema, EvolutionRunSummarySchema } from './schemas';

/** V3: mu-based run summary. New runs write this directly. */
export interface EvolutionRunSummary {
  version: 3;
  stopReason: string;
  finalPhase: PipelinePhase;
  totalIterations: number;
  durationSeconds: number;
  muHistory: number[][];
  diversityHistory: number[];
  matchStats: {
    totalMatches: number;
    avgConfidence: number;
    decisiveRate: number;
  };
  topVariants: Array<{
    id: string;
    strategy: string;
    mu: number;
    isBaseline: boolean;
  }>;
  baselineRank: number | null;
  baselineMu: number | null;
  strategyEffectiveness: Record<string, {
    count: number;
    avgMu: number;
  }>;
  metaFeedback: {
    successfulStrategies: string[];
    recurringWeaknesses: string[];
    patternsToAvoid: string[];
    priorityImprovements: string[];
  } | null;
  /** Aggregate action type counts across all agents in the run. */
  actionCounts?: Record<string, number>;
}
