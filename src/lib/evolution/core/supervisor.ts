// Two-phase prescriptive supervisor for pool-based evolution.
// Drives EXPANSION → COMPETITION phase transitions with one-way lock and plateau detection.

import type { PipelineState, PipelinePhase, EvolutionRunConfig } from '../types';
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
  runGeneration: boolean;
  runOutlineGeneration: boolean;
  runReflection: boolean;
  runIterativeEditing: boolean;
  runTreeSearch: boolean;
  runSectionDecomposition: boolean;
  runDebate: boolean;
  runEvolution: boolean;
  runCalibration: boolean;
  runProximity: boolean;
  runMetaReview: boolean;
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
}

export function supervisorConfigFromRunConfig(cfg: EvolutionRunConfig): SupervisorConfig {
  return {
    maxIterations: cfg.maxIterations,
    minBudget: 0.01,
    plateauWindow: cfg.plateau.window,
    plateauThreshold: cfg.plateau.threshold,
    expansionMinPool: cfg.expansion.minPool,
    expansionDiversityThreshold: cfg.expansion.diversityThreshold,
    expansionMaxIterations: cfg.expansion.maxIterations,
  };
}

export class PoolSupervisor {
  private _phaseLocked: PipelinePhase | null = null;
  private _currentPhase: PipelinePhase = 'EXPANSION';
  private _strategyRotationIndex = 0;
  private _currentIteration: number | null = null;

  ordinalHistory: number[] = [];
  diversityHistory: number[] = [];

  constructor(private readonly cfg: SupervisorConfig) {
    const { expansionMinPool, expansionMaxIterations, maxIterations, plateauWindow, expansionDiversityThreshold } = cfg;

    if (expansionDiversityThreshold < 0 || expansionDiversityThreshold > 1) {
      throw new Error(`expansionDiversityThreshold must be in [0,1], got ${expansionDiversityThreshold}`);
    }
    if (expansionMinPool < 5) {
      throw new Error(`expansionMinPool must be >= 5, got ${expansionMinPool}`);
    }
    if (maxIterations <= expansionMaxIterations) {
      throw new Error(`maxIterations (${maxIterations}) must be > expansionMaxIterations (${expansionMaxIterations})`);
    }
    const minViable = expansionMaxIterations + plateauWindow + 1;
    if (maxIterations < minViable) {
      throw new Error(`maxIterations (${maxIterations}) must be >= ${minViable}`);
    }
  }

  get currentPhase(): PipelinePhase {
    return this._currentPhase;
  }

  /** Detect phase from pool state (does not mutate). */
  detectPhase(state: PipelineState): PipelinePhase {
    // Safety cap: unconditionally transition at expansionMaxIterations
    if (state.iteration >= this.cfg.expansionMaxIterations) {
      return 'COMPETITION';
    }

    const poolGate = state.getPoolSize() >= this.cfg.expansionMinPool;
    const diversity = state.diversityScore;
    const diversityGate =
      diversity !== null &&
      !Number.isNaN(diversity) &&
      diversity >= this.cfg.expansionDiversityThreshold;

    if (poolGate && diversityGate) {
      return 'COMPETITION';
    }
    return 'EXPANSION';
  }

  /** Called once per iteration at the top of the loop. Manages phase transitions. */
  beginIteration(state: PipelineState): void {
    // Idempotency guard
    if (this._currentIteration !== null) {
      if (state.iteration === this._currentIteration) return;
      if (state.iteration < this._currentIteration) {
        throw new Error(`beginIteration called with stale iteration ${state.iteration} < ${this._currentIteration}`);
      }
    }
    this._currentIteration = state.iteration;

    const phase = this._phaseLocked ?? this.detectPhase(state);
    const previousPhase = this._currentPhase;

    // Handle EXPANSION → COMPETITION transition
    if (phase === 'COMPETITION' && previousPhase === 'EXPANSION') {
      this._phaseLocked = 'COMPETITION';
      this.ordinalHistory = [];
      this.diversityHistory = [];
      this._strategyRotationIndex = -1;
    }

    this._currentPhase = phase;

    // Advance rotation in COMPETITION
    if (this._currentPhase === 'COMPETITION') {
      this._strategyRotationIndex = (this._strategyRotationIndex + 1) % GENERATION_STRATEGIES.length;
    }
  }

  /** Return phase configuration (pure read, idempotent). */
  getPhaseConfig(state: PipelineState): PhaseConfig {
    const phase = this._currentPhase;
    const diversity = state.diversityScore;

    if (phase === 'EXPANSION') {
      const diversityIsLow =
        diversity === null ||
        Number.isNaN(diversity) ||
        diversity < this.cfg.expansionDiversityThreshold;

      const strategies = diversityIsLow
        ? [GENERATION_STRATEGIES[0], GENERATION_STRATEGIES[0], GENERATION_STRATEGIES[0]]
        : [...GENERATION_STRATEGIES]
      ;

      return {
        phase: 'EXPANSION',
        runGeneration: true,
        runOutlineGeneration: false,
        runReflection: false,
        runIterativeEditing: false,
        runTreeSearch: false,
        runSectionDecomposition: false,
        runDebate: false,
        runEvolution: false,
        runCalibration: true,
        runProximity: true,
        runMetaReview: false,
        generationPayload: { strategies },
        calibrationPayload: { opponentsPerEntrant: 3 },
      };
    }

    // COMPETITION
    // TODO: generationPayload.strategies is currently ignored by GenerationAgent,
    // which always uses all 3 strategies. Wire this into GenerationAgent or remove
    // the rotation logic to avoid dead code path.
    const currentStrategy = GENERATION_STRATEGIES[this._strategyRotationIndex];
    return {
      phase: 'COMPETITION',
      runGeneration: true,
      runOutlineGeneration: true,
      runReflection: true,
      runIterativeEditing: true,
      runTreeSearch: true,
      runSectionDecomposition: true,
      runDebate: true,
      runEvolution: true,
      runCalibration: true,
      runProximity: true,
      runMetaReview: true,
      generationPayload: { strategies: [currentStrategy] },
      calibrationPayload: { opponentsPerEntrant: 5 },
    };
  }

  /** Determine if evolution should stop. Returns [shouldStop, reason]. */
  shouldStop(state: PipelineState, availableBudget: number): [boolean, string] {
    // Track history only in COMPETITION
    if (this._currentPhase === 'COMPETITION') {
      if (state.ratings.size > 0) {
        const topOrdinal = Math.max(...[...state.ratings.values()].map(getOrdinal));
        this.ordinalHistory.push(topOrdinal);
      }
      if (state.diversityScore !== null && !Number.isNaN(state.diversityScore)) {
        this.diversityHistory.push(state.diversityScore);
      }
    }

    // 1. Quality plateau (COMPETITION only)
    if (this._currentPhase === 'COMPETITION' && this._isPlateaued()) {
      if (
        state.diversityScore !== null &&
        !Number.isNaN(state.diversityScore) &&
        state.diversityScore < 0.01
      ) {
        return [true, 'Degenerate state detected'];
      }
      return [true, 'Quality plateau detected'];
    }

    // 2. Budget exhausted
    if (availableBudget < this.cfg.minBudget) {
      return [true, 'Budget exhausted'];
    }

    // 3. Max iterations
    if (state.iteration >= this.cfg.maxIterations) {
      return [true, 'Max iterations reached'];
    }

    return [false, ''];
  }

  /** Restore phase state from checkpoint resume. */
  setPhaseFromResume(phase: PipelinePhase, rotationIndex: number): void {
    if (phase !== 'EXPANSION' && phase !== 'COMPETITION') {
      throw new Error(`Invalid phase for resume: '${phase}'`);
    }
    this._currentPhase = phase;
    if (phase === 'COMPETITION') {
      this._phaseLocked = 'COMPETITION';
    }
    this._strategyRotationIndex = Number.isInteger(rotationIndex) && rotationIndex >= 0
      ? rotationIndex
      : 0;
  }

  /** Return serializable state for checkpoint persistence. */
  getResumeState(): SupervisorResumeState {
    return {
      phase: this._currentPhase ?? 'EXPANSION',
      strategyRotationIndex: Math.max(0, this._strategyRotationIndex),
      ordinalHistory: [...this.ordinalHistory],
      diversityHistory: [...this.diversityHistory],
    };
  }

  /** Reset tracking history (does NOT clear phase lock). */
  resetIterationHistory(): void {
    this.ordinalHistory = [];
    this.diversityHistory = [];
  }

  private _isPlateaued(): boolean {
    if (this.ordinalHistory.length < this.cfg.plateauWindow) return false;
    const recent = this.ordinalHistory.slice(-this.cfg.plateauWindow);
    const improvement = recent[recent.length - 1] - recent[0];
    // Ordinal scale: 1 ordinal ≈ 16 Elo, so 100 Elo ≈ 6 ordinal
    return improvement < this.cfg.plateauThreshold * 6;
  }
}
