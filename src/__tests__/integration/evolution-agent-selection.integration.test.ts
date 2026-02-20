// Integration test for agent selection: strategy config with enabledAgents flows through
// preparePipelineRun (budget redistribution) and PoolSupervisor (agent gating).
// Verifies the full wiring without a real DB — uses mock LLM client.

import {
  NOOP_SPAN,
  createMockEvolutionLLMClient,
  createMockEvolutionLogger,
} from '@evolution/testing/evolution-test-helpers';

// Mock instrumentation before pipeline imports
jest.mock('../../../instrumentation', () => ({
  createAppSpan: jest.fn(() => NOOP_SPAN),
  createLLMSpan: jest.fn(() => NOOP_SPAN),
  createDBSpan: jest.fn(() => NOOP_SPAN),
  createVectorSpan: jest.fn(() => NOOP_SPAN),
}));

import type { EvolutionRunConfig } from '@evolution/lib';
import {
  preparePipelineRun,
  DEFAULT_EVOLUTION_CONFIG,
  PoolSupervisor,
  supervisorConfigFromRunConfig,
  PipelineStateImpl,
  REQUIRED_AGENTS,
  OPTIONAL_AGENTS,
  computeEffectiveBudgetCaps,
} from '@evolution/lib';

describe('Agent Selection Integration', () => {
  describe('preparePipelineRun with enabledAgents', () => {
    it('redistributes budget caps when enabledAgents limits optional agents', () => {
      const mockLlm = createMockEvolutionLLMClient();
      const { ctx, config } = preparePipelineRun({
        runId: 'test-run-1',
        originalText: 'Test article for agent selection.',
        title: 'Agent Selection Test',
        explanationId: null,
        configOverrides: {
          enabledAgents: ['reflection', 'debate'],
        },
        llmClient: mockLlm,
      });

      // enabledAgents should be passed through
      expect(config.enabledAgents).toEqual(['reflection', 'debate']);

      // Budget caps should be redistributed — disabled agents removed
      expect(ctx.payload.config.budgetCaps).not.toHaveProperty('iterativeEditing');
      expect(ctx.payload.config.budgetCaps).not.toHaveProperty('treeSearch');
      expect(ctx.payload.config.budgetCaps).not.toHaveProperty('evolution');
      expect(ctx.payload.config.budgetCaps).not.toHaveProperty('outlineGeneration');
      expect(ctx.payload.config.budgetCaps).not.toHaveProperty('sectionDecomposition');
      expect(ctx.payload.config.budgetCaps).not.toHaveProperty('metaReview');

      // Required agents with default caps always present
      expect(ctx.payload.config.budgetCaps).toHaveProperty('generation');
      expect(ctx.payload.config.budgetCaps).toHaveProperty('calibration');
      expect(ctx.payload.config.budgetCaps).toHaveProperty('tournament');
      // Note: proximity is REQUIRED but has no default budget cap entry

      // Enabled optional agents present
      expect(ctx.payload.config.budgetCaps).toHaveProperty('reflection');
      expect(ctx.payload.config.budgetCaps).toHaveProperty('debate');

      // flowCritique is a managed optional agent — not in enabledAgents, so removed
      expect(ctx.payload.config.budgetCaps).not.toHaveProperty('flowCritique');
    });

    it('preserves all agents when enabledAgents undefined (backward compat)', () => {
      const mockLlm = createMockEvolutionLLMClient();
      const { ctx } = preparePipelineRun({
        runId: 'test-run-2',
        originalText: 'Test article backward compat.',
        title: 'Backward Compat Test',
        explanationId: null,
        configOverrides: {},
        llmClient: mockLlm,
      });

      // All default budget cap agents should be present
      for (const agent of Object.keys(DEFAULT_EVOLUTION_CONFIG.budgetCaps)) {
        expect(ctx.payload.config.budgetCaps).toHaveProperty(agent);
      }
    });

    it('singleArticle mode removes generation/outline/evolution from budget', () => {
      const mockLlm = createMockEvolutionLLMClient();
      const { ctx } = preparePipelineRun({
        runId: 'test-run-3',
        originalText: 'Single article test.',
        title: 'Single Article Test',
        explanationId: null,
        configOverrides: { singleArticle: true },
        llmClient: mockLlm,
      });

      expect(ctx.payload.config.budgetCaps).not.toHaveProperty('generation');
      expect(ctx.payload.config.budgetCaps).not.toHaveProperty('outlineGeneration');
      expect(ctx.payload.config.budgetCaps).not.toHaveProperty('evolution');
      // Other agents still present
      expect(ctx.payload.config.budgetCaps).toHaveProperty('calibration');
      expect(ctx.payload.config.budgetCaps).toHaveProperty('reflection');
    });
  });

  describe('PoolSupervisor respects enabledAgents from config', () => {
    it('gates COMPETITION agents by enabledAgents from run config', () => {
      const runConfig = {
        ...DEFAULT_EVOLUTION_CONFIG,
        enabledAgents: ['reflection', 'debate'] as EvolutionRunConfig['enabledAgents'],
      };
      const supervisorCfg = supervisorConfigFromRunConfig(runConfig as EvolutionRunConfig);

      // Force into COMPETITION phase
      const supervisor = new PoolSupervisor({
        ...supervisorCfg,
        expansionMaxIterations: 0,
        expansionMinPool: 1,
        maxIterations: 3,
        plateauWindow: 2,
      });

      const state = new PipelineStateImpl('Test text');
      state.iteration = 0;
      supervisor.beginIteration(state);

      const phaseConfig = supervisor.getPhaseConfig(state);
      expect(phaseConfig.phase).toBe('COMPETITION');

      // Enabled optional agents
      expect(phaseConfig.activeAgents).toContain('reflection');
      expect(phaseConfig.activeAgents).toContain('debate');

      // Disabled optional agents
      expect(phaseConfig.activeAgents).not.toContain('iterativeEditing');
      expect(phaseConfig.activeAgents).not.toContain('treeSearch');
      expect(phaseConfig.activeAgents).not.toContain('evolution');
      expect(phaseConfig.activeAgents).not.toContain('metaReview');
      expect(phaseConfig.activeAgents).not.toContain('outlineGeneration');
      expect(phaseConfig.activeAgents).not.toContain('sectionDecomposition');
    });
  });

  describe('end-to-end: config → budget → supervisor', () => {
    it('enabledAgents consistently applied across budget redistribution and supervisor', () => {
      const enabledAgents = ['reflection', 'iterativeEditing', 'debate'] as const;

      // Budget redistribution
      const budgetCaps = computeEffectiveBudgetCaps(
        DEFAULT_EVOLUTION_CONFIG.budgetCaps,
        [...enabledAgents],
        false,
      );

      // Supervisor gating
      const runConfig = { ...DEFAULT_EVOLUTION_CONFIG, enabledAgents: [...enabledAgents] };
      const supervisorCfg = supervisorConfigFromRunConfig(runConfig);
      const supervisor = new PoolSupervisor({
        ...supervisorCfg,
        expansionMaxIterations: 0,
        expansionMinPool: 1,
        maxIterations: 3,
        plateauWindow: 2,
      });
      const state = new PipelineStateImpl('Test');
      state.iteration = 0;
      supervisor.beginIteration(state);
      const phaseConfig = supervisor.getPhaseConfig(state);

      // Budget should have caps for enabled agents only (+ required with caps + unmanaged)
      const budgetAgents = new Set(Object.keys(budgetCaps));

      // Required agents WITH default cap entries are present
      // (proximity has no default budgetCap, so it won't be in the result)
      const requiredWithCaps = REQUIRED_AGENTS.filter(
        a => a in DEFAULT_EVOLUTION_CONFIG.budgetCaps,
      );
      for (const req of requiredWithCaps) {
        expect(budgetAgents.has(req as string)).toBe(true);
      }

      // Enabled optional agents: present in budget, enabled in supervisor
      expect(budgetAgents.has('reflection')).toBe(true);
      expect(phaseConfig.activeAgents).toContain('reflection');
      expect(budgetAgents.has('iterativeEditing')).toBe(true);
      expect(phaseConfig.activeAgents).toContain('iterativeEditing');
      expect(budgetAgents.has('debate')).toBe(true);
      expect(phaseConfig.activeAgents).toContain('debate');

      // Disabled optional agents: absent from budget, disabled in supervisor
      expect(budgetAgents.has('treeSearch')).toBe(false);
      expect(phaseConfig.activeAgents).not.toContain('treeSearch');
      expect(budgetAgents.has('evolution')).toBe(false);
      expect(phaseConfig.activeAgents).not.toContain('evolution');
    });
  });
});
