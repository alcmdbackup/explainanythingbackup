// Unit tests for LogBuffer — validates buffering, auto-flush threshold, and DB write batching.

// Must declare mock fn before jest.mock (hoisted)
const mockInsert = jest.fn().mockResolvedValue({ error: null });
const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({
    from: mockFrom,
  }),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { LogBuffer } from './logger';

describe('LogBuffer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
  });

  it('buffers entries and flushes to DB on explicit flush()', async () => {
    const buffer = new LogBuffer('run-123');

    buffer.append('info', 'Test message', { agent: 'generation', iteration: 1 });
    buffer.append('warn', 'Warning msg', { agent: 'calibration', iteration: 2, variationId: 'v-1' });

    // Nothing flushed yet (buffer < 20)
    expect(mockInsert).not.toHaveBeenCalled();

    await buffer.flush();

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertedRows = mockInsert.mock.calls[0][0];
    expect(insertedRows).toHaveLength(2);

    expect(insertedRows[0]).toEqual({
      run_id: 'run-123',
      level: 'info',
      agent_name: 'generation',
      iteration: 1,
      variant_id: null,
      message: 'Test message',
      context: { agent: 'generation', iteration: 1 },
    });

    expect(insertedRows[1]).toEqual({
      run_id: 'run-123',
      level: 'warn',
      agent_name: 'calibration',
      iteration: 2,
      variant_id: 'v-1',
      message: 'Warning msg',
      context: { agent: 'calibration', iteration: 2, variationId: 'v-1' },
    });
  });

  it('extracts agent_name from multiple context key patterns', async () => {
    const buffer = new LogBuffer('run-456');

    buffer.append('info', 'msg1', { agentName: 'tournament' });
    buffer.append('info', 'msg2', { agent: 'evolution' });
    buffer.append('info', 'msg3', {}); // no agent

    await buffer.flush();

    const rows = mockInsert.mock.calls[0][0];
    expect(rows[0].agent_name).toBe('tournament');
    expect(rows[1].agent_name).toBe('evolution');
    expect(rows[2].agent_name).toBeNull();
  });

  it('extracts variant_id from multiple context key patterns', async () => {
    const buffer = new LogBuffer('run-789');

    buffer.append('info', 'msg1', { variationId: 'vid-1' });
    buffer.append('info', 'msg2', { variantId: 'vid-2' });
    buffer.append('info', 'msg3', { variant_id: 'vid-3' });

    await buffer.flush();

    const rows = mockInsert.mock.calls[0][0];
    expect(rows[0].variant_id).toBe('vid-1');
    expect(rows[1].variant_id).toBe('vid-2');
    expect(rows[2].variant_id).toBe('vid-3');
  });

  it('handles null/undefined context gracefully', async () => {
    const buffer = new LogBuffer('run-nil');

    buffer.append('error', 'No context');
    buffer.append('debug', 'Undefined ctx', undefined);

    await buffer.flush();

    const rows = mockInsert.mock.calls[0][0];
    expect(rows[0].agent_name).toBeNull();
    expect(rows[0].iteration).toBeNull();
    expect(rows[0].context).toBeNull();
    expect(rows[1].context).toBeNull();
  });

  it('flush() is a no-op when buffer is empty', async () => {
    const buffer = new LogBuffer('run-empty');
    await buffer.flush();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('auto-flushes when buffer reaches 20 entries', async () => {
    const buffer = new LogBuffer('run-auto');

    for (let i = 0; i < 20; i++) {
      buffer.append('info', `msg-${i}`, { iteration: i });
    }

    // Wait for the fire-and-forget auto-flush + final flush
    await buffer.flush();

    expect(mockInsert).toHaveBeenCalled();
    const totalInserted = mockInsert.mock.calls.reduce(
      (sum: number, call: unknown[]) => sum + (call[0] as unknown[]).length,
      0,
    );
    expect(totalInserted).toBe(20);
  });

  it('survives DB errors without throwing', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'DB unavailable' } });
    const buffer = new LogBuffer('run-err');

    buffer.append('info', 'will fail');
    await expect(buffer.flush()).resolves.not.toThrow();
  });
});
