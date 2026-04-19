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

  /** Build iterationConfigs from a legacy iteration count (generate/swiss pairs). */
  function buildIterationConfigs(count: number): Array<{ agentType: 'generate' | 'swiss'; budgetPercent: number }> {
    const configs: Array<{ agentType: 'generate' | 'swiss'; budgetPercent: number }> = [];
    const totalSlots = count * 2;
    const perSlot = Math.floor(100 / totalSlots);
    let rem = 100 - perSlot * totalSlots;
    for (let i = 0; i < count; i++) {
      const genExtra = rem > 0 ? 1 : 0; if (rem > 0) rem--;
      configs.push({ agentType: 'generate', budgetPercent: perSlot + genExtra });
      const swissExtra = rem > 0 ? 1 : 0; if (rem > 0) rem--;
      configs.push({ agentType: 'swiss', budgetPercent: perSlot + swissExtra });
    }
    return configs;
  }

  function extractConfig(config: Record<string, unknown> | null) {
    const c = config ?? {};
    const iterationCount = (c.maxIterations as number) ?? 5;
    return {
      generationModel: (c.generationModel as string) ?? 'gpt-4.1-mini',
      judgeModel: (c.judgeModel as string) ?? 'gpt-4.1-nano',
      iterationConfigs: buildIterationConfigs(iterationCount),
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
      iterationConfigs: buildIterationConfigs(10),
    });
  });

  it('uses defaults for empty config', () => {
    const result = extractConfig({});
    expect(result).toEqual({
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: buildIterationConfigs(5),
    });
  });

  it('uses defaults for null config', () => {
    const result = extractConfig(null);
    expect(result).toEqual({
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: buildIterationConfigs(5),
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
      iterationConfigs: buildIterationConfigs(3),
    });
  });

  it('duplicate configs produce same hash (deduplication)', () => {
    const ic = buildIterationConfigs(5);
    const config1 = { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterationConfigs: ic };
    const config2 = { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterationConfigs: ic };
    expect(hashStrategyConfig(config1)).toBe(hashStrategyConfig(config2));
  });

  it('different configs produce different hashes', () => {
    const ic = buildIterationConfigs(5);
    const config1 = { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterationConfigs: ic };
    const config2 = { generationModel: 'gpt-4.1', judgeModel: 'gpt-4.1-nano', iterationConfigs: ic };
    expect(hashStrategyConfig(config1)).not.toBe(hashStrategyConfig(config2));
  });
});
