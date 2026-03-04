// Unit tests for persistence module: markRunFailed, markRunPaused, and loadCheckpointForResume with mocked supabase.

import { markRunFailed, markRunPaused, loadCheckpointForResume, computeAndPersistAttribution, persistVariants } from './persistence';
import { BudgetExceededError, CheckpointCorruptedError } from '../types';
import type { SerializedPipelineState, ExecutionContext, EvolutionLogger, PipelineState } from '../types';
import type { Rating } from './rating';

jest.mock('@/lib/utils/supabase/server', () => {
  const chain: Record<string, jest.Mock> = {};
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.in = jest.fn().mockReturnValue(chain);
  chain.update = jest.fn().mockReturnValue(chain);
  chain.upsert = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.from = jest.fn().mockReturnValue(chain);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.order = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  return { createSupabaseServiceClient: jest.fn().mockResolvedValue(chain) };
});

describe('markRunFailed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates run status to failed with agent name in message', async () => {
    await markRunFailed('run-1', 'generation', new Error('LLM timeout'));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    expect(supabase.from).toHaveBeenCalledWith('evolution_runs');
    const updateCalls = (supabase.update as jest.Mock).mock.calls;
    expect(updateCalls.length).toBeGreaterThan(0);
    const updateArg = updateCalls[0][0];
    expect(updateArg.status).toBe('failed');
    expect(updateArg.error_message).toContain('Agent generation');
    expect(updateArg.error_message).toContain('LLM timeout');
    expect(updateArg.completed_at).toBeDefined();
  });

  it('uses pipeline error prefix when agentName is null', async () => {
    await markRunFailed('run-2', null, new Error('Unexpected'));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    const updateArg = (supabase.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.error_message).toContain('Pipeline error');
  });

  it('truncates error message to 500 characters', async () => {
    const longMessage = 'x'.repeat(600);
    await markRunFailed('run-3', 'test', new Error(longMessage));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    const updateArg = (supabase.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.error_message.length).toBeLessThanOrEqual(500);
  });

  it('guards transition with .in() on non-terminal statuses', async () => {
    await markRunFailed('run-4', 'test', new Error('fail'));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    const inCalls = (supabase.in as jest.Mock).mock.calls;
    expect(inCalls.length).toBeGreaterThan(0);
    expect(inCalls[0][0]).toBe('status');
    expect(inCalls[0][1]).toEqual(['pending', 'claimed', 'running', 'continuation_pending']);
  });
});

describe('markRunPaused', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates run status to paused with budget error message', async () => {
    const error = new BudgetExceededError('generation', 5.0, 5.0);
    await markRunPaused('run-5', error);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    expect(supabase.from).toHaveBeenCalledWith('evolution_runs');
    const updateArg = (supabase.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.status).toBe('paused');
    expect(updateArg.error_message).toBeDefined();
  });

  it('guards transition with .in() on non-terminal statuses', async () => {
    const error = new BudgetExceededError('generation', 5.0, 5.0);
    await markRunPaused('run-6', error);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    const inCalls = (supabase.in as jest.Mock).mock.calls;
    expect(inCalls.length).toBeGreaterThan(0);
    expect(inCalls[0][0]).toBe('status');
    expect(inCalls[0][1]).toEqual(['pending', 'claimed', 'running', 'continuation_pending']);
  });
});

describe('loadCheckpointForResume', () => {
  beforeEach(() => jest.clearAllMocks());

  function makeValidSnapshot(): SerializedPipelineState {
    return {
      iteration: 1,
      originalText: 'test',
      pool: [
        { id: 'v1', text: 'text', version: 1, parentIds: [], strategy: 'test', createdAt: 0, iterationBorn: 0 },
      ],
      newEntrantsThisIteration: [],
      ratings: { v1: { mu: 25, sigma: 8.333 } },
      matchCounts: { v1: 0 },
      matchHistory: [],
      dimensionScores: null,
      allCritiques: null,
      similarityMatrix: null,
      diversityScore: null,
      metaFeedback: null,
      debateTranscripts: [],
    };
  }

  it('throws CheckpointCorruptedError when state has integrity violations', async () => {
    // Corrupt snapshot: ratings key 'ghost' not in pool
    const snapshot = makeValidSnapshot();
    snapshot.ratings['ghost'] = { mu: 25, sigma: 8 };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    (supabase.maybeSingle as jest.Mock).mockResolvedValueOnce({
      data: { state_snapshot: snapshot, iteration: 1, phase: 'EXPANSION' },
      error: null,
    });

    await expect(loadCheckpointForResume('run-corrupt')).rejects.toThrow(CheckpointCorruptedError);
  });

  it('throws CheckpointCorruptedError with details about the violation', async () => {
    // Corrupt snapshot: pool has variant with orphan parentId
    const snapshot = makeValidSnapshot();
    snapshot.pool.push({
      id: 'v2', text: 'child', version: 1, parentIds: ['nonexistent'],
      strategy: 'test', createdAt: 0, iterationBorn: 0,
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    (supabase.maybeSingle as jest.Mock).mockResolvedValueOnce({
      data: { state_snapshot: snapshot, iteration: 1, phase: 'EXPANSION' },
      error: null,
    });

    await expect(loadCheckpointForResume('run-orphan')).rejects.toThrow(/nonexistent/);
  });

  it('succeeds for valid checkpoint with no integrity violations', async () => {
    const snapshot = makeValidSnapshot();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    (supabase.maybeSingle as jest.Mock).mockResolvedValueOnce({
      data: { state_snapshot: snapshot, iteration: 1, phase: 'EXPANSION' },
      error: null,
    });

    const result = await loadCheckpointForResume('run-valid');
    expect(result.state.pool).toHaveLength(1);
    expect(result.iteration).toBe(1);
  });
});

describe('computeAndPersistAttribution', () => {
  beforeEach(() => jest.clearAllMocks());

  function makeMockCtx(): { ctx: ExecutionContext; logger: EvolutionLogger } {
    const ratings = new Map<string, Rating>([
      ['v1', { mu: 30, sigma: 4 }],
      ['v2', { mu: 35, sigma: 3 }],
    ]);

    const state = {
      pool: [
        { id: 'v1', text: 'text1', version: 1, parentIds: [], strategy: 'structural_transform', createdAt: 0, iterationBorn: 0 },
        { id: 'v2', text: 'text2', version: 1, parentIds: ['v1'], strategy: 'mutate_clarity', createdAt: 0, iterationBorn: 0 },
      ],
      ratings,
    } as unknown as PipelineState;

    const logger: EvolutionLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const ctx = { state, runId: 'run-attr' } as unknown as ExecutionContext;
    return { ctx, logger };
  }

  it('calls update on evolution_variants with elo_attribution JSONB', async () => {
    const { ctx, logger } = makeMockCtx();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    await computeAndPersistAttribution('run-attr', ctx, logger);

    const fromCalls = (supabase.from as jest.Mock).mock.calls;
    const variantCalls = fromCalls.filter((c: string[]) => c[0] === 'evolution_variants');
    expect(variantCalls.length).toBeGreaterThan(0);

    const updateCalls = (supabase.update as jest.Mock).mock.calls;
    const attrUpdates = updateCalls.filter((c: Array<Record<string, unknown>>) => c[0]?.elo_attribution);
    expect(attrUpdates.length).toBeGreaterThan(0);
    expect(attrUpdates[0][0].elo_attribution).toHaveProperty('gain');
    expect(attrUpdates[0][0].elo_attribution).toHaveProperty('ci');
    expect(attrUpdates[0][0].elo_attribution).toHaveProperty('zScore');
  });

  it('calls update on evolution_agent_invocations with agent_attribution', async () => {
    const { ctx, logger } = makeMockCtx();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    await computeAndPersistAttribution('run-attr', ctx, logger);

    const fromCalls = (supabase.from as jest.Mock).mock.calls;
    const invocationCalls = fromCalls.filter((c: string[]) => c[0] === 'evolution_agent_invocations');
    expect(invocationCalls.length).toBeGreaterThan(0);

    const updateCalls = (supabase.update as jest.Mock).mock.calls;
    const agentUpdates = updateCalls.filter((c: Array<Record<string, unknown>>) => c[0]?.agent_attribution);
    expect(agentUpdates.length).toBeGreaterThan(0);
    expect(agentUpdates[0][0].agent_attribution).toHaveProperty('agentName');
    expect(agentUpdates[0][0].agent_attribution).toHaveProperty('variantCount');
  });

  it('logs info after successful attribution persistence', async () => {
    const { ctx, logger } = makeMockCtx();

    await computeAndPersistAttribution('run-attr', ctx, logger);

    expect(logger.info).toHaveBeenCalledWith('Elo attribution persisted', expect.objectContaining({
      runId: 'run-attr',
      variants: 2,
    }));
  });
});

describe('persistVariants', () => {
  beforeEach(() => jest.clearAllMocks());

  it('excludes Arena-loaded entries (fromArena=true) from variant persistence', async () => {
    const ratings = new Map<string, Rating>([
      ['local-1', { mu: 30, sigma: 4 }],
      ['local-2', { mu: 35, sigma: 3 }],
      ['arena-1', { mu: 28, sigma: 3.5 }],
    ]);

    const matchCounts = new Map<string, number>([
      ['local-1', 5],
      ['local-2', 8],
      ['arena-1', 15],
    ]);

    const state = {
      pool: [
        { id: 'local-1', text: 'text1', version: 1, parentIds: [], strategy: 'structural_transform', createdAt: 0, iterationBorn: 0 },
        { id: 'local-2', text: 'text2', version: 1, parentIds: ['local-1'], strategy: 'mutate_clarity', createdAt: 0, iterationBorn: 1 },
        { id: 'arena-1', text: 'arena text', version: 0, parentIds: [], strategy: 'evolution', createdAt: 0, iterationBorn: 0, fromArena: true },
      ],
      ratings,
      matchCounts,
      getTopByRating: jest.fn().mockReturnValue([
        { id: 'local-2', text: 'text2', version: 1, parentIds: ['local-1'], strategy: 'mutate_clarity', createdAt: 0, iterationBorn: 1 },
      ]),
    } as unknown as PipelineState;

    const logger: EvolutionLogger = {
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    };

    const ctx = {
      state,
      payload: { explanationId: 42, config: {} },
      costTracker: { getTotalSpent: jest.fn().mockReturnValue(1.0) },
    } as unknown as ExecutionContext;

    await persistVariants('run-arena-filter', ctx, logger);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    // upsert should have been called with only local entries (not arena-1)
    const upsertCalls = (supabase.upsert as jest.Mock).mock.calls;
    expect(upsertCalls.length).toBe(1);
    const upsertedRows = upsertCalls[0][0] as Array<{ id: string }>;
    expect(upsertedRows.map((r) => r.id)).toEqual(['local-1', 'local-2']);
    expect(upsertedRows.map((r) => r.id)).not.toContain('arena-1');

    expect(logger.info).toHaveBeenCalledWith('Variants persisted', expect.objectContaining({
      runId: 'run-arena-filter', count: 2,
    }));
  });
});
