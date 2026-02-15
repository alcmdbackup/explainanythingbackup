// Unit tests for PoolSupervisor phase transitions, plateau detection, and resume.

import { PoolSupervisor, supervisorConfigFromRunConfig, GENERATION_STRATEGIES } from './supervisor';
import { PipelineStateImpl } from './state';
import type { EvolutionRunConfig } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';
import type { Rating } from './rating';

/** Helper: create a rating with known ordinal (mu - 3*sigma). sigma defaults to 3. */
function ratingWithOrdinal(ordinal: number, sigma = 3): Rating {
  return { mu: ordinal + 3 * sigma, sigma };
}

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
    supervisor.ordinalHistory = [20, 21];
    supervisor.diversityHistory = [0.5];

    const state = makeState(20, 1);
    supervisor.beginIteration(state);
    expect(supervisor.currentPhase).toBe('COMPETITION');
    expect(supervisor.ordinalHistory).toEqual([]);
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
      expect(config.runIterativeEditing).toBe(false);
      expect(config.runTreeSearch).toBe(false);
      expect(config.runSectionDecomposition).toBe(false);
      expect(config.runDebate).toBe(false);
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
      expect(config.runIterativeEditing).toBe(true);
      expect(config.runTreeSearch).toBe(true);
      expect(config.runSectionDecomposition).toBe(true);
      expect(config.runDebate).toBe(true);
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

    it('does not stop at maxIterations (agents should still run)', () => {
      const cfg = makeConfig({ maxIterations: 15, expansionMaxIterations: 5, plateauWindow: 3 });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(3, 15);
      supervisor.beginIteration(state);
      const [stop] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(false);
    });

    it('stops when iteration exceeds maxIterations', () => {
      const cfg = makeConfig({ maxIterations: 15, expansionMaxIterations: 5, plateauWindow: 3 });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(3, 16);
      supervisor.beginIteration(state);
      const [stop, reason] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(true);
      expect(reason).toContain('Max iterations');
    });

    it('maxIterations=1 with iteration=1 does not stop (single iteration runs)', () => {
      const cfg = makeConfig({
        maxIterations: 1, expansionMaxIterations: 0, expansionMinPool: 1,
        plateauWindow: 3, singleArticle: true,
      });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(0, 1);
      supervisor.beginIteration(state);
      const [stop] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(false);
    });

    it('maxIterations=1 with iteration=2 stops', () => {
      const cfg = makeConfig({
        maxIterations: 1, expansionMaxIterations: 0, expansionMinPool: 1,
        plateauWindow: 3, singleArticle: true,
      });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(0, 2);
      supervisor.beginIteration(state);
      const [stop, reason] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(true);
      expect(reason).toContain('Max iterations');
    });

    it('maxIterations=3 with iteration=3 does not stop', () => {
      const cfg = makeConfig({ maxIterations: 15, expansionMaxIterations: 5, plateauWindow: 3 });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(3, 3);
      // Need iteration > expansionMaxIterations for COMPETITION detection to not interfere
      // but with iteration=3 < expansionMaxIterations=5, we're in EXPANSION — shouldStop still checks maxIterations
      supervisor.beginIteration(state);
      const [stop] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(false);
    });

    it('detects quality plateau in COMPETITION', () => {
      const cfg = makeConfig({ expansionMaxIterations: 1, plateauWindow: 3, plateauThreshold: 0.02 });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      state.ratings.set('v-0', ratingWithOrdinal(21));

      supervisor.beginIteration(state);

      // Simulate 3 iterations with no improvement (ordinal stays at 21)
      supervisor.shouldStop(state, 10); // records 21
      state.iteration = 2;
      supervisor.beginIteration(state);
      supervisor.shouldStop(state, 10); // records 21
      state.iteration = 3;
      supervisor.beginIteration(state);
      const [stop, reason] = supervisor.shouldStop(state, 10); // 3rd data point
      expect(stop).toBe(true);
      expect(reason).toContain('plateau');
    });

    it('fires degenerate stop when plateau AND diversity < 0.01', () => {
      const cfg = makeConfig({ expansionMaxIterations: 1, plateauWindow: 3, plateauThreshold: 0.02 });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      state.ratings.set('v-0', ratingWithOrdinal(21));
      state.diversityScore = 0.005; // < 0.01 → degenerate

      supervisor.beginIteration(state);

      // Accumulate 3 plateau data points (ordinal stays at 21, no improvement)
      supervisor.shouldStop(state, 10); // records 21
      state.iteration = 2;
      supervisor.beginIteration(state);
      supervisor.shouldStop(state, 10); // records 21
      state.iteration = 3;
      supervisor.beginIteration(state);
      const [stop, reason] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(true);
      expect(reason).toBe('Degenerate state detected');
    });

    it('fires plateau stop (not degenerate) when diversity >= 0.01', () => {
      const cfg = makeConfig({ expansionMaxIterations: 1, plateauWindow: 3, plateauThreshold: 0.02 });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      state.ratings.set('v-0', ratingWithOrdinal(21));
      state.diversityScore = 0.5; // >= 0.01 → normal plateau

      supervisor.beginIteration(state);

      supervisor.shouldStop(state, 10);
      state.iteration = 2;
      supervisor.beginIteration(state);
      supervisor.shouldStop(state, 10);
      state.iteration = 3;
      supervisor.beginIteration(state);
      const [stop, reason] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(true);
      expect(reason).toBe('Quality plateau detected');
    });

    it('fires plateau (not degenerate) when diversity is null', () => {
      const cfg = makeConfig({ expansionMaxIterations: 1, plateauWindow: 3, plateauThreshold: 0.02 });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      state.ratings.set('v-0', ratingWithOrdinal(21));
      state.diversityScore = null; // null → isDiversityValid returns false → not degenerate

      supervisor.beginIteration(state);

      supervisor.shouldStop(state, 10);
      state.iteration = 2;
      supervisor.beginIteration(state);
      supervisor.shouldStop(state, 10);
      state.iteration = 3;
      supervisor.beginIteration(state);
      const [stop, reason] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(true);
      expect(reason).toBe('Quality plateau detected');
    });

    it('does not plateau in EXPANSION', () => {
      const supervisor = new PoolSupervisor(makeConfig());
      const state = makeState(3, 0);
      state.ratings.set('v-0', ratingWithOrdinal(21));
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
      supervisor.ordinalHistory = [20, 21, 21.5];
      supervisor.diversityHistory = [0.3, 0.4];

      const resumeState = supervisor.getResumeState();
      expect(resumeState.phase).toBe('COMPETITION');

      const supervisor2 = new PoolSupervisor(cfg);
      supervisor2.setPhaseFromResume(resumeState.phase, resumeState.strategyRotationIndex);
      supervisor2.ordinalHistory = resumeState.ordinalHistory;
      supervisor2.diversityHistory = resumeState.diversityHistory;

      expect(supervisor2.currentPhase).toBe('COMPETITION');
      expect(supervisor2.ordinalHistory).toEqual([20, 21, 21.5]);
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
    it('accepts expansion.maxIterations: 0 with small maxIterations (auto-clamped config)', () => {
      // After resolveConfig auto-clamps for short runs (e.g. maxIterations: 3),
      // expansion.maxIterations becomes 0. Supervisor must accept this.
      const supervisor = new PoolSupervisor(makeConfig({
        maxIterations: 3,
        expansionMaxIterations: 0,
        plateauWindow: 2,
      }));
      expect(supervisor.currentPhase).toBe('EXPANSION');
      // At iteration 0 with expansionMaxIterations=0, should immediately transition to COMPETITION
      const state = makeState(0, 0);
      expect(supervisor.detectPhase(state)).toBe('COMPETITION');
    });
  });

  describe('singleArticle mode', () => {
    function makeSingleConfig(overrides: Partial<ReturnType<typeof supervisorConfigFromRunConfig>> = {}) {
      return makeConfig({
        singleArticle: true,
        expansionMaxIterations: 0,
        expansionMinPool: 1,
        maxIterations: 3,
        plateauWindow: 2,
        plateauThreshold: 0.02,
        ...overrides,
      });
    }

    it('accepts expansionMinPool < 5 when expansionMaxIterations is 0', () => {
      expect(() => new PoolSupervisor(makeSingleConfig({ expansionMinPool: 1 }))).not.toThrow();
    });

    it('still rejects expansionMinPool < 5 when expansionMaxIterations > 0', () => {
      expect(() => new PoolSupervisor(makeConfig({ expansionMinPool: 3, expansionMaxIterations: 5 }))).toThrow();
    });

    it('accepts maxIterations: 1 when expansionMaxIterations is 0', () => {
      expect(() => new PoolSupervisor(makeSingleConfig({ maxIterations: 1 }))).not.toThrow();
    });

    it('still rejects maxIterations <= expansionMaxIterations when expansion enabled', () => {
      expect(() => new PoolSupervisor(makeConfig({ maxIterations: 2, expansionMaxIterations: 3 }))).toThrow();
    });

    it('detectPhase returns COMPETITION immediately when expansionMaxIterations is 0', () => {
      const supervisor = new PoolSupervisor(makeSingleConfig());
      const state = makeState(1, 0);
      expect(supervisor.detectPhase(state)).toBe('COMPETITION');
    });

    it('getPhaseConfig disables generation, outlineGeneration, and evolution', () => {
      const supervisor = new PoolSupervisor(makeSingleConfig());
      const state = makeState(1, 0);
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);

      expect(config.phase).toBe('COMPETITION');
      expect(config.runGeneration).toBe(false);
      expect(config.runOutlineGeneration).toBe(false);
      expect(config.runEvolution).toBe(false);
    });

    it('getPhaseConfig keeps improvement agents enabled', () => {
      const supervisor = new PoolSupervisor(makeSingleConfig());
      const state = makeState(1, 0);
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);

      expect(config.runReflection).toBe(true);
      expect(config.runIterativeEditing).toBe(true);
      expect(config.runTreeSearch).toBe(true);
      expect(config.runSectionDecomposition).toBe(true);
      expect(config.runCalibration).toBe(true);
      expect(config.runDebate).toBe(true);
      expect(config.runProximity).toBe(true);
      expect(config.runMetaReview).toBe(true);
    });

    it('getPhaseConfig with singleArticle false keeps all COMPETITION flags true', () => {
      const cfg = makeConfig({ expansionMaxIterations: 1, singleArticle: false });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);

      expect(config.runGeneration).toBe(true);
      expect(config.runOutlineGeneration).toBe(true);
      expect(config.runEvolution).toBe(true);
    });

    it('shouldStop works with plateauWindow: 2 and maxIterations: 3', () => {
      const supervisor = new PoolSupervisor(makeSingleConfig());
      const state = makeState(1, 0);
      state.ratings.set('v-0', ratingWithOrdinal(21));

      supervisor.beginIteration(state);
      const [stop1] = supervisor.shouldStop(state, 10);
      expect(stop1).toBe(false);
    });

    it('does not plateau after 1 data point with plateauWindow: 2', () => {
      const supervisor = new PoolSupervisor(makeSingleConfig());
      const state = makeState(1, 0);
      state.ratings.set('v-0', ratingWithOrdinal(21));

      supervisor.beginIteration(state);
      supervisor.shouldStop(state, 10); // records 1 data point

      state.iteration = 1;
      supervisor.beginIteration(state);
      const [stop] = supervisor.shouldStop(state, 10); // 2nd data point — plateau check now has window
      // With 2 data points of same value, improvement = 0, but plateau needs window=2 to trigger
      expect(stop).toBe(true); // 2 data points, 0 improvement
    });

    it('shouldStop returns quality_threshold when all critique dimensions >= 8', () => {
      const supervisor = new PoolSupervisor(makeSingleConfig());
      const state = makeState(1, 0);
      state.ratings.set('v-0', ratingWithOrdinal(30));
      state.allCritiques = [{
        variationId: 'v-0',
        dimensionScores: { clarity: 9, structure: 8, engagement: 8.5 },
        goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test',
      }];

      supervisor.beginIteration(state);
      const [stop, reason] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(true);
      expect(reason).toBe('quality_threshold');
    });

    it('shouldStop does not trigger quality_threshold when a dimension is below 8', () => {
      const supervisor = new PoolSupervisor(makeSingleConfig());
      const state = makeState(1, 0);
      state.ratings.set('v-0', ratingWithOrdinal(30));
      state.allCritiques = [{
        variationId: 'v-0',
        dimensionScores: { clarity: 9, structure: 7, engagement: 8 },
        goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test',
      }];

      supervisor.beginIteration(state);
      const [stop] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(false);
    });

    it('shouldStop does not trigger quality_threshold when singleArticle is false', () => {
      const cfg = makeConfig({ expansionMaxIterations: 1, singleArticle: false });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      state.ratings.set('v-0', ratingWithOrdinal(30));
      state.allCritiques = [{
        variationId: 'v-0',
        dimensionScores: { clarity: 9, structure: 9, engagement: 9 },
        goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test',
      }];

      supervisor.beginIteration(state);
      const [stop, reason] = supervisor.shouldStop(state, 10);
      // Should not trigger quality threshold — may stop for other reasons
      expect(reason).not.toBe('quality_threshold');
    });

    it('shouldStop does not trigger quality_threshold with empty critiques', () => {
      const supervisor = new PoolSupervisor(makeSingleConfig());
      const state = makeState(1, 0);
      state.allCritiques = [];

      supervisor.beginIteration(state);
      const [stop] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(false);
    });

    it('shouldStop uses latest critique for quality_threshold (not first)', () => {
      const supervisor = new PoolSupervisor(makeSingleConfig());
      const state = makeState(1, 0);
      state.ratings.set('v-0', ratingWithOrdinal(30));
      state.allCritiques = [
        {
          variationId: 'v-0',
          dimensionScores: { clarity: 5, structure: 5 },
          goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test',
        },
        {
          variationId: 'v-0',
          dimensionScores: { clarity: 9, structure: 9 },
          goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test',
        },
      ];

      supervisor.beginIteration(state);
      const [stop, reason] = supervisor.shouldStop(state, 10);
      expect(stop).toBe(true);
      expect(reason).toBe('quality_threshold');
    });
  });

  describe('enabledAgents gating', () => {
    it('all agents enabled when enabledAgents undefined (backward compat)', () => {
      const cfg = makeConfig({ expansionMaxIterations: 1, enabledAgents: undefined });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);

      expect(config.runReflection).toBe(true);
      expect(config.runIterativeEditing).toBe(true);
      expect(config.runTreeSearch).toBe(true);
      expect(config.runDebate).toBe(true);
      expect(config.runEvolution).toBe(true);
      expect(config.runMetaReview).toBe(true);
      expect(config.runOutlineGeneration).toBe(true);
      expect(config.runSectionDecomposition).toBe(true);
    });

    it('disables optional agents not in enabledAgents (COMPETITION)', () => {
      const cfg = makeConfig({
        expansionMaxIterations: 1,
        enabledAgents: ['reflection', 'debate'],
      });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);

      expect(config.runReflection).toBe(true);
      expect(config.runDebate).toBe(true);
      // Disabled optional agents
      expect(config.runIterativeEditing).toBe(false);
      expect(config.runTreeSearch).toBe(false);
      expect(config.runEvolution).toBe(false);
      expect(config.runMetaReview).toBe(false);
      expect(config.runOutlineGeneration).toBe(false);
      expect(config.runSectionDecomposition).toBe(false);
    });

    it('required agents always enabled even with empty enabledAgents', () => {
      const cfg = makeConfig({
        expansionMaxIterations: 1,
        enabledAgents: [],
      });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);

      // Required agents gated by isEnabled should still be true
      expect(config.runCalibration).toBe(true);
      // Generation still gated by singleArticle in COMPETITION, but isEnabled passes
      expect(config.runGeneration).toBe(true);
      expect(config.runProximity).toBe(true);
    });

    it('gates EXPANSION phase agents by enabledAgents', () => {
      const cfg = makeConfig({ enabledAgents: ['reflection'] });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(3, 0);
      state.diversityScore = 0.5;
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);

      expect(config.phase).toBe('EXPANSION');
      // Required agents always on in EXPANSION
      expect(config.runGeneration).toBe(true);
      expect(config.runCalibration).toBe(true);
      expect(config.runProximity).toBe(true);
    });

    it('combines enabledAgents with singleArticle mode', () => {
      const cfg = makeConfig({
        singleArticle: true,
        expansionMaxIterations: 0,
        expansionMinPool: 1,
        maxIterations: 3,
        plateauWindow: 2,
        enabledAgents: ['reflection', 'generation'], // generation listed but overridden by singleArticle
      });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(1, 0);
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);

      // singleArticle overrides generation even though it's in enabledAgents
      expect(config.runGeneration).toBe(false);
      expect(config.runOutlineGeneration).toBe(false);
      expect(config.runEvolution).toBe(false);
      // reflection is enabled and not blocked by singleArticle
      expect(config.runReflection).toBe(true);
    });

    it('supervisorConfigFromRunConfig passes enabledAgents through', () => {
      const runConfig: EvolutionRunConfig = {
        ...DEFAULT_EVOLUTION_CONFIG,
        enabledAgents: ['reflection', 'debate', 'metaReview'],
      };
      const supervisorCfg = supervisorConfigFromRunConfig(runConfig);
      expect(supervisorCfg.enabledAgents).toEqual(['reflection', 'debate', 'metaReview']);
    });

    it('supervisorConfigFromRunConfig leaves enabledAgents undefined when not set', () => {
      const runConfig: EvolutionRunConfig = { ...DEFAULT_EVOLUTION_CONFIG };
      const supervisorCfg = supervisorConfigFromRunConfig(runConfig);
      expect(supervisorCfg.enabledAgents).toBeUndefined();
    });
  });
});
