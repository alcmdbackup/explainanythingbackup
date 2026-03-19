// Tests for V2 forked strategy config utilities.

import { hashStrategyConfig, labelStrategyConfig } from './strategy';
import type { V2StrategyConfig } from './types';

describe('V2 hashStrategyConfig', () => {
  const baseConfig: V2StrategyConfig = {
    generationModel: 'gpt-4.1-mini',
    judgeModel: 'gpt-4.1-nano',
    iterations: 5,
  };

  it('produces a 12-char hex string', () => {
    const hash = hashStrategyConfig(baseConfig);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is deterministic', () => {
    expect(hashStrategyConfig(baseConfig)).toBe(hashStrategyConfig(baseConfig));
  });

  it('excludes V2-only fields from hash', () => {
    const withExtras: V2StrategyConfig = {
      ...baseConfig,
      strategiesPerRound: 2,
      budgetUsd: 5.0,
    };
    expect(hashStrategyConfig(withExtras)).toBe(hashStrategyConfig(baseConfig));
  });

  it('changes hash when core fields differ', () => {
    const different: V2StrategyConfig = { ...baseConfig, iterations: 10 };
    expect(hashStrategyConfig(different)).not.toBe(hashStrategyConfig(baseConfig));
  });
});

describe('V2 labelStrategyConfig', () => {
  it('produces correct format', () => {
    const config: V2StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 5,
    };
    const label = labelStrategyConfig(config);
    expect(label).toBe('Gen: 4.1-mini | Judge: 4.1-nano | 5 iters');
  });

  it('includes budget when set', () => {
    const config: V2StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 5,
      budgetUsd: 2.5,
    };
    const label = labelStrategyConfig(config);
    expect(label).toContain('Budget: $2.50');
  });

  it('shortens deepseek models', () => {
    const config: V2StrategyConfig = {
      generationModel: 'deepseek-chat',
      judgeModel: 'gpt-4.1-nano',
      iterations: 3,
    };
    const label = labelStrategyConfig(config);
    expect(label).toContain('Gen: ds-chat');
  });

  it('shortens claude models', () => {
    const config: V2StrategyConfig = {
      generationModel: 'claude-3.5-sonnet',
      judgeModel: 'gpt-4.1-nano',
      iterations: 3,
    };
    const label = labelStrategyConfig(config);
    expect(label).toContain('Gen: cl-3.5-sonnet');
  });
});
