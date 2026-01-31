// Shared interfaces for the evolution pipeline subsystem.
// All cross-module types live here to enforce a clean import DAG and prevent circular deps.

import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import { z } from 'zod';

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
}

export interface Critique {
  variationId: string;
  dimensionScores: Record<string, number>;
  goodExamples: Record<string, string[]>;
  badExamples: Record<string, string[]>;
  notes: Record<string, string>;
  reviewer: string;
}

export interface MetaFeedback {
  recurringWeaknesses: string[];
  priorityImprovements: string[];
  successfulStrategies: string[];
  patternsToAvoid: string[];
}

export interface Match {
  variationA: string;
  variationB: string;
  winner: string;
  confidence: number;
  turns: number;
  dimensionScores: Record<string, string>;
}

// ─── Agent types ─────────────────────────────────────────────────

export interface AgentPayload {
  originalText: string;
  title: string;
  explanationId: number;
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
}

// ─── Execution context (Decision 4) ─────────────────────────────

export interface ExecutionContext {
  payload: AgentPayload;
  state: PipelineState;
  llmClient: EvolutionLLMClient;
  logger: EvolutionLogger;
  costTracker: CostTracker;
  runId: string;
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
  eloRatings: Map<string, number>;
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

  // Pool management methods
  addToPool(variation: TextVariation): void;
  startNewIteration(): void;
  getTopByElo(n: number): TextVariation[];
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
}

// ─── Cost tracker interface (Decision 6) ─────────────────────────

export interface CostTracker {
  reserveBudget(agentName: string, estimatedCost: number): Promise<void>;
  recordSpend(agentName: string, actualCost: number): void;
  getAgentCost(agentName: string): number;
  getTotalSpent(): number;
  getAvailableBudget(): number;
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

// ─── Evolution run config (per-run overrides) ────────────────────

export interface EvolutionRunConfig {
  maxIterations: number;
  budgetCapUsd: number;
  plateau: { window: number; threshold: number };
  expansion: {
    minPool: number;
    minIterations: number;
    diversityThreshold: number;
    maxIterations: number;
  };
  generation: { strategies: number };
  calibration: { opponents: number };
  budgetCaps: Record<string, number>;
  useEmbeddings: boolean;
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
  eloRatings: Record<string, number>;
  matchCounts: Record<string, number>;
  matchHistory: Match[];
  dimensionScores: Record<string, Record<string, number>> | null;
  allCritiques: Critique[] | null;
  similarityMatrix: Record<string, Record<string, number>> | null;
  diversityScore: number | null;
  metaFeedback: MetaFeedback | null;
}

// ─── Evolution run status ────────────────────────────────────────

export type EvolutionRunStatus = 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'paused';
