// Unit tests for PoolSupervisor phase transitions, plateau detection, and resume.

import { PoolSupervisor, supervisorConfigFromRunConfig, GENERATION_STRATEGIES } from './supervisor';
import { PipelineStateImpl } from './state';
import type { EvolutionRunConfig } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';

function makeConfig(overrides: Partial<ReturnType<typeof supervisorConfigFromRunConfig>> = {}) {
  const base = supervisorConfigFromRunConfig(DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig);
  return { ...base, ...overrides };
}

function makeState(poolSize: number = 0, iteration: number = 0): PipelineStateImpl {
  const state = new PipelineStateImpl('Original text for testing.');
  state.iteration = iteration;
  // Add pool entries
  for (let i = 0; i < poolSize; i++) {
    state.addToPool({
      id: `v-${i}`,
      text: `Variant ${i} text.`,
      version: 1,
      parentIds: [],
      strategy: 'structural_transform',
      createdAt: Date.now(),
      iterationBorn: 0,
    });
  }
  return state;
}

describe('PoolSupervisor', () => {
  it('starts in EXPANSION phase', () => {
    const supervisor = new PoolSupervisor(makeConfig());
    expect(supervisor.currentPhase).toBe('EXPANSION');
  });

  it('stays in EXPANSION with small pool', () => {
    const supervisor = new PoolSupervisor(makeConfig());
    const state = makeState(3, 0);
    expect(supervisor.detectPhase(state)).toBe('EXPANSION');
  });

  it('transitions to COMPETITION at safety cap (expansionMaxIterations)', () => {
    const cfg = makeConfig({ expansionMaxIterations: 3 });
    const supervisor = new PoolSupervisor(cfg);
    const state = makeState(2, 3); // iteration >= expansionMaxIterations
    expect(supervisor.detectPhase(state)).toBe('COMPETITION');
  });

  it('transitions to COMPETITION when pool + diversity gates met', () => {
    const cfg = makeConfig({ expansionMinPool: 5, expansionDiversityThreshold: 0.2 });
    const supervisor = new PoolSupervisor(cfg);
    const state = makeState(6, 1);
    state.diversityScore = 0.3;
    expect(supervisor.detectPhase(state)).toBe('COMPETITION');
  });

  it('stays EXPANSION if pool met but diversity not met', () => {
    const cfg = makeConfig({ expansionMinPool: 5, expansionDiversityThreshold: 0.5 });
    const supervisor = new PoolSupervisor(cfg);
    const state = makeState(6, 1);
    state.diversityScore = 0.2;
    expect(supervisor.detectPhase(state)).toBe('EXPANSION');
  });

  it('phase lock prevents going back to EXPANSION', () => {
    const cfg = makeConfig({ expansionMaxIterations: 2 });
    const supervisor = new PoolSupervisor(cfg);
    const state = makeState(20, 2);
    supervisor.beginIteration(state);
    expect(supervisor.currentPhase).toBe('COMPETITION');

    // Now go to iteration 3 with small pool — should stay COMPETITION
    state.iteration = 3;
    supervisor.beginIteration(state);
    expect(supervisor.currentPhase).toBe('COMPETITION');
  });

  it('beginIteration is idempotent for same iteration', () => {
    const supervisor = new PoolSupervisor(makeConfig());
    const state = makeState(0, 0);
    supervisor.beginIteration(state);
    supervisor.beginIteration(state); // no-op, should not throw
    expect(supervisor.currentPhase).toBe('EXPANSION');
  });

  it('beginIteration throws on stale iteration', () => {
    const supervisor = new PoolSupervisor(makeConfig());
    const state = makeState(0, 5);
    supervisor.beginIteration(state);
    state.iteration = 3; // going backward
    expect(() => supervisor.beginIteration(state)).toThrow('stale');
  });

  it('clears history on phase transition', () => {
    const cfg = makeConfig({ expansionMaxIterations: 1 });
    const supervisor = new PoolSupervisor(cfg);
    supervisor.eloHistory = [1200, 1250];
    supervisor.diversityHistory = [0.5];

    const state = makeState(20, 1);
    supervisor.beginIteration(state);
    expect(supervisor.currentPhase).toBe('COMPETITION');
    expect(supervisor.eloHistory).toEqual([]);
    expect(supervisor.diversityHistory).toEqual([]);
  });

  it('rotates strategy in COMPETITION', () => {
    const cfg = makeConfig({ expansionMaxIterations: 1 });
    const supervisor = new PoolSupervisor(cfg);
    const state = makeState(20, 1);

    supervisor.beginIteration(state);
    const config1 = supervisor.getPhaseConfig(state);
    expect(config1.generationPayload.strategies).toHaveLength(1);
    expect(config1.generationPayload.strategies[0]).toBe(GENERATION_STRATEGIES[0]);

    state.iteration = 2;
    supervisor.beginIteration(state);
    const config2 = supervisor.getPhaseConfig(state);
    expect(config2.generationPayload.strategies[0]).toBe(GENERATION_STRATEGIES[1]);

    state.iteration = 3;
    supervisor.beginIteration(state);
    const config3 = supervisor.getPhaseConfig(state);
    expect(config3.generationPayload.strategies[0]).toBe(GENERATION_STRATEGIES[2]);

    // Should wrap around
    state.iteration = 4;
    supervisor.beginIteration(state);
    const config4 = supervisor.getPhaseConfig(state);
    expect(config4.generationPayload.strategies[0]).toBe(GENERATION_STRATEGIES[0]);
  });

  describe('getPhaseConfig', () => {
    it('EXPANSION: all 3 strategies when diversity ok', () => {
      const supervisor = new PoolSupervisor(makeConfig());
      const state = makeState(3, 0);
      state.diversityScore = 0.5;
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);
      expect(config.phase).toBe('EXPANSION');
      expect(config.generationPayload.strategies).toHaveLength(3);
      expect(config.runEvolution).toBe(false);
      expect(config.runReflection).toBe(false);
      expect(config.calibrationPayload.opponentsPerEntrant).toBe(3);
    });

    it('EXPANSION: repeats structural_transform x3 when diversity low', () => {
      const supervisor = new PoolSupervisor(makeConfig());
      const state = makeState(3, 0);
      state.diversityScore = null;
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);
      expect(config.generationPayload.strategies).toEqual([
        'structural_transform', 'structural_transform', 'structural_transform',
      ]);
    });

    it('COMPETITION: enables all agents, 5 opponents', () => {
      const cfg = makeConfig({ expansionMaxIterations: 1 });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);
      expect(config.phase).toBe('COMPETITION');
      expect(config.runEvolution).toBe(true);
      expect(config.runReflection).toBe(true);
      expect(config.runMetaReview).toBe(true);
      expect(config.calibrationPayload.opponentsPerEntrant).toBe(5);
    });
  });

  describe('shouldStop', () => {
    it('stops on budget exhaustion', () => {
      const supervisor = new PoolSupervisor(makeConfig());
      const state = makeState(3, 0);
      supervisor.beginIteration(state);
      const [stop, reason] = supervisor.shouldStop(state, 0.005);
      expect(stop).toBe(true);
      expect(reason).toContain('Budget');
    });

    it('stops on max iterations', () => {
      const cfg = makeConfig({ maxIterations: 15, expansionMaxIterations: 5, plateauWindow: 3 });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(3, 15);
      supervisor.beginIteration(state);
      const [stop, reason] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(true);
      expect(reason).toContain('Max iterations');
    });

    it('detects quality plateau in COMPETITION', () => {
      const cfg = makeConfig({ expansionMaxIterations: 1, plateauWindow: 3, plateauThreshold: 0.02 });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      state.eloRatings.set('v-0', 1300);

      supervisor.beginIteration(state);

      // Simulate 3 iterations with no improvement
      supervisor.shouldStop(state, 10); // records 1300
      state.iteration = 2;
      supervisor.beginIteration(state);
      supervisor.shouldStop(state, 10); // records 1300
      state.iteration = 3;
      supervisor.beginIteration(state);
      const [stop, reason] = supervisor.shouldStop(state, 10); // 3rd data point
      expect(stop).toBe(true);
      expect(reason).toContain('plateau');
    });

    it('does not plateau in EXPANSION', () => {
      const supervisor = new PoolSupervisor(makeConfig());
      const state = makeState(3, 0);
      state.eloRatings.set('v-0', 1300);
      supervisor.beginIteration(state);
      supervisor.shouldStop(state, 10);
      state.iteration = 1;
      supervisor.beginIteration(state);
      supervisor.shouldStop(state, 10);
      state.iteration = 2;
      supervisor.beginIteration(state);
      const [stop] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(false); // No plateau in EXPANSION
    });
  });

  describe('resume', () => {
    it('restores COMPETITION phase and locks it', () => {
      const supervisor = new PoolSupervisor(makeConfig());
      supervisor.setPhaseFromResume('COMPETITION', 2);
      expect(supervisor.currentPhase).toBe('COMPETITION');

      // Should stay locked even if detect would say EXPANSION
      const state = makeState(2, 10);
      supervisor.beginIteration(state);
      expect(supervisor.currentPhase).toBe('COMPETITION');
    });

    it('round-trips through getResumeState + setPhaseFromResume', () => {
      const cfg = makeConfig({ expansionMaxIterations: 1 });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      supervisor.beginIteration(state);
      supervisor.eloHistory = [1200, 1250, 1260];
      supervisor.diversityHistory = [0.3, 0.4];

      const resumeState = supervisor.getResumeState();
      expect(resumeState.phase).toBe('COMPETITION');

      const supervisor2 = new PoolSupervisor(cfg);
      supervisor2.setPhaseFromResume(resumeState.phase, resumeState.strategyRotationIndex);
      supervisor2.eloHistory = resumeState.eloHistory;
      supervisor2.diversityHistory = resumeState.diversityHistory;

      expect(supervisor2.currentPhase).toBe('COMPETITION');
      expect(supervisor2.eloHistory).toEqual([1200, 1250, 1260]);
    });

    it('rejects invalid phase', () => {
      const supervisor = new PoolSupervisor(makeConfig());
      expect(() => supervisor.setPhaseFromResume('INVALID' as 'EXPANSION', 0)).toThrow('Invalid phase');
    });
  });

  describe('constructor validation', () => {
    it('rejects bad diversity threshold', () => {
      expect(() => new PoolSupervisor(makeConfig({ expansionDiversityThreshold: 1.5 }))).toThrow();
    });
    it('rejects small min pool', () => {
      expect(() => new PoolSupervisor(makeConfig({ expansionMinPool: 3 }))).toThrow();
    });
    it('rejects maxIterations <= expansionMaxIterations', () => {
      expect(() => new PoolSupervisor(makeConfig({ maxIterations: 5, expansionMaxIterations: 5 }))).toThrow();
    });
  });
});
