// Tests for the backfill-strategy-config-id script logic.
// Validates config extraction, default handling, and deduplication.

import { upsertStrategy } from '../src/lib/pipeline/setup/findOrCreateStrategy';
import { hashStrategyConfig } from '../src/lib/pipeline/setup/findOrCreateStrategy';

// Mock upsertStrategy
jest.mock('../src/lib/pipeline/setup/findOrCreateStrategy', () => {
  const actual = jest.requireActual('../src/lib/pipeline/setup/findOrCreateStrategy');
  return {
    ...actual,
    upsertStrategy: jest.fn().mockResolvedValue('strat-mock-id'),
  };
});

const mockUpsertStrategy = upsertStrategy as jest.MockedFunction<typeof upsertStrategy>;

describe('backfill config extraction logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsertStrategy.mockResolvedValue('strat-mock-id');
  });

  function extractConfig(config: Record<string, unknown> | null) {
    const c = config ?? {};
    return {
      generationModel: (c.generationModel as string) ?? 'gpt-4.1-mini',
      judgeModel: (c.judgeModel as string) ?? 'gpt-4.1-nano',
      iterations: (c.maxIterations as number) ?? 5,
    };
  }

  it('extracts V2 fields from full config', () => {
    const result = extractConfig({
      generationModel: 'gpt-4.1',
      judgeModel: 'gpt-4.1-mini',
      maxIterations: 10,
      enabledAgents: ['reflection'],
      singleArticle: true,
    });
    expect(result).toEqual({
      generationModel: 'gpt-4.1',
      judgeModel: 'gpt-4.1-mini',
      iterations: 10,
    });
  });

  it('uses defaults for empty config', () => {
    const result = extractConfig({});
    expect(result).toEqual({
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 5,
    });
  });

  it('uses defaults for null config', () => {
    const result = extractConfig(null);
    expect(result).toEqual({
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 5,
    });
  });

  it('ignores V1-only fields (enabledAgents, expansion, etc.)', () => {
    const result = extractConfig({
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      maxIterations: 3,
      enabledAgents: ['reflection', 'debate'],
      singleArticle: true,
      expansion: { minPool: 5 },
    });
    expect(result).toEqual({
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 3,
    });
  });

  it('duplicate configs produce same hash (deduplication)', () => {
    const config1 = { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 5 };
    const config2 = { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 5 };
    expect(hashStrategyConfig(config1)).toBe(hashStrategyConfig(config2));
  });

  it('different configs produce different hashes', () => {
    const config1 = { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 5 };
    const config2 = { generationModel: 'gpt-4.1', judgeModel: 'gpt-4.1-nano', iterations: 5 };
    expect(hashStrategyConfig(config1)).not.toBe(hashStrategyConfig(config2));
  });
});
