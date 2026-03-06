// Unit tests for continuation-passing persistence functions:
// checkpointAndMarkContinuationPending (RPC wrapper) and loadCheckpointForResume.

import type { PipelineState } from '../types';
import type { SupervisorResumeState } from './supervisor';

// ─── Supabase mock (must be inside factory to avoid hoisting issues) ─

const rpcMock = jest.fn();
const maybeSingleMock = jest.fn();

jest.mock('@/lib/utils/supabase/server', () => {
  const ch: Record<string, jest.Mock> = {};
  ch.from = jest.fn().mockReturnValue(ch);
  ch.select = jest.fn().mockReturnValue(ch);
  ch.eq = jest.fn().mockReturnValue(ch);
  ch.in = jest.fn().mockReturnValue(ch);
  ch.order = jest.fn().mockReturnValue(ch);
  ch.limit = jest.fn().mockReturnValue(ch);
  ch.maybeSingle = maybeSingleMock;
  ch.rpc = rpcMock;
  return { createSupabaseServiceClient: jest.fn().mockResolvedValue(ch) };
});

// Minimal mock for serializeState
jest.mock('./state', () => ({
  serializeState: jest.fn((state: PipelineState) => ({
    originalText: state.originalText,
    iteration: state.iteration,
    pool: state.pool,
    newEntrantsThisIteration: [],
    ratings: {},
    matchCounts: {},
    matchHistory: [],
  })),
  deserializeState: jest.fn((snapshot: Record<string, unknown>) => ({
    originalText: snapshot.originalText ?? 'test',
    iteration: snapshot.iteration ?? 0,
    pool: snapshot.pool ?? [],
    poolIds: new Set((snapshot.pool as Array<{ id: string }> ?? []).map(v => v.id)),
    ratings: new Map(),
    getPoolSize: () => (snapshot.pool as unknown[] ?? []).length,
  })),
}));

jest.mock('./rating', () => ({
  getOrdinal: jest.fn(() => 0),
  ordinalToEloScale: jest.fn(() => 1500),
  createRating: jest.fn(() => ({ mu: 25, sigma: 8.333 })),
}));

// Import after mocks
import { checkpointAndMarkContinuationPending, loadCheckpointForResume } from './persistence';
import { CheckpointNotFoundError, CheckpointCorruptedError } from '../types';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

// ─── checkpointAndMarkContinuationPending ───────────────────────

describe('checkpointAndMarkContinuationPending', () => {
  const mockState = {
    iteration: 3,
    pool: [{ id: 'v1', text: 'test', version: 1, parentIds: [], strategy: 'gen', createdAt: 1 }],
    originalText: 'original',
  } as unknown as PipelineState;

  const mockSupervisor = {
    getResumeState: (): SupervisorResumeState => ({
      phase: 'EXPANSION',
      ordinalHistory: [10, 12],
      diversityHistory: [0.5],
    }),
  };

  it('calls checkpoint_and_continue RPC with correct params', async () => {
    rpcMock.mockResolvedValue({ error: null });

    await checkpointAndMarkContinuationPending(
      'run-1', mockState, mockSupervisor, 'EXPANSION', mockLogger as never, 2.50,
    );

    expect(rpcMock).toHaveBeenCalledWith('checkpoint_and_continue', expect.objectContaining({
      p_run_id: 'run-1',
      p_iteration: 3,
      p_phase: 'EXPANSION',
      p_total_cost_usd: 2.50,
    }));
    // p_pool_length should no longer be passed (runner_agents_completed column dropped)
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty('p_pool_length');
    expect(rpcMock.mock.calls[0][1].p_state_snapshot).toBeDefined();
  });

  it('throws on RPC failure', async () => {
    rpcMock.mockResolvedValue({ error: { message: 'RPC timeout' } });

    await expect(
      checkpointAndMarkContinuationPending(
        'run-1', mockState, mockSupervisor, 'EXPANSION', mockLogger as never, 1.0,
      ),
    ).rejects.toThrow('checkpoint_and_continue RPC failed');
  });

  it('includes supervisorState in snapshot', async () => {
    rpcMock.mockResolvedValue({ error: null });

    await checkpointAndMarkContinuationPending(
      'run-1', mockState, mockSupervisor, 'EXPANSION', mockLogger as never, 1.0,
    );

    const snapshot = rpcMock.mock.calls[0][1].p_state_snapshot;
    expect(snapshot.supervisorState).toEqual({
      phase: 'EXPANSION',
      ordinalHistory: [10, 12],
      diversityHistory: [0.5],
    });
  });

  it('includes costTrackerTotalSpent in snapshot', async () => {
    rpcMock.mockResolvedValue({ error: null });

    await checkpointAndMarkContinuationPending(
      'run-1', mockState, mockSupervisor, 'EXPANSION', mockLogger as never, 3.75,
    );

    const snapshot = rpcMock.mock.calls[0][1].p_state_snapshot;
    expect(snapshot.costTrackerTotalSpent).toBe(3.75);
  });

  it('passes p_last_agent to RPC (defaults to iteration_complete)', async () => {
    rpcMock.mockResolvedValue({ error: null });

    await checkpointAndMarkContinuationPending(
      'run-1', mockState, mockSupervisor, 'EXPANSION', mockLogger as never, 1.0,
    );

    expect(rpcMock).toHaveBeenCalledWith('checkpoint_and_continue', expect.objectContaining({
      p_last_agent: 'iteration_complete',
    }));
  });

  it('passes custom lastAgent when provided (continuation_yield)', async () => {
    rpcMock.mockResolvedValue({ error: null });

    await checkpointAndMarkContinuationPending(
      'run-1', mockState, mockSupervisor, 'EXPANSION', mockLogger as never, 1.0,
      undefined, 'continuation_yield', ['ranking', 'flowCritique'],
    );

    expect(rpcMock).toHaveBeenCalledWith('checkpoint_and_continue', expect.objectContaining({
      p_last_agent: 'continuation_yield',
    }));
  });

  it('includes resumeAgentNames in snapshot when provided', async () => {
    rpcMock.mockResolvedValue({ error: null });

    const agentNames = ['ranking', 'flowCritique', 'generation'];
    await checkpointAndMarkContinuationPending(
      'run-1', mockState, mockSupervisor, 'EXPANSION', mockLogger as never, 1.0,
      undefined, 'continuation_yield', agentNames,
    );

    const snapshot = rpcMock.mock.calls[0][1].p_state_snapshot;
    expect(snapshot.resumeAgentNames).toEqual(agentNames);
  });

  it('omits resumeAgentNames from snapshot when not provided', async () => {
    rpcMock.mockResolvedValue({ error: null });

    await checkpointAndMarkContinuationPending(
      'run-1', mockState, mockSupervisor, 'EXPANSION', mockLogger as never, 1.0,
    );

    const snapshot = rpcMock.mock.calls[0][1].p_state_snapshot;
    expect(snapshot.resumeAgentNames).toBeUndefined();
  });
});

// ─── loadCheckpointForResume ────────────────────────────────────

describe('loadCheckpointForResume', () => {
  it('throws CheckpointNotFoundError when no rows returned', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    await expect(loadCheckpointForResume('run-missing')).rejects.toThrow(CheckpointNotFoundError);
  });

  it('throws on query error', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    await expect(loadCheckpointForResume('run-err')).rejects.toThrow('Failed to query checkpoints');
  });

  it('returns deserialized state with supervisor and cost data', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        iteration: 5,
        phase: 'COMPETITION',
        state_snapshot: {
          originalText: 'test text',
          iteration: 5,
          pool: [],
          newEntrantsThisIteration: [],
          ratings: {},
          matchCounts: {},
          matchHistory: [],
          supervisorState: { phase: 'COMPETITION', ordinalHistory: [15], diversityHistory: [0.3] },
          costTrackerTotalSpent: 1.23,
        },
      },
      error: null,
    });

    const result = await loadCheckpointForResume('run-ok');

    expect(result.iteration).toBe(5);
    expect(result.phase).toBe('COMPETITION');
    expect(result.costTrackerTotalSpent).toBe(1.23);
    expect(result.supervisorState).toEqual({
      phase: 'COMPETITION',
      ordinalHistory: [15],
      diversityHistory: [0.3],
    });
  });

  it('defaults costTrackerTotalSpent to 0 when missing from snapshot', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        iteration: 1,
        phase: 'EXPANSION',
        state_snapshot: {
          originalText: 'text',
          iteration: 1,
          pool: [],
          newEntrantsThisIteration: [],
          ratings: {},
          matchCounts: {},
          matchHistory: [],
        },
      },
      error: null,
    });

    const result = await loadCheckpointForResume('run-legacy');
    expect(result.costTrackerTotalSpent).toBe(0);
  });

  it('returns resumeAgentNames from snapshot when present', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        iteration: 3,
        phase: 'EXPANSION',
        last_agent: 'continuation_yield',
        state_snapshot: {
          originalText: 'text',
          iteration: 3,
          pool: [],
          newEntrantsThisIteration: [],
          ratings: {},
          matchCounts: {},
          matchHistory: [],
          supervisorState: { phase: 'EXPANSION', ordinalHistory: [], diversityHistory: [] },
          costTrackerTotalSpent: 0.5,
          resumeAgentNames: ['ranking', 'flowCritique'],
        },
      },
      error: null,
    });

    const result = await loadCheckpointForResume('run-yield');
    expect(result.resumeAgentNames).toEqual(['ranking', 'flowCritique']);
  });

  it('returns undefined resumeAgentNames when not in snapshot', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        iteration: 5,
        phase: 'COMPETITION',
        last_agent: 'iteration_complete',
        state_snapshot: {
          originalText: 'text',
          iteration: 5,
          pool: [],
          newEntrantsThisIteration: [],
          ratings: {},
          matchCounts: {},
          matchHistory: [],
          supervisorState: { phase: 'COMPETITION', ordinalHistory: [15], diversityHistory: [0.3] },
          costTrackerTotalSpent: 1.0,
        },
      },
      error: null,
    });

    const result = await loadCheckpointForResume('run-normal');
    expect(result.resumeAgentNames).toBeUndefined();
  });

  it('throws CheckpointCorruptedError when deserialization fails', async () => {
    // Make deserializeState throw
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { deserializeState } = require('./state');
    deserializeState.mockImplementationOnce(() => { throw new Error('bad data'); });

    maybeSingleMock.mockResolvedValue({
      data: {
        iteration: 1,
        phase: 'EXPANSION',
        state_snapshot: { corrupted: true },
      },
      error: null,
    });

    await expect(loadCheckpointForResume('run-corrupt')).rejects.toThrow(CheckpointCorruptedError);
  });
});
