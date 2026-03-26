// Tests for the generalized entity logger.

import { createEntityLogger } from './createEntityLogger';
import type { EntityLogContext } from './createEntityLogger';

/** Drains the microtask queue so fire-and-forget Promise chains settle before assertions. */
const flushPromises = () => new Promise<void>((r) => (typeof setImmediate !== 'undefined' ? setImmediate(r) : setTimeout(r, 0)));

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

const runCtx: EntityLogContext = {
  entityType: 'run',
  entityId: 'run-1',
  runId: 'run-1',
  experimentId: 'exp-1',
  strategyId: 'strat-1',
};

describe('createEntityLogger', () => {
  it('returns logger with all 4 methods', () => {
    const { db } = makeMockSupabase();
    const logger = createEntityLogger(runCtx, db);
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('info writes correct level to DB', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createEntityLogger(runCtx, db);
    logger.info('test message');
    await flushPromises();
    expect(insertedRows[0]).toMatchObject({ level: 'info', message: 'test message' });
  });

  it('warn writes correct level', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createEntityLogger(runCtx, db);
    logger.warn('warning');
    await flushPromises();
    expect(insertedRows[0]).toMatchObject({ level: 'warn' });
  });

  it('error writes correct level', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createEntityLogger(runCtx, db);
    logger.error('err');
    await flushPromises();
    expect(insertedRows[0]).toMatchObject({ level: 'error' });
  });

  it('extracts iteration from context', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createEntityLogger(runCtx, db);
    logger.info('test', { iteration: 3 });
    await flushPromises();
    expect(insertedRows[0]).toMatchObject({ iteration: 3 });
  });

  it('extracts phaseName to agent_name column', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createEntityLogger(runCtx, db);
    logger.info('test', { phaseName: 'ranking' });
    await flushPromises();
    expect(insertedRows[0]).toMatchObject({ agent_name: 'ranking' });
  });

  it('extracts variantId to variant_id column', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createEntityLogger(runCtx, db);
    logger.info('test', { variantId: 'v-123' });
    await flushPromises();
    expect(insertedRows[0]).toMatchObject({ variant_id: 'v-123' });
  });

  it('context JSONB passed through (non-extracted fields)', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createEntityLogger(runCtx, db);
    logger.info('test', { iteration: 1, custom: 'data' });
    await flushPromises();
    expect(insertedRows[0]).toMatchObject({ context: { custom: 'data' } });
  });

  it('DB error swallowed', async () => {
    const mockDb = {
      from: jest.fn(() => ({
        insert: jest.fn(() => Promise.resolve({ error: { message: 'DB down' } })),
      })),
    } as never;

    const spy = jest.spyOn(console, 'warn').mockImplementation();
    const logger = createEntityLogger(runCtx, mockDb);
    logger.info('test');
    await flushPromises();
    spy.mockRestore();
    // No throw
  });

  it('entity_type and entity_id columns populated correctly', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createEntityLogger(runCtx, db);
    logger.info('test');
    await flushPromises();
    expect(insertedRows[0]).toMatchObject({ entity_type: 'run', entity_id: 'run-1' });
  });

  it('ancestor FKs written correctly', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createEntityLogger(runCtx, db);
    logger.info('test');
    await flushPromises();
    expect(insertedRows[0]).toMatchObject({
      run_id: 'run-1',
      experiment_id: 'exp-1',
      strategy_id: 'strat-1',
    });
  });

  it('run_id is NULL when entity_type is experiment', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createEntityLogger({
      entityType: 'experiment',
      entityId: 'exp-1',
      experimentId: 'exp-1',
      strategyId: 'strat-1',
    }, db);
    logger.info('test');
    await flushPromises();
    expect(insertedRows[0]).toMatchObject({
      entity_type: 'experiment',
      run_id: null,
      experiment_id: 'exp-1',
    });
  });

  it('run_id is NULL when entity_type is strategy', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createEntityLogger({
      entityType: 'strategy',
      entityId: 'strat-1',
      strategyId: 'strat-1',
    }, db);
    logger.info('test');
    await flushPromises();
    expect(insertedRows[0]).toMatchObject({
      entity_type: 'strategy',
      run_id: null,
      experiment_id: null,
    });
  });

  it('invocation entity includes all ancestor FKs', async () => {
    const { db, insertedRows } = makeMockSupabase();
    const logger = createEntityLogger({
      entityType: 'invocation',
      entityId: 'inv-1',
      runId: 'run-1',
      experimentId: 'exp-1',
      strategyId: 'strat-1',
    }, db);
    logger.info('test');
    await flushPromises();
    expect(insertedRows[0]).toMatchObject({
      entity_type: 'invocation',
      entity_id: 'inv-1',
      run_id: 'run-1',
      experiment_id: 'exp-1',
      strategy_id: 'strat-1',
    });
  });

  describe('EVOLUTION_LOG_LEVEL filtering', () => {
    const originalEnv = process.env.EVOLUTION_LOG_LEVEL;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.EVOLUTION_LOG_LEVEL;
      } else {
        process.env.EVOLUTION_LOG_LEVEL = originalEnv;
      }
    });

    it('skips info when EVOLUTION_LOG_LEVEL=warn', async () => {
      process.env.EVOLUTION_LOG_LEVEL = 'warn';
      const { db, insertedRows } = makeMockSupabase();
      const logger = createEntityLogger(runCtx, db);
      logger.info('should be skipped');
      logger.debug('also skipped');
      await new Promise((r) => setTimeout(r, 10));
      expect(insertedRows).toHaveLength(0);
    });

    it('still logs warn when EVOLUTION_LOG_LEVEL=warn', async () => {
      process.env.EVOLUTION_LOG_LEVEL = 'warn';
      const { db, insertedRows } = makeMockSupabase();
      const logger = createEntityLogger(runCtx, db);
      logger.warn('should log');
      logger.error('should also log');
      await new Promise((r) => setTimeout(r, 10));
      expect(insertedRows).toHaveLength(2);
      expect(insertedRows[0]).toMatchObject({ level: 'warn' });
      expect(insertedRows[1]).toMatchObject({ level: 'error' });
    });

    it('logs all levels when env var is unset', async () => {
      delete process.env.EVOLUTION_LOG_LEVEL;
      const { db, insertedRows } = makeMockSupabase();
      const logger = createEntityLogger(runCtx, db);
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      await new Promise((r) => setTimeout(r, 10));
      expect(insertedRows).toHaveLength(4);
    });
  });
});
