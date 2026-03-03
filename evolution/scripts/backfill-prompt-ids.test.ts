/**
 * Unit tests for backfill-prompt-ids script.
 * Verifies idempotent backfill for both prompt_id and strategy_config_id.
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

const mockSupabase = { from: (...args: unknown[]) => mockFrom(...args) };

import { backfillPromptIds, backfillStrategyConfigIds, drainStaleRuns } from './backfill-prompt-ids';

// ─── Helpers ─────────────────────────────────────────────────────

function queueResult(table: string, result: { data: unknown; error: unknown }) {
  const queue = fromResults.get(table) ?? [];
  queue.push(result);
  fromResults.set(table, queue);
}

beforeEach(() => {
  jest.clearAllMocks();
  fromResults = new Map();
});

// ─── backfillPromptIds Tests ────────────────────────────────────

describe('backfillPromptIds', () => {
  it('returns zero counts when no runs need backfill', async () => {
    queueResult('evolution_runs', { data: [], error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillPromptIds(mockSupabase as any);

    expect(result).toEqual({ linked: 0, unlinked: 0 });
  });

  it('links via bank entry topic_id (strategy 1)', async () => {
    // Runs with null prompt_id
    queueResult('evolution_runs', {
      data: [{ id: 'run-1', explanation_id: 1 }],
      error: null,
    });
    // Bank entry lookup → found
    queueResult('evolution_arena_entries', {
      data: { topic_id: 'topic-abc' },
      error: null,
    });
    // Update prompt_id
    queueResult('evolution_runs', { data: null, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillPromptIds(mockSupabase as any);

    expect(result).toEqual({ linked: 1, unlinked: 0 });
    expect(mockFrom).toHaveBeenCalledWith('evolution_arena_entries');
  });

  it('links via explanation title (strategy 2) when bank entry not found', async () => {
    queueResult('evolution_runs', {
      data: [{ id: 'run-2', explanation_id: 42 }],
      error: null,
    });
    // Bank entry → not found
    queueResult('evolution_arena_entries', { data: null, error: null });
    // Explanation → title found
    queueResult('explanations', {
      data: { explanation_title: 'Explain gravity' },
      error: null,
    });
    // Topic match
    queueResult('evolution_arena_topics', { data: { id: 'topic-grav' }, error: null });
    // Update prompt_id
    queueResult('evolution_runs', { data: null, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillPromptIds(mockSupabase as any);

    expect(result).toEqual({ linked: 1, unlinked: 0 });
  });

  it('assigns legacy prompt when no match found', async () => {
    queueResult('evolution_runs', {
      data: [{ id: 'run-3', explanation_id: null }],
      error: null,
    });
    // Bank entry → not found
    queueResult('evolution_arena_entries', { data: null, error: null });
    // getOrCreateLegacyPrompt: find existing → found
    queueResult('evolution_arena_topics', { data: { id: 'legacy-prompt' }, error: null });
    // Update run with legacy prompt
    queueResult('evolution_runs', { data: null, error: null });

    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillPromptIds(mockSupabase as any);

    expect(result).toEqual({ linked: 1, unlinked: 0 });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('legacy prompt'));
    logSpy.mockRestore();
  });

  it('throws on DB error fetching runs', async () => {
    queueResult('evolution_runs', { data: null, error: { message: 'DB down' } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(backfillPromptIds(mockSupabase as any)).rejects.toThrow('Failed to fetch runs');
  });

  it('returns zero counts when evolution_runs table does not exist', async () => {
    queueResult('evolution_runs', {
      data: null,
      error: { message: "Could not find the table 'public.evolution_runs' in the schema cache" },
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillPromptIds(mockSupabase as any);

    expect(result).toEqual({ linked: 0, unlinked: 0 });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not ready'));
    logSpy.mockRestore();
  });

  it('returns zero counts when a queried column does not exist', async () => {
    queueResult('evolution_runs', {
      data: null,
      error: { message: 'column evolution_runs.prompt_id does not exist' },
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillPromptIds(mockSupabase as any);

    expect(result).toEqual({ linked: 0, unlinked: 0 });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not ready'));
    logSpy.mockRestore();
  });

  it('is idempotent — re-running on already linked runs returns zero', async () => {
    // No runs with null prompt_id
    queueResult('evolution_runs', { data: [], error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillPromptIds(mockSupabase as any);

    expect(result).toEqual({ linked: 0, unlinked: 0 });
  });
});

// ─── backfillStrategyConfigIds Tests ────────────────────────────

describe('backfillStrategyConfigIds', () => {
  const validConfig = {
    generationModel: 'gpt-4.1-mini',
    judgeModel: 'gpt-4.1-nano',
    iterations: 3,
    budgetCaps: { generation: 0.30, tournament: 0.40 },
  };

  it('returns zero counts when no runs need backfill', async () => {
    queueResult('evolution_runs', { data: [], error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillStrategyConfigIds(mockSupabase as any);

    expect(result).toEqual({ linked: 0, created: 0, unlinked: 0 });
  });

  it('links to existing strategy when hash matches', async () => {
    queueResult('evolution_runs', {
      data: [{ id: 'run-s1', config: validConfig }],
      error: null,
    });
    // Existing strategy found by hash
    queueResult('evolution_strategy_configs', { data: { id: 'strat-existing' }, error: null });
    // Update run
    queueResult('evolution_runs', { data: null, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillStrategyConfigIds(mockSupabase as any);

    expect(result).toEqual({ linked: 1, created: 0, unlinked: 0 });
  });

  it('creates new strategy when no hash match', async () => {
    queueResult('evolution_runs', {
      data: [{ id: 'run-s2', config: validConfig }],
      error: null,
    });
    // No existing strategy
    queueResult('evolution_strategy_configs', { data: null, error: null });
    // Insert new strategy
    queueResult('evolution_strategy_configs', { data: { id: 'strat-new' }, error: null });
    // Update run
    queueResult('evolution_runs', { data: null, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillStrategyConfigIds(mockSupabase as any);

    expect(result).toEqual({ linked: 0, created: 1, unlinked: 0 });
  });

  it('assigns legacy strategy to runs with missing config fields', async () => {
    queueResult('evolution_runs', {
      data: [{ id: 'run-s3', config: { generationModel: 'gpt-4.1-mini' } }],
      error: null,
    });
    // getOrCreateLegacyStrategy: find existing → found
    queueResult('evolution_strategy_configs', { data: { id: 'legacy-strat' }, error: null });
    // Update run with legacy strategy
    queueResult('evolution_runs', { data: null, error: null });

    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillStrategyConfigIds(mockSupabase as any);

    expect(result).toEqual({ linked: 1, created: 0, unlinked: 0 });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('legacy strategy'));
    logSpy.mockRestore();
  });

  it('throws on DB error fetching runs', async () => {
    queueResult('evolution_runs', { data: null, error: { message: 'DB down' } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(backfillStrategyConfigIds(mockSupabase as any)).rejects.toThrow('Failed to fetch runs');
  });

  it('returns zero counts when evolution_runs table does not exist', async () => {
    queueResult('evolution_runs', {
      data: null,
      error: { message: "Could not find the table 'public.evolution_runs' in the schema cache" },
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillStrategyConfigIds(mockSupabase as any);

    expect(result).toEqual({ linked: 0, created: 0, unlinked: 0 });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not ready'));
    logSpy.mockRestore();
  });

  it('returns zero counts when a queried column does not exist', async () => {
    queueResult('evolution_runs', {
      data: null,
      error: { message: 'column evolution_runs.experiment_id does not exist' },
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillStrategyConfigIds(mockSupabase as any);

    expect(result).toEqual({ linked: 0, created: 0, unlinked: 0 });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not ready'));
    logSpy.mockRestore();
  });
});

// ─── drainStaleRuns Tests ───────────────────────────────────────

describe('drainStaleRuns', () => {
  it('marks stale runs as failed and returns count', async () => {
    queueResult('evolution_runs', {
      data: [{ id: 'run-stale-1' }, { id: 'run-stale-2' }],
      error: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await drainStaleRuns(mockSupabase as any);

    expect(result).toEqual({ drained: 2 });
  });

  it('returns zero when no stale runs exist', async () => {
    queueResult('evolution_runs', { data: [], error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await drainStaleRuns(mockSupabase as any);

    expect(result).toEqual({ drained: 0 });
  });

  it('returns zero when evolution_runs table does not exist', async () => {
    queueResult('evolution_runs', {
      data: null,
      error: { message: "Could not find the table 'public.evolution_runs' in the schema cache" },
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await drainStaleRuns(mockSupabase as any);

    expect(result).toEqual({ drained: 0 });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not ready'));
    logSpy.mockRestore();
  });
});
