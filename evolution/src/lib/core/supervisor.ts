// Two-phase prescriptive supervisor for pool-based evolution.
// Drives EXPANSION → COMPETITION phase transitions with one-way lock.

import type { PipelineState, PipelinePhase, EvolutionRunConfig, AgentName } from '../types';
import { getActiveAgents as _getActiveAgents, type ExecutableAgent } from './agentConfiguration';

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
  ordinalHistory: number[];
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

export type { ExecutableAgent } from './agentConfiguration';
export const getActiveAgents = _getActiveAgents;

export class PoolSupervisor {
  private _phase: PipelinePhase = 'EXPANSION';
  private _locked = false;
  private _currentIteration: number | null = null;

  ordinalHistory: number[] = [];
  diversityHistory: number[] = [];

  constructor(private readonly cfg: SupervisorConfig) {}

  get currentPhase(): PipelinePhase {
    return this._phase;
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

    const phase = this._locked ? this._phase : this.detectPhase(state);

    if (phase === 'COMPETITION' && this._phase === 'EXPANSION') {
      this._locked = true;
      this.ordinalHistory = [];
      this.diversityHistory = [];
    }

    this._phase = phase;
  }

  private guardIterationIdempotency(iteration: number): void {
    if (this._currentIteration === null || iteration >= this._currentIteration) return;
    throw new Error(`beginIteration called with stale iteration ${iteration} < ${this._currentIteration}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getPhaseConfig(state: PipelineState): PhaseConfig {
    return {
      phase: this._phase,
      activeAgents: getActiveAgents(this._phase, this.cfg.enabledAgents, this.cfg.singleArticle),
    };
  }

  shouldStop(state: PipelineState, availableBudget: number): [boolean, string] {
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

  setPhaseFromResume(phase: PipelinePhase): void {
    if (phase !== 'EXPANSION' && phase !== 'COMPETITION') {
      throw new Error(`Invalid phase for resume: '${phase}'`);
    }

    this._phase = phase;

    if (phase === 'COMPETITION') {
      this._locked = true;
    }
  }

  /** Return serializable state for checkpoint persistence. */
  getResumeState(): SupervisorResumeState {
    return {
      phase: this._phase,
      ordinalHistory: [...this.ordinalHistory],
      diversityHistory: [...this.diversityHistory],
    };
  }

  resetIterationHistory(): void {
    this.ordinalHistory = [];
    this.diversityHistory = [];
  }
}
