// Two-phase prescriptive supervisor for pool-based evolution.
// Drives EXPANSION → COMPETITION phase transitions with one-way lock.

import type { ReadonlyPipelineState, PipelinePhase, EvolutionRunConfig, AgentName } from '../types';
import { REQUIRED_AGENTS, SINGLE_ARTICLE_DISABLED } from './budgetRedistribution';

// Generation strategies used in both phases
export const GENERATION_STRATEGIES = [
  'structural_transform',
  'lexical_simplify',
  'grounding_enhance',
] as const;

export type GenerationStrategy = (typeof GENERATION_STRATEGIES)[number];

/** Phase configuration returned by getPhaseConfig(). */
export interface PhaseConfig {
  phase: PipelinePhase;
  /** Ordered list of agents to run this iteration. */
  activeAgents: ExecutableAgent[];
}

/** Serializable state for checkpoint resume. */
export interface SupervisorResumeState {
  phase: PipelinePhase;
  muHistory: number[];
  diversityHistory: number[];
}

export interface SupervisorConfig {
  maxIterations: number;
  minBudget: number;
  expansionMinPool: number;
  expansionDiversityThreshold: number;
  expansionMaxIterations: number;
  singleArticle: boolean;
  /** Optional agents to enable. Undefined = all agents (backward compat). */
  enabledAgents?: AgentName[];
}

export function supervisorConfigFromRunConfig(
  cfg: EvolutionRunConfig,
): SupervisorConfig {
  return {
    maxIterations: cfg.maxIterations,
    minBudget: 0.01,
    expansionMinPool: cfg.expansion.minPool,
    expansionDiversityThreshold: cfg.expansion.diversityThreshold,
    expansionMaxIterations: cfg.expansion.maxIterations,
    singleArticle: cfg.singleArticle ?? false,
    enabledAgents: cfg.enabledAgents,
  };
}

/** Agents that can appear in the active list. */
export type ExecutableAgent = AgentName;

/**
 * Canonical execution order. The unified 'ranking' agent handles both
 * triage (calibration) and fine-ranking (Swiss tournament) internally.
 */
const AGENT_EXECUTION_ORDER: ExecutableAgent[] = [
  'generation', 'outlineGeneration', 'reflection', 'flowCritique',
  'iterativeEditing', 'treeSearch', 'sectionDecomposition',
  'debate', 'evolution',
  'ranking',          // unified ranking agent handles both triage and fine-ranking
  'proximity', 'metaReview',
];

const EXPANSION_ALLOWED: Set<ExecutableAgent> = new Set([
  'generation', 'ranking', 'proximity',
]);

/**
 * Compute the ordered list of agents to execute for a given phase, strategy, and mode.
 * Replaces the 12-boolean PhaseConfig + feature flags + enabledAgents layers with a single function.
 */
export function getActiveAgents(
  phase: PipelinePhase,
  enabledAgents: AgentName[] | undefined,
  singleArticle: boolean,
): ExecutableAgent[] {
  const enabledSet = enabledAgents ? new Set(enabledAgents) : null;
  return AGENT_EXECUTION_ORDER.filter(name => {
    if (name === 'ranking') return true;  // always included — pipeline swaps by phase
    if (phase === 'EXPANSION' && !EXPANSION_ALLOWED.has(name)) return false;
    if (singleArticle && SINGLE_ARTICLE_DISABLED.includes(name as AgentName)) return false;
    if (REQUIRED_AGENTS.includes(name as AgentName)) return true;
    return !enabledSet || enabledSet.has(name as AgentName);
  });
}

export class PoolSupervisor {
  private _phaseLocked: PipelinePhase | null = null;
  private _currentPhase: PipelinePhase = 'EXPANSION';
  private _currentIteration: number | null = null;

  muHistory: number[] = [];
  diversityHistory: number[] = [];

  constructor(private readonly cfg: SupervisorConfig) {}

  get currentPhase(): PipelinePhase {
    return this._currentPhase;
  }

  detectPhase(state: ReadonlyPipelineState): PipelinePhase {
    if (state.iteration >= this.cfg.expansionMaxIterations) {
      return 'COMPETITION';
    }

    const poolReady = state.getPoolSize() >= this.cfg.expansionMinPool;
    const diversityReady = this.isDiversityReady(state.diversityScore);

    return (poolReady && diversityReady) ? 'COMPETITION' : 'EXPANSION';
  }

  private isDiversityReady(diversity: number): boolean {
    return diversity > 0 && !Number.isNaN(diversity) && diversity >= this.cfg.expansionDiversityThreshold;
  }

  beginIteration(state: ReadonlyPipelineState): void {
    this.guardIterationIdempotency(state.iteration);
    this._currentIteration = state.iteration;

    const phase = this._phaseLocked ?? this.detectPhase(state);
    const isPhaseTransition = phase === 'COMPETITION' && this._currentPhase === 'EXPANSION';

    if (isPhaseTransition) {
      this.transitionToCompetition();
    }

    this._currentPhase = phase;
  }

  private guardIterationIdempotency(iteration: number): void {
    if (this._currentIteration === null || iteration >= this._currentIteration) return;
    throw new Error(`beginIteration called with stale iteration ${iteration} < ${this._currentIteration}`);
  }

  private transitionToCompetition(): void {
    this._phaseLocked = 'COMPETITION';
    this.muHistory = [];
    this.diversityHistory = [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getPhaseConfig(state: ReadonlyPipelineState): PhaseConfig {
    return {
      phase: this._currentPhase,
      activeAgents: getActiveAgents(this._currentPhase, this.cfg.enabledAgents, this.cfg.singleArticle),
    };
  }

  shouldStop(state: ReadonlyPipelineState, availableBudget: number): [boolean, string] {
    // Quality threshold for single-article mode
    if (this.cfg.singleArticle && this.isQualityThresholdMet(state, 8)) {
      return [true, 'quality_threshold'];
    }

    if (availableBudget < this.cfg.minBudget) {
      return [true, 'Budget exhausted'];
    }

    if (state.iteration > this.cfg.maxIterations) {
      return [true, 'Max iterations reached'];
    }

    return [false, ''];
  }

  /** Check if the top variant's latest critique has all dimension scores >= threshold. */
  private isQualityThresholdMet(state: ReadonlyPipelineState, threshold: number): boolean {
    if (state.allCritiques.length === 0) return false;
    const topVariant = state.getTopByRating(1)[0];
    if (!topVariant) return false;
    const critique = [...state.allCritiques].reverse().find(c => c.variationId === topVariant.id);
    if (!critique) return false;
    const scores = Object.values(critique.dimensionScores);
    if (scores.length === 0) return false;
    return scores.every(s => s >= threshold);
  }

  setPhaseFromResume(phase: PipelinePhase): void {
    if (phase !== 'EXPANSION' && phase !== 'COMPETITION') {
      throw new Error(`Invalid phase for resume: '${phase}'`);
    }

    this._currentPhase = phase;

    if (phase === 'COMPETITION') {
      this._phaseLocked = 'COMPETITION';
    }
  }

  /** Return serializable state for checkpoint persistence. */
  getResumeState(): SupervisorResumeState {
    return {
      phase: this._currentPhase,
      muHistory: [...this.muHistory],
      diversityHistory: [...this.diversityHistory],
    };
  }

  resetIterationHistory(): void {
    this.muHistory = [];
    this.diversityHistory = [];
  }
}
