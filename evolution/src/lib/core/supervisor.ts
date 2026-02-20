// Two-phase prescriptive supervisor for pool-based evolution.
// Drives EXPANSION → COMPETITION phase transitions with one-way lock and plateau detection.

import type { PipelineState, PipelinePhase, EvolutionRunConfig } from '../types';
import type { AgentName } from './pipeline';
import { REQUIRED_AGENTS } from './budgetRedistribution';
import { getOrdinal } from './rating';

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
  generationPayload: { strategies: string[] };
  calibrationPayload: { opponentsPerEntrant: number };
}

/** Serializable state for checkpoint resume. */
export interface SupervisorResumeState {
  phase: PipelinePhase;
  strategyRotationIndex: number;
  ordinalHistory: number[];
  diversityHistory: number[];
}

export interface SupervisorConfig {
  maxIterations: number;
  minBudget: number;
  plateauWindow: number;
  plateauThreshold: number;
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
    plateauWindow: cfg.plateau.window,
    plateauThreshold: cfg.plateau.threshold,
    expansionMinPool: cfg.expansion.minPool,
    expansionDiversityThreshold: cfg.expansion.diversityThreshold,
    expansionMaxIterations: cfg.expansion.maxIterations,
    singleArticle: cfg.singleArticle ?? false,
    enabledAgents: cfg.enabledAgents,
  };
}

/** Agents or sentinels that can appear in the active list. */
export type ExecutableAgent = AgentName | 'ranking';

/**
 * Canonical execution order. Uses 'ranking' sentinel instead of separate
 * calibration/tournament entries — the pipeline dispatch swaps the actual
 * agent by phase (calibration in EXPANSION, tournament in COMPETITION).
 */
const AGENT_EXECUTION_ORDER: ExecutableAgent[] = [
  'generation', 'outlineGeneration', 'reflection', 'flowCritique',
  'iterativeEditing', 'treeSearch', 'sectionDecomposition',
  'debate', 'evolution',
  'ranking',          // dispatches as calibration (EXPANSION) or tournament (COMPETITION)
  'proximity', 'metaReview',
];

const EXPANSION_ALLOWED: Set<ExecutableAgent> = new Set([
  'generation', 'ranking', 'proximity',
]);

const SINGLE_ARTICLE_EXCLUDED: Set<AgentName> = new Set([
  'generation', 'outlineGeneration', 'evolution',
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
    if (singleArticle && SINGLE_ARTICLE_EXCLUDED.has(name as AgentName)) return false;
    if (REQUIRED_AGENTS.includes(name as AgentName)) return true;
    return !enabledSet || enabledSet.has(name as AgentName);
  });
}

export class PoolSupervisor {
  private _phaseLocked: PipelinePhase | null = null;
  private _currentPhase: PipelinePhase = 'EXPANSION';
  private _strategyRotationIndex = 0;
  private _currentIteration: number | null = null;

  ordinalHistory: number[] = [];
  diversityHistory: number[] = [];

  constructor(private readonly cfg: SupervisorConfig) {
    this.validateConfig(cfg);
  }

  private validateConfig(cfg: SupervisorConfig): void {
    const {
      expansionMinPool, expansionMaxIterations, maxIterations,
      plateauWindow, expansionDiversityThreshold,
    } = cfg;

    if (expansionDiversityThreshold < 0 || expansionDiversityThreshold > 1) {
      throw new Error(`expansionDiversityThreshold must be in [0,1], got ${expansionDiversityThreshold}`);
    }

    if (expansionMaxIterations === 0) return;
    if (expansionMinPool < 5) {
      throw new Error(`expansionMinPool must be >= 5, got ${expansionMinPool}`);
    }
    if (maxIterations <= expansionMaxIterations) {
      throw new Error(`maxIterations (${maxIterations}) must be > expansionMaxIterations (${expansionMaxIterations})`);
    }
    if (maxIterations < expansionMaxIterations + plateauWindow + 1) {
      throw new Error(`maxIterations (${maxIterations}) must be >= ${expansionMaxIterations + plateauWindow + 1}`);
    }
  }

  get currentPhase(): PipelinePhase {
    return this._currentPhase;
  }

  detectPhase(state: PipelineState): PipelinePhase {
    if (state.iteration >= this.cfg.expansionMaxIterations) {
      return 'COMPETITION';
    }

    const poolReady = state.getPoolSize() >= this.cfg.expansionMinPool;
    const diversityReady = this.isDiversityReady(state.diversityScore);

    return (poolReady && diversityReady) ? 'COMPETITION' : 'EXPANSION';
  }

  private isDiversityReady(diversity: number | null): boolean {
    return diversity !== null && !Number.isNaN(diversity) && diversity >= this.cfg.expansionDiversityThreshold;
  }

  beginIteration(state: PipelineState): void {
    this.guardIterationIdempotency(state.iteration);
    this._currentIteration = state.iteration;

    const phase = this._phaseLocked ?? this.detectPhase(state);
    const isPhaseTransition = phase === 'COMPETITION' && this._currentPhase === 'EXPANSION';

    if (isPhaseTransition) {
      this.transitionToCompetition();
    }

    this._currentPhase = phase;

    if (this._currentPhase === 'COMPETITION') {
      this._strategyRotationIndex = (this._strategyRotationIndex + 1) % GENERATION_STRATEGIES.length;
    }
  }

  private guardIterationIdempotency(iteration: number): void {
    if (this._currentIteration === null) return;

    if (iteration === this._currentIteration) return;

    if (iteration < this._currentIteration) {
      throw new Error(`beginIteration called with stale iteration ${iteration} < ${this._currentIteration}`);
    }
  }

  private transitionToCompetition(): void {
    this._phaseLocked = 'COMPETITION';
    this.ordinalHistory = [];
    this.diversityHistory = [];
    this._strategyRotationIndex = -1;
  }

  getPhaseConfig(state: PipelineState): PhaseConfig {
    return this._currentPhase === 'EXPANSION'
      ? this.getExpansionConfig(state)
      : this.getCompetitionConfig();
  }

  private getExpansionConfig(state: PipelineState): PhaseConfig {
    const diversityIsLow = !this.isDiversityReady(state.diversityScore);
    const strategies = diversityIsLow
      ? [GENERATION_STRATEGIES[0], GENERATION_STRATEGIES[0], GENERATION_STRATEGIES[0]]
      : [...GENERATION_STRATEGIES];

    return {
      phase: 'EXPANSION',
      activeAgents: getActiveAgents('EXPANSION', this.cfg.enabledAgents, this.cfg.singleArticle),
      generationPayload: { strategies },
      calibrationPayload: { opponentsPerEntrant: 3 },
    };
  }

  private getCompetitionConfig(): PhaseConfig {
    const currentStrategy = GENERATION_STRATEGIES[this._strategyRotationIndex];
    return {
      phase: 'COMPETITION',
      activeAgents: getActiveAgents('COMPETITION', this.cfg.enabledAgents, this.cfg.singleArticle),
      generationPayload: { strategies: [currentStrategy] },
      calibrationPayload: { opponentsPerEntrant: 5 },
    };
  }

  shouldStop(state: PipelineState, availableBudget: number): [boolean, string] {
    // Quality threshold for single-article mode
    if (this.cfg.singleArticle && this.isQualityThresholdMet(state, 8)) {
      return [true, 'quality_threshold'];
    }

    if (this._currentPhase === 'COMPETITION') {
      this.trackCompetitionMetrics(state);
      if (this._isPlateaued()) {
        const isDegen = this.isDiversityValid(state.diversityScore) && state.diversityScore! < 0.01;
        return [true, isDegen ? 'Degenerate state detected' : 'Quality plateau detected'];
      }
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
  private isQualityThresholdMet(state: PipelineState, threshold: number): boolean {
    if (!state.allCritiques || state.allCritiques.length === 0) return false;
    const topVariant = state.getTopByRating(1)[0];
    if (!topVariant) return false;
    const critique = [...state.allCritiques].reverse().find(c => c.variationId === topVariant.id);
    if (!critique) return false;
    const scores = Object.values(critique.dimensionScores);
    if (scores.length === 0) return false;
    return scores.every(s => s >= threshold);
  }

  private trackCompetitionMetrics(state: PipelineState): void {
    if (state.ratings.size > 0) {
      const topOrdinal = Math.max(...[...state.ratings.values()].map(getOrdinal));
      this.ordinalHistory.push(topOrdinal);
    }

    if (this.isDiversityValid(state.diversityScore)) {
      this.diversityHistory.push(state.diversityScore!);
    }
  }

  private isDiversityValid(diversity: number | null): boolean {
    return diversity !== null && !Number.isNaN(diversity);
  }

  setPhaseFromResume(phase: PipelinePhase, rotationIndex: number): void {
    if (phase !== 'EXPANSION' && phase !== 'COMPETITION') {
      throw new Error(`Invalid phase for resume: '${phase}'`);
    }

    this._currentPhase = phase;

    if (phase === 'COMPETITION') {
      this._phaseLocked = 'COMPETITION';
    }

    const isValidRotationIndex = Number.isInteger(rotationIndex) && rotationIndex >= 0;
    this._strategyRotationIndex = isValidRotationIndex ? rotationIndex : 0;
  }

  /** Return serializable state for checkpoint persistence. */
  getResumeState(): SupervisorResumeState {
    return {
      phase: this._currentPhase,
      strategyRotationIndex: Math.max(0, this._strategyRotationIndex),
      ordinalHistory: [...this.ordinalHistory],
      diversityHistory: [...this.diversityHistory],
    };
  }

  resetIterationHistory(): void {
    this.ordinalHistory = [];
    this.diversityHistory = [];
  }

  private _isPlateaued(): boolean {
    if (this.ordinalHistory.length < this.cfg.plateauWindow) return false;
    const recent = this.ordinalHistory.slice(-this.cfg.plateauWindow);
    const improvement = recent[recent.length - 1] - recent[0];
    return improvement < this.cfg.plateauThreshold * 6;
  }
}
