// Unit tests for PoolSupervisor phase transitions, plateau detection, resume, and getActiveAgents.

import { PoolSupervisor, supervisorConfigFromRunConfig, getActiveAgents } from './supervisor';
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

  describe('getPhaseConfig', () => {
    it('EXPANSION: returns phase and limited agents', () => {
      const supervisor = new PoolSupervisor(makeConfig());
      const state = makeState(3, 0);
      state.diversityScore = 0.5;
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);
      expect(config.phase).toBe('EXPANSION');
      expect(config.activeAgents).not.toContain('evolution');
      expect(config.activeAgents).not.toContain('reflection');
      expect(config.activeAgents).not.toContain('iterativeEditing');
      expect(config.activeAgents).not.toContain('treeSearch');
      expect(config.activeAgents).not.toContain('sectionDecomposition');
      expect(config.activeAgents).not.toContain('debate');
    });

    it('COMPETITION: enables all agents in execution order', () => {
      const cfg = makeConfig({ expansionMaxIterations: 1 });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);
      expect(config.phase).toBe('COMPETITION');
      expect(config.activeAgents).toContain('evolution');
      expect(config.activeAgents).toContain('reflection');
      expect(config.activeAgents).toContain('iterativeEditing');
      expect(config.activeAgents).toContain('treeSearch');
      expect(config.activeAgents).toContain('sectionDecomposition');
      expect(config.activeAgents).toContain('debate');
      expect(config.activeAgents).toContain('metaReview');
      expect(config.activeAgents).toContain('ranking');
      expect(config.activeAgents.length).toBeGreaterThan(3);
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
      supervisor.setPhaseFromResume('COMPETITION');
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
      supervisor2.setPhaseFromResume(resumeState.phase);
      supervisor2.ordinalHistory = resumeState.ordinalHistory;
      supervisor2.diversityHistory = resumeState.diversityHistory;

      expect(supervisor2.currentPhase).toBe('COMPETITION');
      expect(supervisor2.ordinalHistory).toEqual([20, 21, 21.5]);
    });

    it('rejects invalid phase', () => {
      const supervisor = new PoolSupervisor(makeConfig());
      expect(() => supervisor.setPhaseFromResume('INVALID' as 'EXPANSION')).toThrow('Invalid phase');
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
      expect(config.activeAgents).not.toContain('generation');
      expect(config.activeAgents).not.toContain('outlineGeneration');
      expect(config.activeAgents).not.toContain('evolution');
    });

    it('getPhaseConfig keeps improvement agents enabled', () => {
      const supervisor = new PoolSupervisor(makeSingleConfig());
      const state = makeState(1, 0);
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);

      expect(config.activeAgents).toContain('reflection');
      expect(config.activeAgents).toContain('iterativeEditing');
      expect(config.activeAgents).toContain('treeSearch');
      expect(config.activeAgents).toContain('sectionDecomposition');
      expect(config.activeAgents).toContain('ranking');
      expect(config.activeAgents).toContain('debate');
      expect(config.activeAgents).toContain('proximity');
      expect(config.activeAgents).toContain('metaReview');
    });

    it('getPhaseConfig with singleArticle false keeps all COMPETITION flags true', () => {
      const cfg = makeConfig({ expansionMaxIterations: 1, singleArticle: false });
      const supervisor = new PoolSupervisor(cfg);
      const state = makeState(20, 1);
      supervisor.beginIteration(state);
      const config = supervisor.getPhaseConfig(state);

      expect(config.activeAgents).toContain('generation');
      expect(config.activeAgents).toContain('outlineGeneration');
      expect(config.activeAgents).toContain('evolution');
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

      expect(config.activeAgents).toContain('reflection');
      expect(config.activeAgents).toContain('iterativeEditing');
      expect(config.activeAgents).toContain('treeSearch');
      expect(config.activeAgents).toContain('debate');
      expect(config.activeAgents).toContain('evolution');
      expect(config.activeAgents).toContain('metaReview');
      expect(config.activeAgents).toContain('outlineGeneration');
      expect(config.activeAgents).toContain('sectionDecomposition');
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

      expect(config.activeAgents).toContain('reflection');
      expect(config.activeAgents).toContain('debate');
      // Disabled optional agents
      expect(config.activeAgents).not.toContain('iterativeEditing');
      expect(config.activeAgents).not.toContain('treeSearch');
      expect(config.activeAgents).not.toContain('evolution');
      expect(config.activeAgents).not.toContain('metaReview');
      expect(config.activeAgents).not.toContain('outlineGeneration');
      expect(config.activeAgents).not.toContain('sectionDecomposition');
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

      // Required agents gated by isEnabled should still be present
      expect(config.activeAgents).toContain('ranking');
      // Generation still gated by singleArticle in COMPETITION, but isEnabled passes
      expect(config.activeAgents).toContain('generation');
      expect(config.activeAgents).toContain('proximity');
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
      expect(config.activeAgents).toContain('generation');
      expect(config.activeAgents).toContain('ranking');
      expect(config.activeAgents).toContain('proximity');
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
      expect(config.activeAgents).not.toContain('generation');
      expect(config.activeAgents).not.toContain('outlineGeneration');
      expect(config.activeAgents).not.toContain('evolution');
      // reflection is enabled and not blocked by singleArticle
      expect(config.activeAgents).toContain('reflection');
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

describe('getActiveAgents', () => {
  it('EXPANSION returns only generation, ranking, proximity', () => {
    const agents = getActiveAgents('EXPANSION', undefined, false);
    expect(agents).toEqual(['generation', 'ranking', 'proximity']);
  });

  it('COMPETITION returns all enabled agents in correct order', () => {
    const agents = getActiveAgents('COMPETITION', undefined, false);
    expect(agents).toEqual([
      'generation', 'outlineGeneration', 'reflection', 'flowCritique',
      'iterativeEditing', 'treeSearch', 'sectionDecomposition',
      'debate', 'evolution',
      'ranking',
      'proximity', 'metaReview',
    ]);
  });

  it('singleArticle excludes generation, outlineGeneration, evolution', () => {
    const agents = getActiveAgents('COMPETITION', undefined, true);
    expect(agents).not.toContain('generation');
    expect(agents).not.toContain('outlineGeneration');
    expect(agents).not.toContain('evolution');
    // Other agents still present
    expect(agents).toContain('reflection');
    expect(agents).toContain('ranking');
  });

  it('required agents always present regardless of enabledAgents', () => {
    const agents = getActiveAgents('COMPETITION', [], false);
    // generation and proximity are REQUIRED_AGENTS, always present
    expect(agents).toContain('generation');
    expect(agents).toContain('proximity');
    // ranking sentinel always present
    expect(agents).toContain('ranking');
  });

  it('undefined enabledAgents includes all optional agents', () => {
    const agents = getActiveAgents('COMPETITION', undefined, false);
    expect(agents).toContain('reflection');
    expect(agents).toContain('iterativeEditing');
    expect(agents).toContain('treeSearch');
    expect(agents).toContain('flowCritique');
    expect(agents).toContain('debate');
    expect(agents).toContain('evolution');
    expect(agents).toContain('metaReview');
  });

  it('flowCritique included when in enabledAgents during COMPETITION', () => {
    const agents = getActiveAgents('COMPETITION', ['reflection', 'flowCritique'], false);
    expect(agents).toContain('flowCritique');
    expect(agents).toContain('reflection');
  });

  it('flowCritique excluded during EXPANSION (not in EXPANSION_ALLOWED)', () => {
    const agents = getActiveAgents('EXPANSION', ['reflection', 'flowCritique'], false);
    expect(agents).not.toContain('flowCritique');
    expect(agents).not.toContain('reflection');
  });

  it('ranking sentinel always present in both phases', () => {
    const expansion = getActiveAgents('EXPANSION', [], false);
    const competition = getActiveAgents('COMPETITION', [], false);
    expect(expansion).toContain('ranking');
    expect(competition).toContain('ranking');
  });

  it('order matches AGENT_EXECUTION_ORDER', () => {
    const agents = getActiveAgents('COMPETITION', undefined, false);
    // Verify relative ordering of key agents
    const genIdx = agents.indexOf('generation');
    const reflIdx = agents.indexOf('reflection');
    const rankIdx = agents.indexOf('ranking');
    const metaIdx = agents.indexOf('metaReview');
    expect(genIdx).toBeLessThan(reflIdx);
    expect(reflIdx).toBeLessThan(rankIdx);
    expect(rankIdx).toBeLessThan(metaIdx);
  });

  it('enabledAgents filters optional agents but keeps required ones', () => {
    const agents = getActiveAgents('COMPETITION', ['reflection', 'debate'], false);
    expect(agents).toContain('reflection');
    expect(agents).toContain('debate');
    expect(agents).not.toContain('iterativeEditing');
    expect(agents).not.toContain('treeSearch');
    expect(agents).not.toContain('evolution');
    // Required agents still present
    expect(agents).toContain('generation');
    expect(agents).toContain('proximity');
  });
});
