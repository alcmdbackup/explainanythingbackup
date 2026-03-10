// Unit tests for Arena integration functions extracted from pipeline.ts.
// Tests findTopicByPrompt, linkPromptToRun, autoLinkPrompt, syncToArena, and loadArenaEntries.

import { findTopicByPrompt, linkPromptToRun, autoLinkPrompt, syncToArena, loadArenaEntries } from './arenaIntegration';
import { EVOLUTION_SYSTEM_USERID } from './llmClient';
import { PipelineStateImpl } from './state';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';

// --- Supabase mock: thenable chain supporting from().select().eq().ilike().is().single(), etc. ---

function createMockChain() {
  const chain: Record<string, jest.Mock> = {};
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.in = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.single = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.update = jest.fn().mockReturnValue(chain);
  chain.upsert = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.select = jest.fn().mockReturnValue(chain);
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.ilike = jest.fn().mockReturnValue(chain);
  chain.is = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.rpc = jest.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

let mockChain: ReturnType<typeof createMockChain>;

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(() => {
    if (!mockChain) mockChain = createMockChain();
    return Promise.resolve(mockChain);
  }),
}));

// Mock arenaActions for the auto re-rank dynamic import
jest.mock('@evolution/services/arenaActions', () => ({
  runArenaComparisonInternal: jest.fn().mockResolvedValue({ success: true, data: { compared: 1 } }),
}));

jest.mock('../../../../instrumentation', () => ({
  createAppSpan: jest.fn().mockReturnValue({
    end: jest.fn(), setAttributes: jest.fn(), recordException: jest.fn(), setStatus: jest.fn(),
  }),
}));

// --- Helpers ---

function makeMockLogger(): EvolutionLogger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeMockCostTracker(): CostTracker {
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn(),
    getAgentCost: jest.fn().mockReturnValue(0),
    getTotalSpent: jest.fn().mockReturnValue(1.5),
    getAvailableBudget: jest.fn().mockReturnValue(3.5),
    getAllAgentCosts: jest.fn().mockReturnValue({}),
    getTotalReserved: jest.fn().mockReturnValue(0),
    getInvocationCost: jest.fn().mockReturnValue(0),
    releaseReservation: jest.fn(),
    setEventLogger: jest.fn(),
    isOverflowed: false,
  };
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const state = new PipelineStateImpl('Original article text');
  state.addToPool({
    id: 'v1', text: 'Variant 1', version: 1, parentIds: [],
    strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 0,
  });
  state.addToPool({
    id: 'v2', text: 'Variant 2', version: 1, parentIds: [],
    strategy: 'lexical_simplify', createdAt: Date.now() / 1000, iterationBorn: 0,
  });
  state.addToPool({
    id: 'v3', text: 'Variant 3', version: 1, parentIds: [],
    strategy: 'grounding_enhance', createdAt: Date.now() / 1000, iterationBorn: 0,
  });

  return {
    payload: {
      originalText: state.originalText,
      title: 'Test Article',
      explanationId: 42,
      runId: 'test-run',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    },
    state,
    llmClient: { complete: jest.fn(), completeStructured: jest.fn() } as unknown as EvolutionLLMClient,
    logger: makeMockLogger(),
    costTracker: makeMockCostTracker(),
    runId: 'test-run',
    ...overrides,
  };
}

// --- Tests ---

describe('EVOLUTION_SYSTEM_USERID', () => {
  it('is exported as a valid UUID v4', () => {
    expect(EVOLUTION_SYSTEM_USERID).toBe('00000000-0000-4000-8000-000000000001');
    expect(EVOLUTION_SYSTEM_USERID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('findTopicByPrompt', () => {
  beforeEach(() => {
    mockChain = createMockChain();
  });

  it('returns topic ID when match found', async () => {
    mockChain.single.mockResolvedValue({ data: { id: 'topic-123' }, error: null });

    const result = await findTopicByPrompt(mockChain as never, 'test prompt');
    expect(result).toBe('topic-123');
    expect(mockChain.from).toHaveBeenCalledWith('evolution_arena_topics');
    expect(mockChain.ilike).toHaveBeenCalledWith('prompt', 'test prompt');
    expect(mockChain.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('returns null when no match found', async () => {
    mockChain.single.mockResolvedValue({ data: null, error: null });

    const result = await findTopicByPrompt(mockChain as never, 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('linkPromptToRun', () => {
  beforeEach(() => {
    mockChain = createMockChain();
  });

  it('updates evolution_runs with prompt_id', async () => {
    await linkPromptToRun(mockChain as never, 'run-1', 'topic-abc');

    expect(mockChain.from).toHaveBeenCalledWith('evolution_runs');
    expect(mockChain.update).toHaveBeenCalledWith({ prompt_id: 'topic-abc' });
    expect(mockChain.eq).toHaveBeenCalledWith('id', 'run-1');
  });
});

describe('autoLinkPrompt', () => {
  beforeEach(() => {
    mockChain = createMockChain();
  });

  it('returns early when prompt_id is already set', async () => {
    mockChain.single.mockResolvedValue({ data: { prompt_id: 'existing-topic' }, error: null });

    const ctx = makeCtx();
    const logger = makeMockLogger();

    await autoLinkPrompt('run-1', ctx, logger);
    // Should not try to update since prompt_id is already set
    expect(mockChain.update).not.toHaveBeenCalled();
  });

  it('auto-links via config prompt when prompt_id is null', async () => {
    // First call: run query returns null prompt_id with config containing prompt
    // Second call: findTopicByPrompt returns topic ID
    let singleCallCount = 0;
    mockChain.single.mockImplementation(() => {
      singleCallCount++;
      if (singleCallCount === 1) {
        return Promise.resolve({
          data: { prompt_id: null, config: { prompt: 'test topic' } },
          error: null,
        });
      }
      // findTopicByPrompt call
      return Promise.resolve({ data: { id: 'found-topic' }, error: null });
    });

    const ctx = makeCtx();
    const logger = makeMockLogger();

    await autoLinkPrompt('run-1', ctx, logger);

    expect(logger.info).toHaveBeenCalledWith(
      'Auto-linked prompt via config JSONB',
      expect.objectContaining({ runId: 'run-1', promptId: 'found-topic' }),
    );
  });

  it('logs warning when no match found', async () => {
    mockChain.single.mockResolvedValue({ data: { prompt_id: null, config: {} }, error: null });

    const ctx = makeCtx({ payload: { originalText: 'text', title: 'T', explanationId: undefined as never, runId: 'run-1', config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig } });
    const logger = makeMockLogger();

    await autoLinkPrompt('run-1', ctx, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      'Could not auto-link prompt_id (no match found)',
      expect.objectContaining({ runId: 'run-1' }),
    );
  });

  it('handles errors non-fatally', async () => {
    mockChain.single.mockRejectedValue(new Error('DB down'));

    const ctx = makeCtx();
    const logger = makeMockLogger();

    // Should not throw
    await autoLinkPrompt('run-1', ctx, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      'Auto-link prompt failed (non-fatal)',
      expect.objectContaining({ runId: 'run-1' }),
    );
  });
});

describe('syncToArena', () => {
  beforeEach(() => {
    mockChain = createMockChain();
  });

  it('calls sync_to_arena RPC with new variants and elo rows', async () => {
    mockChain.single.mockResolvedValue({ data: { prompt_id: 'topic-1' }, error: null });
    mockChain.rpc.mockResolvedValue({ data: { entries_inserted: 3, matches_inserted: 0, elos_upserted: 3 }, error: null });

    const ctx = makeCtx();
    const logger = makeMockLogger();

    await syncToArena('run-1', ctx, logger);

    expect(mockChain.rpc).toHaveBeenCalledWith('sync_to_arena', expect.objectContaining({
      p_topic_id: 'topic-1',
      p_run_id: 'run-1',
    }));
    expect(logger.info).toHaveBeenCalledWith(
      'Arena synced',
      expect.objectContaining({ runId: 'run-1', topicId: 'topic-1' }),
    );
  });

  it('uses pre-resolved arenaTopicId from context', async () => {
    mockChain.rpc.mockResolvedValue({ data: { entries_inserted: 3 }, error: null });

    const ctx = makeCtx();
    ctx.arenaTopicId = 'pre-resolved-topic';
    const logger = makeMockLogger();

    await syncToArena('run-1', ctx, logger);

    expect(mockChain.rpc).toHaveBeenCalledWith('sync_to_arena', expect.objectContaining({
      p_topic_id: 'pre-resolved-topic',
    }));
  });

  it('logs info and returns when pool has no new variants', async () => {
    const state = new PipelineStateImpl('empty');
    const ctx = makeCtx({
      payload: { originalText: 'empty', title: 'T', explanationId: 1, runId: 'run-empty', config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig },
      state,
    });
    const logger = makeMockLogger();

    await syncToArena('run-empty', ctx, logger);

    expect(logger.info).toHaveBeenCalledWith(
      'No new variants to sync to Arena',
      expect.objectContaining({ runId: 'run-empty' }),
    );
  });

  it('logs warning when no topic can be resolved', async () => {
    mockChain.single.mockResolvedValue({ data: { prompt_id: null }, error: null });

    const ctx = makeCtx({
      payload: { originalText: 'text', title: 'T', explanationId: undefined as never, runId: 'run-no-topic', config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig },
    });
    const logger = makeMockLogger();

    await syncToArena('run-no-topic', ctx, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      'Cannot sync to Arena — no topic resolved',
      expect.objectContaining({ runId: 'run-no-topic' }),
    );
  });

  it('handles RPC errors non-fatally', async () => {
    mockChain.single.mockResolvedValue({ data: { prompt_id: 'topic-1' }, error: null });
    mockChain.rpc.mockResolvedValue({ data: null, error: { message: 'RPC timeout' } });

    const ctx = makeCtx();
    const logger = makeMockLogger();

    await syncToArena('run-1', ctx, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      'sync_to_arena RPC failed (non-fatal)',
      expect.objectContaining({ runId: 'run-1', error: 'RPC timeout' }),
    );
  });

  it('handles top-level errors non-fatally', async () => {
    mockChain.single.mockRejectedValue(new Error('Connection lost'));

    const ctx = makeCtx();
    const logger = makeMockLogger();

    await syncToArena('run-1', ctx, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      'syncToArena failed (non-fatal)',
      expect.objectContaining({ runId: 'run-1' }),
    );
  });

  it('excludes fromArena entries from new variant list', async () => {
    mockChain.single.mockResolvedValue({ data: { prompt_id: 'topic-1' }, error: null });
    mockChain.rpc.mockResolvedValue({ data: { entries_inserted: 3 }, error: null });

    const ctx = makeCtx();
    // Mark v1 as an Arena-loaded entry
    const v1 = ctx.state.pool.find((v) => v.id === 'v1');
    if (v1) v1.fromArena = true;

    const logger = makeMockLogger();
    await syncToArena('run-1', ctx, logger);

    // The RPC should have been called with entries excluding v1
    const rpcCall = mockChain.rpc.mock.calls[0];
    const entries = rpcCall[1].p_entries as Array<{ id: string }>;
    expect(entries.map((e) => e.id)).not.toContain('v1');
    expect(entries.length).toBe(2); // v2 and v3 only
  });
});

describe('loadArenaEntries', () => {
  beforeEach(() => {
    mockChain = createMockChain();
  });

  it('returns null when no topic can be resolved (empty topic)', async () => {
    // resolveTopicId: prompt_id=null, no explanationId fallback
    mockChain.single.mockResolvedValue({ data: { prompt_id: null }, error: null });

    const ctx = makeCtx({
      payload: {
        originalText: 'text', title: 'T', explanationId: undefined as never, runId: 'run-empty-topic',
        config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
      },
    });
    const logger = makeMockLogger();

    const result = await loadArenaEntries('run-empty-topic', ctx, logger);

    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      'No Arena topic resolved — skipping Arena load',
      expect.objectContaining({ runId: 'run-empty-topic' }),
    );
  });

  it('loads entries with pre-seeded ratings and matchCounts', async () => {
    // resolveTopicId returns topic
    mockChain.single.mockResolvedValue({ data: { prompt_id: 'topic-load' }, error: null });

    // Arena entries query returns rows with joined elo data
    const arenaRows = [
      {
        id: 'arena-1', content: 'Arena variant 1', generation_method: 'evolution',
        model: 'gpt-4', total_cost_usd: 0.01, metadata: {},
        evolution_arena_elo: { mu: 28, sigma: 4.5, ordinal: 14.5, match_count: 10 },
      },
      {
        id: 'arena-2', content: 'Arena variant 2', generation_method: 'human',
        model: null, total_cost_usd: 0, metadata: {},
        evolution_arena_elo: { mu: 32, sigma: 3.0, ordinal: 23, match_count: 20 },
      },
    ];

    // Override the chain resolution for the select query (non-single, resolves as thenable)
    // After .eq and .is, the chain resolves with data
    mockChain.is.mockResolvedValue({ data: arenaRows, error: null });

    const ctx = makeCtx();
    const logger = makeMockLogger();

    const topicId = await loadArenaEntries('run-load', ctx, logger);

    expect(topicId).toBe('topic-load');

    // Verify pool was populated
    const arenaInPool = ctx.state.pool.filter((v) => v.id === 'arena-1' || v.id === 'arena-2');
    expect(arenaInPool).toHaveLength(2);

    // Verify ratings were pre-seeded
    expect(ctx.state.ratings.get('arena-1')).toEqual({ mu: 28, sigma: 4.5 });
    expect(ctx.state.ratings.get('arena-2')).toEqual({ mu: 32, sigma: 3.0 });

    // Verify matchCounts were pre-seeded
    expect(ctx.state.matchCounts.get('arena-1')).toBe(10);
    expect(ctx.state.matchCounts.get('arena-2')).toBe(20);

    expect(logger.info).toHaveBeenCalledWith(
      'Arena entries loaded into pool',
      expect.objectContaining({ runId: 'run-load', topicId: 'topic-load', loaded: 2 }),
    );
  });

  it('tags loaded entries with fromArena=true', async () => {
    mockChain.single.mockResolvedValue({ data: { prompt_id: 'topic-tag' }, error: null });

    const arenaRows = [
      {
        id: 'arena-tagged', content: 'Tagged variant', generation_method: 'evolution',
        model: 'gpt-4', total_cost_usd: 0, metadata: {},
        evolution_arena_elo: { mu: 25, sigma: 6, ordinal: 7, match_count: 5 },
      },
    ];
    mockChain.is.mockResolvedValue({ data: arenaRows, error: null });

    const ctx = makeCtx();
    const logger = makeMockLogger();

    await loadArenaEntries('run-tag', ctx, logger);

    const loaded = ctx.state.pool.find((v) => v.id === 'arena-tagged');
    expect(loaded).toBeDefined();
    expect(loaded!.fromArena).toBe(true);
  });

  it('throws on DB failure (not swallowed)', async () => {
    mockChain.single.mockResolvedValue({ data: { prompt_id: 'topic-err' }, error: null });

    // Arena entries query returns error
    mockChain.is.mockResolvedValue({
      data: null,
      error: { message: 'relation does not exist' },
    });

    const ctx = makeCtx();
    const logger = makeMockLogger();

    await expect(loadArenaEntries('run-err', ctx, logger)).rejects.toThrow(
      'Failed to load Arena entries: relation does not exist',
    );
  });
});
