// Tests for V2 invocation DB helpers.

import { createInvocation, updateInvocation } from './trackInvocations';
import { createMockEntityLogger } from '../../../testing/evolution-test-helpers';

const RUN_ID = '00000000-0000-4000-8000-000000000001';
const INV_ID = '00000000-0000-4000-8000-000000000002';

function makeMockDb(options?: { insertError?: string; updateError?: string }) {
  const insertedRows: Record<string, unknown>[] = [];
  const updatedRows: Record<string, unknown>[] = [];

  return {
    db: {
      from: jest.fn(() => ({
        insert: jest.fn((row: Record<string, unknown>) => {
          insertedRows.push(row);
          return {
            select: jest.fn(() => ({
              single: jest.fn(async () => {
                if (options?.insertError) return { data: null, error: { message: options.insertError } };
                return { data: { id: INV_ID }, error: null };
              }),
            })),
          };
        }),
        update: jest.fn((row: Record<string, unknown>) => {
          updatedRows.push(row);
          return {
            eq: jest.fn(async () => {
              if (options?.updateError) return { error: { message: options.updateError } };
              return { error: null };
            }),
          };
        }),
      })),
    } as never,
    insertedRows,
    updatedRows,
  };
}

describe('createInvocation', () => {
  it('inserts correct row and returns UUID', async () => {
    const { db, insertedRows } = makeMockDb();
    const id = await createInvocation(db, RUN_ID, 1, 'generation', 1);
    expect(id).toBe(INV_ID);
    expect(insertedRows[0]).toMatchObject({
      run_id: RUN_ID,
      agent_name: 'generation',
      iteration: 1,
      execution_order: 1,
    });
  });

  it('DB error swallowed, returns null', async () => {
    const { db } = makeMockDb({ insertError: 'DB down' });
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    const id = await createInvocation(db, RUN_ID, 1, 'gen', 1);
    expect(id).toBeNull();
    spy.mockRestore();
  });

  it('DB error calls logger.warn when logger provided', async () => {
    const { db } = makeMockDb({ insertError: 'DB down' });
    const { logger } = createMockEntityLogger();
    const id = await createInvocation(db, RUN_ID, 1, 'gen', 1, logger);
    expect(id).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'createInvocation error',
      expect.objectContaining({ phaseName: 'gen', error: 'DB down' }),
    );
  });

  it('DB error calls console.warn when logger NOT provided', async () => {
    const { db } = makeMockDb({ insertError: 'DB down' });
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    await createInvocation(db, RUN_ID, 1, 'gen', 1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('createInvocation error'));
    spy.mockRestore();
  });
});

describe('updateInvocation', () => {
  it('sets success=true and cost_usd', async () => {
    const { db, updatedRows } = makeMockDb();
    await updateInvocation(db, INV_ID, { cost_usd: 0.05, success: true });
    expect(updatedRows[0]).toMatchObject({ cost_usd: 0.05, success: true });
  });

  it('sets success=false with error_message on failure', async () => {
    const { db, updatedRows } = makeMockDb();
    await updateInvocation(db, INV_ID, {
      cost_usd: 0.02,
      success: false,
      error_message: 'Budget exceeded',
    });
    expect(updatedRows[0]).toMatchObject({ success: false, error_message: 'Budget exceeded' });
  });

  it('DB error swallowed', async () => {
    const { db } = makeMockDb({ updateError: 'DB down' });
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    await updateInvocation(db, INV_ID, { cost_usd: 0, success: true });
    spy.mockRestore();
    // No throw
  });

  it('null id is no-op', async () => {
    const { db, insertedRows } = makeMockDb();
    await updateInvocation(db, null, { cost_usd: 0, success: true });
    // No update should have happened (only inserts tracked, and no updates for null id)
    expect(insertedRows).toHaveLength(0);
  });

  it('DB error calls logger.warn when logger provided', async () => {
    const { db } = makeMockDb({ updateError: 'DB down' });
    const { logger } = createMockEntityLogger();
    await updateInvocation(db, INV_ID, { cost_usd: 0, success: true }, logger);
    expect(logger.warn).toHaveBeenCalledWith(
      'updateInvocation error',
      expect.objectContaining({ invocationId: INV_ID, error: 'DB down' }),
    );
  });

  it('DB error calls console.warn when logger NOT provided', async () => {
    const { db } = makeMockDb({ updateError: 'DB down' });
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    await updateInvocation(db, INV_ID, { cost_usd: 0, success: true });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('updateInvocation error'));
    spy.mockRestore();
  });

  it('passes duration_ms to DB update when provided', async () => {
    const { db, updatedRows } = makeMockDb();
    await updateInvocation(db, INV_ID, { cost_usd: 0.01, success: true, duration_ms: 1234 });
    expect(updatedRows[0]).toMatchObject({ duration_ms: 1234 });
  });

  it('omits duration_ms from DB update when not provided', async () => {
    const { db, updatedRows } = makeMockDb();
    await updateInvocation(db, INV_ID, { cost_usd: 0.01, success: true });
    expect(updatedRows[0]).not.toHaveProperty('duration_ms');
  });

  // ─── Partial-update semantics (Phase 2 of develop_reflection_and_generateFromParentArticle) ───
  // Load-bearing for the wrapper agent's pre-throw partial-detail write to survive
  // Agent.run()'s catch-path update (which omits execution_detail).

  it('omits execution_detail from DB update when not provided (preserves prior value)', async () => {
    const { db, updatedRows } = makeMockDb();
    await updateInvocation(db, INV_ID, { cost_usd: 0.01, success: true });
    expect(updatedRows[0]).not.toHaveProperty('execution_detail');
  });

  it('writes execution_detail when explicitly provided', async () => {
    const { db, updatedRows } = makeMockDb();
    const partial = { detailType: 'reflect_and_generate_from_previous_article', tactic: 'lexical_simplify' };
    await updateInvocation(db, INV_ID, { cost_usd: 0.01, success: false, execution_detail: partial });
    expect(updatedRows[0]).toMatchObject({ execution_detail: partial });
  });

  it('omits error_message from DB update when not provided (preserves prior value)', async () => {
    const { db, updatedRows } = makeMockDb();
    await updateInvocation(db, INV_ID, { cost_usd: 0.01, success: true });
    expect(updatedRows[0]).not.toHaveProperty('error_message');
  });

  it('writes error_message when explicitly provided', async () => {
    const { db, updatedRows } = makeMockDb();
    await updateInvocation(db, INV_ID, { cost_usd: 0.01, success: false, error_message: 'Budget exceeded' });
    expect(updatedRows[0]).toMatchObject({ error_message: 'Budget exceeded' });
  });
});
