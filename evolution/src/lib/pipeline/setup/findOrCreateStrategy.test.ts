// Tests for V2 forked strategy config utilities.

import { hashStrategyConfig, labelStrategyConfig, upsertStrategy } from './findOrCreateStrategy';
import type { StrategyConfig } from '../infra/types';

describe('V2 hashStrategyConfig', () => {
  const baseConfig: StrategyConfig = {
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
    const withExtras: StrategyConfig = {
      ...baseConfig,
      strategiesPerRound: 2,
      budgetUsd: 5.0,
    };
    expect(hashStrategyConfig(withExtras)).toBe(hashStrategyConfig(baseConfig));
  });

  it('changes hash when core fields differ', () => {
    const different: StrategyConfig = { ...baseConfig, iterations: 10 };
    expect(hashStrategyConfig(different)).not.toBe(hashStrategyConfig(baseConfig));
  });
});

describe('V2 labelStrategyConfig', () => {
  it('produces correct format', () => {
    const config: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 5,
    };
    const label = labelStrategyConfig(config);
    expect(label).toBe('Gen: 4.1-mini | Judge: 4.1-nano | 5 iters');
  });

  it('includes budget when set', () => {
    const config: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 5,
      budgetUsd: 2.5,
    };
    const label = labelStrategyConfig(config);
    expect(label).toContain('Budget: $2.50');
  });

  it('shortens deepseek models', () => {
    const config: StrategyConfig = {
      generationModel: 'deepseek-chat',
      judgeModel: 'gpt-4.1-nano',
      iterations: 3,
    };
    const label = labelStrategyConfig(config);
    expect(label).toContain('Gen: ds-chat');
  });

  it('shortens claude models', () => {
    const config: StrategyConfig = {
      generationModel: 'claude-3.5-sonnet',
      judgeModel: 'gpt-4.1-nano',
      iterations: 3,
    };
    const label = labelStrategyConfig(config);
    expect(label).toContain('Gen: cl-3.5-sonnet');
  });
});

describe('V2 upsertStrategy', () => {
  const baseConfig: StrategyConfig = {
    generationModel: 'gpt-4.1-mini',
    judgeModel: 'gpt-4.1-nano',
    iterations: 5,
  };

  it('throws on DB error (does not return null)', async () => {
    const fakeDb = {
      from: () => ({
        upsert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: { message: 'connection refused', code: '08006' },
              }),
          }),
        }),
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(upsertStrategy(fakeDb, baseConfig)).rejects.toThrow(
      'Strategy upsert failed: connection refused',
    );
  });

  it('throws when upsert returns no ID', async () => {
    const fakeDb = {
      from: () => ({
        upsert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({ data: {}, error: null }),
          }),
        }),
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(upsertStrategy(fakeDb, baseConfig)).rejects.toThrow(
      'Strategy upsert returned no ID',
    );
  });
});
