// Unit tests for checkpoint pruning in finalizePipelineRun.
// Verifies pruning is non-fatal and correctly delegates to the RPC + delete pattern.

import { pruneCheckpoints } from './pipeline';

// Mock Supabase
const rpcMock = jest.fn();
const deleteMock = jest.fn();
const eqMock = jest.fn();
const notMock = jest.fn();

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => ({
      delete: (...args: unknown[]) => {
        deleteMock(...args);
        return {
          eq: (...eqArgs: unknown[]) => {
            eqMock(...eqArgs);
            return {
              not: (...notArgs: unknown[]) => {
                notMock(...notArgs);
                return { error: null, count: 5 };
              },
            };
          },
        };
      },
    }),
  }),
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('pruneCheckpoints', () => {
  it('calls RPC to get keeper IDs then deletes the rest', async () => {
    rpcMock.mockResolvedValue({
      data: [{ id: 'keep-1' }, { id: 'keep-2' }],
      error: null,
    });

    await pruneCheckpoints('run-1', mockLogger as never);

    expect(rpcMock).toHaveBeenCalledWith('get_latest_checkpoint_ids_per_iteration', { p_run_id: 'run-1' });
    expect(deleteMock).toHaveBeenCalledWith({ count: 'exact' });
    expect(eqMock).toHaveBeenCalledWith('run_id', 'run-1');
    expect(notMock).toHaveBeenCalledWith('id', 'in', '(keep-1,keep-2)');
    expect(mockLogger.info).toHaveBeenCalledWith('Checkpoints pruned', expect.objectContaining({ deleted: 5, kept: 2 }));
  });

  it('is non-fatal when RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'DB timeout' } });

    await pruneCheckpoints('run-1', mockLogger as never);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Checkpoint pruning: failed to get keeper IDs',
      expect.objectContaining({ error: 'DB timeout' }),
    );
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('is non-fatal when delete throws', async () => {
    rpcMock.mockResolvedValue({
      data: [{ id: 'keep-1' }],
      error: null,
    });
    // Override the from().delete() chain to throw
    const { createSupabaseServiceClient } = jest.requireMock('@/lib/utils/supabase/server');
    createSupabaseServiceClient.mockResolvedValueOnce({
      rpc: rpcMock,
      from: () => ({
        delete: () => { throw new Error('Connection lost'); },
      }),
    });

    await pruneCheckpoints('run-2', mockLogger as never);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Checkpoint pruning failed (non-fatal)',
      expect.objectContaining({ error: expect.stringContaining('Connection lost') }),
    );
  });

  it('skips delete when no keeper IDs returned', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    await pruneCheckpoints('run-1', mockLogger as never);

    expect(deleteMock).not.toHaveBeenCalled();
  });
});
