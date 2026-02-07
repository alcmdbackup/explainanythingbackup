/**
 * Unit tests for strategyConfig: hashing, labeling, diffing utilities.
 */

import {
  hashStrategyConfig,
  labelStrategyConfig,
  defaultStrategyName,
  extractStrategyConfig,
  diffStrategyConfigs,
  type StrategyConfig,
} from './strategyConfig';

describe('strategyConfig', () => {
  const baseConfig: StrategyConfig = {
    generationModel: 'deepseek-chat',
    judgeModel: 'gpt-4.1-nano',
    iterations: 10,
    budgetCaps: { generation: 0.3, calibration: 0.2, tournament: 0.5 },
  };

  describe('hashStrategyConfig', () => {
    it('produces consistent hash for same config', () => {
      const hash1 = hashStrategyConfig(baseConfig);
      const hash2 = hashStrategyConfig(baseConfig);
      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different configs', () => {
      const hash1 = hashStrategyConfig(baseConfig);
      const hash2 = hashStrategyConfig({ ...baseConfig, iterations: 15 });
      expect(hash1).not.toBe(hash2);
    });

    it('is order-independent for budgetCaps keys', () => {
      const config1 = {
        ...baseConfig,
        budgetCaps: { a: 0.1, b: 0.2, c: 0.3 },
      };
      const config2 = {
        ...baseConfig,
        budgetCaps: { c: 0.3, a: 0.1, b: 0.2 },
      };
      expect(hashStrategyConfig(config1)).toBe(hashStrategyConfig(config2));
    });

    it('is order-independent for agentModels keys', () => {
      const config1: StrategyConfig = {
        ...baseConfig,
        agentModels: { generation: 'gpt-4', calibration: 'gpt-3.5' },
      };
      const config2: StrategyConfig = {
        ...baseConfig,
        agentModels: { calibration: 'gpt-3.5', generation: 'gpt-4' },
      };
      expect(hashStrategyConfig(config1)).toBe(hashStrategyConfig(config2));
    });

    it('returns 12-character hex string', () => {
      const hash = hashStrategyConfig(baseConfig);
      expect(hash).toMatch(/^[a-f0-9]{12}$/);
    });

    it('treats undefined agentModels differently from empty object', () => {
      const config1: StrategyConfig = { ...baseConfig, agentModels: undefined };
      const config2: StrategyConfig = { ...baseConfig, agentModels: {} };
      // These should have different hashes since one is null and one is {}
      expect(hashStrategyConfig(config1)).not.toBe(hashStrategyConfig(config2));
    });
  });

  describe('labelStrategyConfig', () => {
    it('includes generation model (shortened)', () => {
      const label = labelStrategyConfig(baseConfig);
      expect(label).toContain('Gen: ds-chat');
    });

    it('includes judge model (shortened)', () => {
      const label = labelStrategyConfig(baseConfig);
      expect(label).toContain('Judge: 4.1-nano');
    });

    it('includes iteration count', () => {
      const label = labelStrategyConfig(baseConfig);
      expect(label).toContain('10 iters');
    });

    it('includes agent overrides when present', () => {
      const config: StrategyConfig = {
        ...baseConfig,
        agentModels: { generation: 'gpt-4o' },
      };
      const label = labelStrategyConfig(config);
      expect(label).toContain('Overrides:');
      expect(label).toContain('generation: 4o');
    });

    it('omits overrides section when no agentModels', () => {
      const label = labelStrategyConfig(baseConfig);
      expect(label).not.toContain('Overrides');
    });

    it('shortens common model prefixes', () => {
      const config: StrategyConfig = {
        ...baseConfig,
        generationModel: 'claude-3.5-sonnet',
        judgeModel: 'deepseek-reasoner',
      };
      const label = labelStrategyConfig(config);
      expect(label).toContain('Gen: cl-3.5-sonnet');
      expect(label).toContain('Judge: ds-reasoner');
    });
  });

  describe('defaultStrategyName', () => {
    it('includes hash prefix and model info', () => {
      const hash = hashStrategyConfig(baseConfig);
      const name = defaultStrategyName(baseConfig, hash);
      expect(name).toContain('Strategy');
      expect(name).toContain(hash.slice(0, 6));
      expect(name).toContain('chat'); // from deepseek-chat
      expect(name).toContain('10it');
    });

    it('extracts last segment of model name', () => {
      const config: StrategyConfig = {
        ...baseConfig,
        generationModel: 'gpt-4-turbo-preview',
      };
      const hash = hashStrategyConfig(config);
      const name = defaultStrategyName(config, hash);
      expect(name).toContain('preview');
    });
  });

  describe('extractStrategyConfig', () => {
    const defaultBudgetCaps = { generation: 0.25, calibration: 0.25, tournament: 0.25, evolution: 0.25 };

    it('uses provided values when available', () => {
      const runConfig = {
        generationModel: 'gpt-4o' as const,
        judgeModel: 'gpt-4.1-nano' as const,
        maxIterations: 20,
        budgetCaps: { generation: 0.5 },
      };

      const result = extractStrategyConfig(runConfig, defaultBudgetCaps);

      expect(result.generationModel).toBe('gpt-4o');
      expect(result.judgeModel).toBe('gpt-4.1-nano');
      expect(result.iterations).toBe(20);
      expect(result.budgetCaps).toEqual({ generation: 0.5 });
    });

    it('uses defaults when values not provided', () => {
      const result = extractStrategyConfig({}, defaultBudgetCaps);

      expect(result.generationModel).toBe('deepseek-chat');
      expect(result.judgeModel).toBe('gpt-4.1-nano');
      expect(result.iterations).toBe(15);
      expect(result.budgetCaps).toEqual(defaultBudgetCaps);
    });

    it('includes agentModels when provided', () => {
      const runConfig = {
        agentModels: { generation: 'gpt-4o' as const },
      };

      const result = extractStrategyConfig(runConfig, defaultBudgetCaps);
      expect(result.agentModels).toEqual({ generation: 'gpt-4o' });
    });
  });

  describe('diffStrategyConfigs', () => {
    it('returns empty array for identical configs', () => {
      const diffs = diffStrategyConfigs(baseConfig, baseConfig);
      expect(diffs).toEqual([]);
    });

    it('detects generationModel difference', () => {
      const config2 = { ...baseConfig, generationModel: 'gpt-4o' };
      const diffs = diffStrategyConfigs(baseConfig, config2);

      expect(diffs).toContainEqual({
        field: 'generationModel',
        valueA: 'deepseek-chat',
        valueB: 'gpt-4o',
      });
    });

    it('detects judgeModel difference', () => {
      const config2 = { ...baseConfig, judgeModel: 'gpt-4-turbo' };
      const diffs = diffStrategyConfigs(baseConfig, config2);

      expect(diffs).toContainEqual({
        field: 'judgeModel',
        valueA: 'gpt-4.1-nano',
        valueB: 'gpt-4-turbo',
      });
    });

    it('detects iterations difference', () => {
      const config2 = { ...baseConfig, iterations: 20 };
      const diffs = diffStrategyConfigs(baseConfig, config2);

      expect(diffs).toContainEqual({
        field: 'iterations',
        valueA: '10',
        valueB: '20',
      });
    });

    it('detects agentModels difference', () => {
      const config1: StrategyConfig = {
        ...baseConfig,
        agentModels: { generation: 'gpt-4' },
      };
      const config2: StrategyConfig = {
        ...baseConfig,
        agentModels: { generation: 'gpt-3.5' },
      };

      const diffs = diffStrategyConfigs(config1, config2);

      expect(diffs).toContainEqual({
        field: 'agentModels.generation',
        valueA: 'gpt-4',
        valueB: 'gpt-3.5',
      });
    });

    it('handles missing agentModels on one side', () => {
      const config1: StrategyConfig = {
        ...baseConfig,
        agentModels: { generation: 'gpt-4' },
      };
      const config2: StrategyConfig = {
        ...baseConfig,
        agentModels: undefined,
      };

      const diffs = diffStrategyConfigs(config1, config2);

      expect(diffs).toContainEqual({
        field: 'agentModels.generation',
        valueA: 'gpt-4',
        valueB: '-',
      });
    });

    it('detects multiple differences', () => {
      const config1: StrategyConfig = {
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        iterations: 10,
        budgetCaps: {},
      };
      const config2: StrategyConfig = {
        generationModel: 'gpt-4o',
        judgeModel: 'gpt-4-turbo',
        iterations: 15,
        budgetCaps: {},
      };

      const diffs = diffStrategyConfigs(config1, config2);

      expect(diffs.length).toBe(3);
      expect(diffs.map(d => d.field)).toEqual(['generationModel', 'judgeModel', 'iterations']);
    });
  });
});
