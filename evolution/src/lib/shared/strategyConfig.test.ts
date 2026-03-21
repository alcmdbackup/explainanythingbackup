/**
 * Unit tests for strategyConfig: labeling and normalization utilities.
 * V1 hashing/extraction/diffing tests removed — V2 versions live in v2/strategy.test.ts.
 */

import {
  labelStrategyConfig,
  defaultStrategyName,
  normalizeEnabledAgents,
  type StrategyConfig,
  type StrategyConfigRow,
} from './strategyConfig';
import type { PromptMetadata, PipelineType } from '../types';

describe('strategyConfig', () => {
  const baseConfig: StrategyConfig = {
    generationModel: 'deepseek-chat',
    judgeModel: 'gpt-4.1-nano',
    iterations: 10,
  };

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

    it('includes budget when budgetCapUsd is set', () => {
      const config: StrategyConfig = { ...baseConfig, budgetCapUsd: 0.25 };
      const label = labelStrategyConfig(config);
      expect(label).toContain('Budget: $0.25');
    });

    it('omits budget when budgetCapUsd is not set', () => {
      const label = labelStrategyConfig(baseConfig);
      expect(label).not.toContain('Budget');
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

  describe('defaultStrategyName', () => {
    it('includes hash prefix and model info', () => {
      const hash = 'abc123def456';
      const name = defaultStrategyName(baseConfig, hash);
      expect(name).toContain('Strategy');
      expect(name).toContain('abc123');
      expect(name).toContain('chat'); // from deepseek-chat
      expect(name).toContain('10it');
    });

    it('extracts last segment of model name', () => {
      const config: StrategyConfig = {
        ...baseConfig,
        generationModel: 'gpt-4-turbo-preview',
      };
      const name = defaultStrategyName(config, 'abc123def456');
      expect(name).toContain('preview');
    });
  });

  describe('StrategyConfigRow type', () => {
    it('includes DB-only fields not present in StrategyConfig', () => {
      const row: StrategyConfigRow = {
        id: 'test-id',
        config_hash: 'abc123def456',
        name: 'Test Strategy',
        description: null,
        label: 'Gen: ds-chat | Judge: 4.1-nano | 10 iters',
        config: { generationModel: 'deepseek-chat', judgeModel: 'gpt-4.1-nano', iterations: 10 },
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
    });

    it('accepts all valid pipeline_type values', () => {
      const types: Array<StrategyConfigRow['pipeline_type']> = ['full', 'single', null];
      expect(types).toHaveLength(3);
    });
  });

  describe('PromptMetadata type', () => {
    it('represents prompt registry row with metadata fields', () => {
      const prompt: PromptMetadata = {
        id: 'prompt-id',
        prompt: 'Explain quantum computing',
        title: 'Quantum Computing',
        status: 'active',
        deleted_at: null,
        created_at: '2026-01-01T00:00:00Z',
      };

      expect(prompt.status).toBe('active');
      expect(prompt.deleted_at).toBeNull();
    });
  });

  describe('PipelineType', () => {
    it('accepts valid pipeline type values including single', () => {
      const types: PipelineType[] = ['full', 'single'];
      expect(types).toHaveLength(2);
    });
  });

  describe('normalizeEnabledAgents', () => {
    it('returns undefined for undefined input', () => {
      expect(normalizeEnabledAgents(undefined)).toBeUndefined();
    });

    it('returns undefined for empty array', () => {
      expect(normalizeEnabledAgents([])).toBeUndefined();
    });

    it('sorts non-empty array', () => {
      const result = normalizeEnabledAgents(['debate', 'reflection', 'evolution']);
      expect(result).toEqual(['debate', 'evolution', 'reflection']);
    });

    it('does not mutate original array', () => {
      const original = ['debate', 'reflection'] as any[];
      normalizeEnabledAgents(original);
      expect(original).toEqual(['debate', 'reflection']);
    });
  });
});
