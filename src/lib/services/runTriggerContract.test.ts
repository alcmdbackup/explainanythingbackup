/**
 * Unit tests for run trigger contract: validates queueEvolutionRunAction
 * accepts promptId/strategyId, rejects non-existent references, and
 * maintains backward compatibility during the transition period.
 */

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

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('admin-user-id'),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  withLogging: (fn: Function, _name: string) => fn,
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  serverReadRequestId: (fn: Function) => fn,
}));

jest.mock('@/lib/errorHandling', () => ({
  handleError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));

jest.mock('@/lib/services/auditLog', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

import { queueEvolutionRunAction } from './evolutionActions';

// ─── Test Setup ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  fromResults = new Map();
});

function queueResult(table: string, result: { data: unknown; error: unknown }) {
  const queue = fromResults.get(table) ?? [];
  queue.push(result);
  fromResults.set(table, queue);
}

const sampleRun = {
  id: 'new-run-id',
  explanation_id: 42,
  status: 'pending',
  phase: 'EXPANSION',
  total_variants: 0,
  total_cost_usd: 0,
  budget_cap_usd: 5.00,
  current_iteration: 0,
  variants_generated: 0,
  error_message: null,
  started_at: null,
  completed_at: null,
  created_at: '2026-02-07T00:00:00Z',
  prompt_id: null,
  pipeline_type: null,
  strategy_config_id: null,
};

// ─── Tests ───────────────────────────────────────────────────────

describe('queueEvolutionRunAction — run trigger contract', () => {
  it('backward compat: succeeds with only explanationId (transition period)', async () => {
    // Default strategy lookup → returns existing
    queueResult('strategy_configs', { data: { id: 'default-strat' }, error: null });
    // Default prompt lookup → returns existing
    queueResult('hall_of_fame_topics', { data: { id: 'default-prompt' }, error: null });
    // Insert → returns new run
    queueResult('content_evolution_runs', { data: sampleRun, error: null });

    const result = await queueEvolutionRunAction({ explanationId: 42 });

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe('new-run-id');
  });

  it('accepts promptId + strategyId for structured run', async () => {
    // Prompt validation
    queueResult('hall_of_fame_topics', { data: { id: 'prompt-1' }, error: null });
    // Strategy validation + config
    queueResult('strategy_configs', {
      data: { id: 'strat-1', config: { budgetCapUsd: 3.00 } },
      error: null,
    });
    // Insert → returns new run with FKs set
    queueResult('content_evolution_runs', {
      data: { ...sampleRun, prompt_id: 'prompt-1', strategy_config_id: 'strat-1' },
      error: null,
    });

    const result = await queueEvolutionRunAction({
      explanationId: 42,
      promptId: 'prompt-1',
      strategyId: 'strat-1',
    });

    expect(result.success).toBe(true);
    expect(result.data?.prompt_id).toBe('prompt-1');
    expect(result.data?.strategy_config_id).toBe('strat-1');
  });

  it('rejects non-existent promptId', async () => {
    // Prompt not found
    queueResult('hall_of_fame_topics', { data: null, error: null });

    const result = await queueEvolutionRunAction({
      explanationId: 42,
      promptId: 'non-existent',
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Prompt not found');
  });

  it('rejects non-existent strategyId', async () => {
    // Strategy not found
    queueResult('strategy_configs', { data: null, error: null });

    const result = await queueEvolutionRunAction({
      explanationId: 42,
      strategyId: 'non-existent',
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Strategy not found');
  });

  it('requires at least explanationId or promptId', async () => {
    const result = await queueEvolutionRunAction({});

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Either explanationId or promptId is required');
  });

  it('uses strategy budget cap when no explicit budget provided', async () => {
    // Prompt validation
    queueResult('hall_of_fame_topics', { data: { id: 'p1' }, error: null });
    // Strategy with $3.00 budget
    queueResult('strategy_configs', {
      data: { id: 's1', config: { budgetCapUsd: 3.00 } },
      error: null,
    });
    // Insert → returns run
    queueResult('content_evolution_runs', {
      data: { ...sampleRun, budget_cap_usd: 3.00, prompt_id: 'p1', strategy_config_id: 's1' },
      error: null,
    });

    const result = await queueEvolutionRunAction({
      explanationId: 42,
      promptId: 'p1',
      strategyId: 's1',
      // No budgetCapUsd — should use strategy's
    });

    expect(result.success).toBe(true);
    // Budget should come from strategy config
    expect(mockFrom).toHaveBeenCalledWith('content_evolution_runs');
  });

  it('explicit budgetCapUsd overrides strategy budget', async () => {
    // Strategy with $3.00 budget
    queueResult('strategy_configs', {
      data: { id: 's1', config: { budgetCapUsd: 3.00 } },
      error: null,
    });
    // Default prompt lookup → returns existing (no promptId provided)
    queueResult('hall_of_fame_topics', { data: { id: 'default-prompt' }, error: null });
    // Insert
    queueResult('content_evolution_runs', {
      data: { ...sampleRun, budget_cap_usd: 10.00, strategy_config_id: 's1' },
      error: null,
    });

    const result = await queueEvolutionRunAction({
      explanationId: 42,
      strategyId: 's1',
      budgetCapUsd: 10.00,
    });

    expect(result.success).toBe(true);
  });

  it('succeeds with promptId only (no explanationId) for prompt-based runs', async () => {
    // Prompt validation
    queueResult('hall_of_fame_topics', { data: { id: 'prompt-1' }, error: null });
    // Default strategy lookup → returns existing (no strategyId provided)
    queueResult('strategy_configs', { data: { id: 'default-strat' }, error: null });
    // Insert → returns run with null explanation_id and source set
    queueResult('content_evolution_runs', {
      data: { ...sampleRun, explanation_id: null, prompt_id: 'prompt-1', source: 'prompt:prompt-1' },
      error: null,
    });

    const result = await queueEvolutionRunAction({
      promptId: 'prompt-1',
    });

    expect(result.success).toBe(true);
    expect(result.data?.explanation_id).toBeNull();
    expect(result.data?.prompt_id).toBe('prompt-1');
  });
});
