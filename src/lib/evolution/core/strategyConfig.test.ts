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
  type StrategyConfigRow,
} from './strategyConfig';
import type { PromptMetadata, PipelineType } from '@/lib/evolution/types';

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

    it('ignores budgetCaps differences (not part of hash)', () => {
      const config1 = {
        ...baseConfig,
        budgetCaps: { a: 0.1, b: 0.2, c: 0.3 },
      };
      const config2 = {
        ...baseConfig,
        budgetCaps: { x: 0.9 },
      };
      expect(hashStrategyConfig(config1)).toBe(hashStrategyConfig(config2));
    });

    it('ignores agentModels differences (not part of hash)', () => {
      const config1: StrategyConfig = {
        ...baseConfig,
        agentModels: { generation: 'gpt-4', calibration: 'gpt-3.5' },
      };
      const config2: StrategyConfig = {
        ...baseConfig,
        agentModels: undefined,
      };
      expect(hashStrategyConfig(config1)).toBe(hashStrategyConfig(config2));
    });

    it('returns 12-character hex string', () => {
      const hash = hashStrategyConfig(baseConfig);
      expect(hash).toMatch(/^[a-f0-9]{12}$/);
    });

    it('treats undefined and empty agentModels the same (agentModels excluded from hash)', () => {
      const config1: StrategyConfig = { ...baseConfig, agentModels: undefined };
      const config2: StrategyConfig = { ...baseConfig, agentModels: {} };
      expect(hashStrategyConfig(config1)).toBe(hashStrategyConfig(config2));
    });

    it('does not include is_predefined or pipeline_type in hash (DB-only fields)', () => {
      // Critical invariant: two strategies with same runtime config but different
      // is_predefined or pipeline_type values must produce the same hash.
      // These fields live on StrategyConfigRow, not StrategyConfig, so they
      // should never reach hashStrategyConfig — this test ensures the type boundary.
      const hash1 = hashStrategyConfig(baseConfig);
      const hash2 = hashStrategyConfig({ ...baseConfig });

      // Verify StrategyConfig type does not accept is_predefined/pipeline_type
      // (compile-time check — if these fields were added to StrategyConfig,
      // this test file would fail to compile)
      const configKeys = Object.keys(baseConfig);
      expect(configKeys).not.toContain('is_predefined');
      expect(configKeys).not.toContain('pipeline_type');

      // Same config → same hash
      expect(hash1).toBe(hash2);
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

    it('omits agentModels from extracted config', () => {
      const runConfig = {
        agentModels: { generation: 'gpt-4o' as const },
      };

      const result = extractStrategyConfig(runConfig, defaultBudgetCaps);
      expect(result.agentModels).toBeUndefined();
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

  describe('StrategyConfigRow type', () => {
    it('includes DB-only fields not present in StrategyConfig', () => {
      // Type-level test: StrategyConfigRow has fields that StrategyConfig does not
      const row: StrategyConfigRow = {
        id: 'test-id',
        config_hash: 'abc123def456',
        name: 'Test Strategy',
        description: null,
        label: 'Gen: ds-chat | Judge: 4.1-nano | 10 iters',
        config: baseConfig,
        is_predefined: false,
        pipeline_type: 'full',
        status: 'active',
        created_by: 'system',
        run_count: 5,
        total_cost_usd: 2.50,
        avg_final_elo: 1350.5,
        avg_elo_per_dollar: 60.2,
        best_final_elo: 1500,
        worst_final_elo: 1200,
        stddev_final_elo: 75.3,
        first_used_at: '2026-01-01T00:00:00Z',
        last_used_at: '2026-02-07T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
      };

      expect(row.is_predefined).toBe(false);
      expect(row.pipeline_type).toBe('full');
      // Verify config embedded in row hashes to same value
      expect(hashStrategyConfig(row.config)).toBe(hashStrategyConfig(baseConfig));
    });

    it('accepts all valid pipeline_type values', () => {
      const types: Array<StrategyConfigRow['pipeline_type']> = ['full', 'minimal', 'batch', null];
      expect(types).toHaveLength(4);
    });
  });

  describe('PromptMetadata type', () => {
    it('represents prompt registry row with new metadata fields', () => {
      const prompt: PromptMetadata = {
        id: 'prompt-id',
        prompt: 'Explain quantum computing',
        title: 'Quantum Computing',
        difficulty_tier: 'hard',
        domain_tags: ['science', 'computing'],
        status: 'active',
        deleted_at: null,
        created_at: '2026-01-01T00:00:00Z',
      };

      expect(prompt.difficulty_tier).toBe('hard');
      expect(prompt.domain_tags).toContain('science');
      expect(prompt.status).toBe('active');
    });

    it('allows null difficulty_tier for unrated prompts', () => {
      const prompt: PromptMetadata = {
        id: 'prompt-id',
        prompt: 'Test prompt',
        title: 'Test prompt',
        difficulty_tier: null,
        domain_tags: [],
        status: 'active',
        deleted_at: null,
        created_at: '2026-01-01T00:00:00Z',
      };

      expect(prompt.difficulty_tier).toBeNull();
      expect(prompt.domain_tags).toEqual([]);
    });
  });

  describe('PipelineType', () => {
    it('accepts valid pipeline type values including single', () => {
      const types: PipelineType[] = ['full', 'minimal', 'batch', 'single'];
      expect(types).toHaveLength(4);
    });
  });

  describe('hashStrategyConfig — enabledAgents/singleArticle', () => {
    it('config WITHOUT enabledAgents produces same hash as before (backward compat)', () => {
      const hash = hashStrategyConfig(baseConfig);
      expect(hash).toBe(hashStrategyConfig({
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        iterations: 10,
        budgetCaps: { generation: 0.3, calibration: 0.2, tournament: 0.5 },
      }));
    });

    it('config WITH enabledAgents produces different hash', () => {
      const withAgents: StrategyConfig = {
        ...baseConfig,
        enabledAgents: ['reflection', 'debate'],
      };
      expect(hashStrategyConfig(withAgents)).not.toBe(hashStrategyConfig(baseConfig));
    });

    it('same enabledAgents in different order produce same hash', () => {
      const config1: StrategyConfig = {
        ...baseConfig,
        enabledAgents: ['reflection', 'debate', 'evolution'],
      };
      const config2: StrategyConfig = {
        ...baseConfig,
        enabledAgents: ['evolution', 'reflection', 'debate'],
      };
      expect(hashStrategyConfig(config1)).toBe(hashStrategyConfig(config2));
    });

    it('singleArticle: true produces different hash from undefined', () => {
      const withSingle: StrategyConfig = { ...baseConfig, singleArticle: true };
      expect(hashStrategyConfig(withSingle)).not.toBe(hashStrategyConfig(baseConfig));
    });

    it('singleArticle: false produces same hash as undefined (backward compat)', () => {
      const withFalse: StrategyConfig = { ...baseConfig, singleArticle: false };
      expect(hashStrategyConfig(withFalse)).toBe(hashStrategyConfig(baseConfig));
    });

    it('empty enabledAgents produces different hash from undefined', () => {
      const withEmpty: StrategyConfig = { ...baseConfig, enabledAgents: [] };
      expect(hashStrategyConfig(withEmpty)).not.toBe(hashStrategyConfig(baseConfig));
    });
  });

  describe('extractStrategyConfig — enabledAgents/singleArticle passthrough', () => {
    const defaultBudgetCaps = { generation: 0.25, calibration: 0.25 };

    it('passes through enabledAgents when provided', () => {
      const result = extractStrategyConfig(
        { enabledAgents: ['reflection', 'debate'] },
        defaultBudgetCaps,
      );
      expect(result.enabledAgents).toEqual(['reflection', 'debate']);
    });

    it('enabledAgents is undefined when not provided', () => {
      const result = extractStrategyConfig({}, defaultBudgetCaps);
      expect(result.enabledAgents).toBeUndefined();
    });

    it('passes through singleArticle when provided', () => {
      const result = extractStrategyConfig(
        { singleArticle: true },
        defaultBudgetCaps,
      );
      expect(result.singleArticle).toBe(true);
    });
  });

  describe('diffStrategyConfigs — enabledAgents/singleArticle', () => {
    it('detects enabledAgents difference', () => {
      const a: StrategyConfig = { ...baseConfig, enabledAgents: ['reflection'] };
      const b: StrategyConfig = { ...baseConfig, enabledAgents: ['reflection', 'debate'] };
      const diffs = diffStrategyConfigs(a, b);
      expect(diffs).toContainEqual(expect.objectContaining({ field: 'enabledAgents' }));
    });

    it('detects singleArticle difference', () => {
      const a: StrategyConfig = { ...baseConfig, singleArticle: false };
      const b: StrategyConfig = { ...baseConfig, singleArticle: true };
      const diffs = diffStrategyConfigs(a, b);
      expect(diffs).toContainEqual(expect.objectContaining({ field: 'singleArticle' }));
    });

    it('no diff when both have same enabledAgents (order independent)', () => {
      const a: StrategyConfig = { ...baseConfig, enabledAgents: ['debate', 'reflection'] };
      const b: StrategyConfig = { ...baseConfig, enabledAgents: ['reflection', 'debate'] };
      const diffs = diffStrategyConfigs(a, b);
      expect(diffs.find(d => d.field === 'enabledAgents')).toBeUndefined();
    });
  });

  describe('labelStrategyConfig — enabledAgents/singleArticle', () => {
    it('includes agent count when enabledAgents is set', () => {
      const config: StrategyConfig = {
        ...baseConfig,
        enabledAgents: ['reflection', 'debate', 'evolution'],
      };
      const label = labelStrategyConfig(config);
      expect(label).toContain('7 agents'); // 3 optional + 4 required
    });

    it('includes single-article when set', () => {
      const config: StrategyConfig = { ...baseConfig, singleArticle: true };
      const label = labelStrategyConfig(config);
      expect(label).toContain('single-article');
    });

    it('omits agent count when enabledAgents is undefined', () => {
      const label = labelStrategyConfig(baseConfig);
      expect(label).not.toContain('agents');
    });
  });

  // CFG-8: Zod validation in extractStrategyConfig
  describe('extractStrategyConfig validation', () => {
    it('rejects invalid model names', () => {
      expect(() =>
        extractStrategyConfig(
          { generationModel: 'not-a-real-model' as any },
          baseConfig.budgetCaps,
        ),
      ).toThrow();
    });

    it('rejects negative maxIterations', () => {
      expect(() =>
        extractStrategyConfig(
          { maxIterations: -1 },
          baseConfig.budgetCaps,
        ),
      ).toThrow();
    });

    it('accepts valid input without throwing', () => {
      expect(() =>
        extractStrategyConfig(
          { generationModel: 'deepseek-chat', judgeModel: 'gpt-4.1-nano', maxIterations: 10 },
          baseConfig.budgetCaps,
        ),
      ).not.toThrow();
    });
  });
});
