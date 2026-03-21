// Tests for V2 run logger.

import { createRunLogger } from './createRunLogger';

function makeMockSupabase() {
  const insertedRows: Record<string, unknown>[] = [];

  const mockDb = {
    from: jest.fn(() => ({
      insert: jest.fn((row: Record<string, unknown>) => {
        insertedRows.push(row);
        return Promise.resolve({ error: null });
      }),
    })),
  } as never;

  return { db: mockDb, insertedRows };
}

describe('createRunLogger', () => {
  it('returns logger with all 4 methods', () => {
    const { db } = makeMockSupabase();
    const logger = createRunLogger('run-1', db);
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('info writes correct level to DB', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createRunLogger('run-1', db);
    logger.info('test message');
    await new Promise((r) => setTimeout(r, 10)); // Let fire-and-forget resolve
    expect(insertedRows[0]).toMatchObject({ level: 'info', message: 'test message', run_id: 'run-1' });
  });

  it('warn writes correct level', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createRunLogger('run-1', db);
    logger.warn('warning');
    await new Promise((r) => setTimeout(r, 10));
    expect(insertedRows[0]).toMatchObject({ level: 'warn' });
  });

  it('error writes correct level', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createRunLogger('run-1', db);
    logger.error('err');
    await new Promise((r) => setTimeout(r, 10));
    expect(insertedRows[0]).toMatchObject({ level: 'error' });
  });

  it('extracts iteration from context', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createRunLogger('run-1', db);
    logger.info('test', { iteration: 3 });
    await new Promise((r) => setTimeout(r, 10));
    expect(insertedRows[0]).toMatchObject({ iteration: 3 });
  });

  it('extracts phaseName to agent_name column', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createRunLogger('run-1', db);
    logger.info('test', { phaseName: 'ranking' });
    await new Promise((r) => setTimeout(r, 10));
    expect(insertedRows[0]).toMatchObject({ agent_name: 'ranking' });
  });

  it('extracts variantId to variant_id column', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createRunLogger('run-1', db);
    logger.info('test', { variantId: 'v-123' });
    await new Promise((r) => setTimeout(r, 10));
    expect(insertedRows[0]).toMatchObject({ variant_id: 'v-123' });
  });

  it('context JSONB passed through (non-extracted fields)', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createRunLogger('run-1', db);
    logger.info('test', { iteration: 1, custom: 'data' });
    await new Promise((r) => setTimeout(r, 10));
    expect(insertedRows[0]).toMatchObject({ context: { custom: 'data' } });
  });

  it('DB error swallowed', async () => {
    const mockDb = {
      from: jest.fn(() => ({
        insert: jest.fn(() => Promise.resolve({ error: { message: 'DB down' } })),
      })),
    } as never;

    const spy = jest.spyOn(console, 'warn').mockImplementation();
    const logger = createRunLogger('run-1', mockDb);
    logger.info('test');
    await new Promise((r) => setTimeout(r, 10));
    spy.mockRestore();
    // No throw
  });
});
