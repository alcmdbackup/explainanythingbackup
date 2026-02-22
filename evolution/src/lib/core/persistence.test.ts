// Unit tests for persistence module: markRunFailed, markRunPaused, and loadCheckpointForResume with mocked supabase.

import { markRunFailed, markRunPaused, loadCheckpointForResume } from './persistence';
import { BudgetExceededError, CheckpointCorruptedError } from '../types';
import type { SerializedPipelineState } from '../types';

jest.mock('@/lib/utils/supabase/server', () => {
  const chain: Record<string, jest.Mock> = {};
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.in = jest.fn().mockReturnValue(chain);
  chain.update = jest.fn().mockReturnValue(chain);
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
