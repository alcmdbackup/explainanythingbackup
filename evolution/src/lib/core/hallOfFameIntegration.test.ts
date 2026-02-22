// Unit tests for Hall of Fame integration functions extracted from pipeline.ts.
// Tests findTopicByPrompt, linkPromptToRun, autoLinkPrompt, and feedHallOfFame using mocked Supabase.

import { findTopicByPrompt, linkPromptToRun, autoLinkPrompt, feedHallOfFame } from './hallOfFameIntegration';
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

// Mock hallOfFameActions for the auto re-rank dynamic import
jest.mock('@evolution/services/hallOfFameActions', () => ({
  runHallOfFameComparisonInternal: jest.fn().mockResolvedValue({ success: true, data: { compared: 1 } }),
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
    expect(mockChain.from).toHaveBeenCalledWith('evolution_hall_of_fame_topics');
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

describe('feedHallOfFame', () => {
  beforeEach(() => {
    mockChain = createMockChain();
  });

  it('upserts top 2 variants into evolution_hall_of_fame_entries', async () => {
    // First single(): run query returns prompt_id
    mockChain.single.mockResolvedValue({ data: { prompt_id: 'topic-1' }, error: null });
    // upsert returns entries with IDs (top 2 only)
    mockChain.upsert.mockReturnValue({
      ...mockChain,
      select: jest.fn().mockResolvedValue({
        data: [{ id: 'entry-1' }, { id: 'entry-2' }],
        error: null,
      }),
    });

    const ctx = makeCtx();
    const logger = makeMockLogger();

    await feedHallOfFame('run-1', ctx, logger);

    expect(logger.info).toHaveBeenCalledWith(
      'Hall of fame updated',
      expect.objectContaining({ runId: 'run-1', topicId: 'topic-1', entriesInserted: 2 }),
    );
  });

  it('logs info and returns when pool is empty', async () => {
    const state = new PipelineStateImpl('empty');
    const ctx = makeCtx({
      payload: { originalText: 'empty', title: 'T', explanationId: 1, runId: 'run-empty', config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig },
      state,
    });
    const logger = makeMockLogger();

    await feedHallOfFame('run-empty', ctx, logger);

    expect(logger.info).toHaveBeenCalledWith(
      'No variants to feed into hall of fame',
      expect.objectContaining({ runId: 'run-empty' }),
    );
  });

  it('logs warning when no topic can be resolved', async () => {
    // run has no prompt_id, no explanationId to fallback
    mockChain.single.mockResolvedValue({ data: { prompt_id: null }, error: null });

    const ctx = makeCtx({
      payload: { originalText: 'text', title: 'T', explanationId: undefined as never, runId: 'run-no-topic', config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig },
    });
    const logger = makeMockLogger();

    await feedHallOfFame('run-no-topic', ctx, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      'Cannot feed hall of fame — no topic resolved',
      expect.objectContaining({ runId: 'run-no-topic' }),
    );
  });

  it('handles upsert errors gracefully', async () => {
    mockChain.single.mockResolvedValue({ data: { prompt_id: 'topic-1' }, error: null });
    mockChain.upsert.mockReturnValue({
      ...mockChain,
      select: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB conflict' } }),
    });

    const ctx = makeCtx();
    const logger = makeMockLogger();

    await feedHallOfFame('run-1', ctx, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to batch upsert hall-of-fame entries',
      expect.objectContaining({ runId: 'run-1', error: 'DB conflict' }),
    );
  });

  it('handles top-level errors non-fatally', async () => {
    mockChain.single.mockRejectedValue(new Error('Connection lost'));

    const ctx = makeCtx();
    const logger = makeMockLogger();

    // Should not throw
    await feedHallOfFame('run-1', ctx, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      'Feed hall of fame failed (non-fatal)',
      expect.objectContaining({ runId: 'run-1' }),
    );
  });

  it('passes EVOLUTION_SYSTEM_USERID to auto re-rank comparison', async () => {
    const mockComparison = jest.requireMock('@evolution/services/hallOfFameActions').runHallOfFameComparisonInternal;
    mockComparison.mockClear();

    mockChain.single.mockResolvedValue({ data: { prompt_id: 'topic-1' }, error: null });
    mockChain.upsert.mockReturnValue({
      ...mockChain,
      select: jest.fn().mockResolvedValue({
        data: [{ id: 'entry-1' }, { id: 'entry-2' }],
        error: null,
      }),
    });

    const ctx = makeCtx();
    const logger = makeMockLogger();

    await feedHallOfFame('run-1', ctx, logger);

    expect(mockComparison).toHaveBeenCalledWith(
      'topic-1',
      '00000000-0000-4000-8000-000000000001',
      'gpt-4.1-nano',
      1,
    );
  });

  it('resolves topic from explanation title fallback when no prompt_id', async () => {
    let singleCallCount = 0;
    mockChain.single.mockImplementation(() => {
      singleCallCount++;
      if (singleCallCount === 1) {
        // Run query: no prompt_id
        return Promise.resolve({ data: { prompt_id: null }, error: null });
      }
      if (singleCallCount === 2) {
        // Explanation query
        return Promise.resolve({ data: { explanation_title: 'Test Topic' }, error: null });
      }
      if (singleCallCount === 3) {
        // findTopicByPrompt (ilike query)
        return Promise.resolve({ data: { id: 'resolved-topic' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    mockChain.upsert.mockReturnValue({
      ...mockChain,
      select: jest.fn().mockResolvedValue({
        data: [{ id: 'e1' }, { id: 'e2' }],
        error: null,
      }),
    });

    const ctx = makeCtx();
    const logger = makeMockLogger();

    await feedHallOfFame('run-1', ctx, logger);

    expect(logger.info).toHaveBeenCalledWith(
      'Hall of fame updated',
      expect.objectContaining({ topicId: 'resolved-topic' }),
    );
  });
});
