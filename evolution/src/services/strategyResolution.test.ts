// Unit tests for strategyResolution: atomic find-or-create strategy config.
// Uses Proxy-based chain pattern from strategyRegistryActions.test.ts.

// ─── Supabase Mock ───────────────────────────────────────────────

function createQueryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  const handler: ProxyHandler<Record<string, jest.Mock>> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (val: unknown) => void) => resolve(result);
      }
      if (!chain[prop as string]) {
        chain[prop as string] = jest.fn().mockReturnValue(new Proxy(chain, handler));
      }
      return chain[prop as string];
    },
  };
  return new Proxy(chain, handler);
}

let fromResults: Map<string, Array<{ data: unknown; error: unknown }>>;

const mockFrom = jest.fn().mockImplementation((table: string) => {
  const queue = fromResults.get(table) ?? [];
  const result = queue.shift() ?? { data: null, error: null };
  return createQueryChain(result);
});

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({ from: (...args: unknown[]) => mockFrom(...args) }),
}));

import { resolveOrCreateStrategy, resolveOrCreateStrategyFromRunConfig } from './strategyResolution';
import type { StrategyConfig } from '@evolution/lib/core/strategyConfig';

// ─── Helpers ─────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  fromResults = new Map();
});

function queueResult(table: string, result: { data: unknown; error: unknown }) {
  const queue = fromResults.get(table) ?? [];
  queue.push(result);
  fromResults.set(table, queue);
}

const sampleConfig: StrategyConfig = {
  generationModel: 'deepseek-chat',
  judgeModel: 'gpt-4.1-nano',
  iterations: 3,
  budgetCaps: { generation: 0.30, calibration: 0.30, tournament: 0.40 },
};

// ─── Tests ───────────────────────────────────────────────────────

describe('resolveOrCreateStrategy', () => {
  it('creates new strategy when INSERT succeeds', async () => {
    queueResult('evolution_strategy_configs', { data: { id: 'new-strat' }, error: null });

    const result = await resolveOrCreateStrategy({
      config: sampleConfig,
      createdBy: 'experiment',
    });

    expect(result.id).toBe('new-strat');
    expect(result.isNew).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('evolution_strategy_configs');
  });

  it('returns existing strategy when INSERT fails with constraint violation', async () => {
    // INSERT fails (unique constraint)
    queueResult('evolution_strategy_configs', { data: null, error: { message: 'duplicate key value' } });
    // Fallback SELECT finds existing
    queueResult('evolution_strategy_configs', { data: { id: 'existing-strat' }, error: null });

    const result = await resolveOrCreateStrategy({
      config: sampleConfig,
      createdBy: 'experiment',
    });

    expect(result.id).toBe('existing-strat');
    expect(result.isNew).toBe(false);
  });

  it('throws when both INSERT and SELECT fail', async () => {
    // INSERT fails
    queueResult('evolution_strategy_configs', { data: null, error: { message: 'DB error' } });
    // SELECT also fails
    queueResult('evolution_strategy_configs', { data: null, error: { message: 'not found' } });

    await expect(
      resolveOrCreateStrategy({ config: sampleConfig, createdBy: 'system' }),
    ).rejects.toThrow('Failed to resolve strategy config');
  });

  it('uses custom name when provided', async () => {
    queueResult('evolution_strategy_configs', { data: { id: 'named-strat' }, error: null });

    const result = await resolveOrCreateStrategy({
      config: sampleConfig,
      createdBy: 'admin',
      customName: 'My Custom Strategy',
    });

    expect(result.id).toBe('named-strat');
    expect(result.isNew).toBe(true);
  });

  it('normalizes enabledAgents before hashing', async () => {
    queueResult('evolution_strategy_configs', { data: { id: 'norm-strat' }, error: null });

    // Pass unsorted enabledAgents — should be normalized internally
    const configWithAgents: StrategyConfig = {
      ...sampleConfig,
      enabledAgents: ['debate', 'reflection', 'evolution'],
    };

    const result = await resolveOrCreateStrategy({
      config: configWithAgents,
      createdBy: 'experiment',
    });

    expect(result.id).toBe('norm-strat');
  });

  it('treats empty enabledAgents as undefined (normalization)', async () => {
    queueResult('evolution_strategy_configs', { data: { id: 'empty-agents' }, error: null });

    const configWithEmpty: StrategyConfig = {
      ...sampleConfig,
      enabledAgents: [],
    };

    const result = await resolveOrCreateStrategy({
      config: configWithEmpty,
      createdBy: 'batch',
    });

    expect(result.id).toBe('empty-agents');
  });

  it('accepts provided supabase client', async () => {
    const mockSb = { from: mockFrom } as any;
    queueResult('evolution_strategy_configs', { data: { id: 'with-sb' }, error: null });

    const result = await resolveOrCreateStrategy(
      { config: sampleConfig, createdBy: 'system' },
      mockSb,
    );

    expect(result.id).toBe('with-sb');
  });
});

describe('resolveOrCreateStrategyFromRunConfig', () => {
  it('extracts config from run config and resolves strategy', async () => {
    queueResult('evolution_strategy_configs', { data: { id: 'from-run' }, error: null });

    const result = await resolveOrCreateStrategyFromRunConfig({
      runConfig: {
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 3,
      },
      defaultBudgetCaps: { generation: 0.30, calibration: 0.30, tournament: 0.40 },
      createdBy: 'experiment',
    });

    expect(result.id).toBe('from-run');
    expect(result.isNew).toBe(true);
  });

  it('uses defaults for missing run config fields', async () => {
    queueResult('evolution_strategy_configs', { data: { id: 'defaults' }, error: null });

    const result = await resolveOrCreateStrategyFromRunConfig({
      runConfig: {},
      defaultBudgetCaps: { generation: 0.25, calibration: 0.25, tournament: 0.25, evolution: 0.25 },
      createdBy: 'batch',
    });

    expect(result.id).toBe('defaults');
    expect(result.isNew).toBe(true);
  });
});
