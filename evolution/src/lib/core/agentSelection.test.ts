// Tests agent selection wiring: strategy config with enabledAgents flows through
// preparePipelineRun (budget redistribution) and PoolSupervisor (agent gating).

import {
  NOOP_SPAN,
  createMockEvolutionLLMClient,
} from '@evolution/testing/evolution-test-helpers';

// Mock instrumentation before pipeline imports
jest.mock('../../../../instrumentation', () => ({
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
} from '@evolution/lib';

describe('Agent Selection Integration', () => {
  describe('preparePipelineRun with enabledAgents', () => {
    it('passes through enabledAgents to config', () => {
      const mockLlm = createMockEvolutionLLMClient();
      const { config } = preparePipelineRun({
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

});
