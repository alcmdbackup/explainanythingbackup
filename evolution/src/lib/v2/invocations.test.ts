// Tests for V2 invocation DB helpers.

import { createInvocation, updateInvocation } from './invocations';

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
                return { data: { id: 'inv-uuid-123' }, error: null };
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
    const id = await createInvocation(db, 'run-1', 1, 'generation', 1);
    expect(id).toBe('inv-uuid-123');
    expect(insertedRows[0]).toMatchObject({
      run_id: 'run-1',
      agent_name: 'generation',
      iteration: 1,
      execution_order: 1,
    });
  });

  it('DB error swallowed, returns null', async () => {
    const { db } = makeMockDb({ insertError: 'DB down' });
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    const id = await createInvocation(db, 'run-1', 1, 'gen', 1);
    expect(id).toBeNull();
    spy.mockRestore();
  });
});

describe('updateInvocation', () => {
  it('sets success=true and cost_usd', async () => {
    const { db, updatedRows } = makeMockDb();
    await updateInvocation(db, 'inv-1', { cost_usd: 0.05, success: true });
    expect(updatedRows[0]).toMatchObject({ cost_usd: 0.05, success: true });
  });

  it('sets success=false with error_message on failure', async () => {
    const { db, updatedRows } = makeMockDb();
    await updateInvocation(db, 'inv-1', {
      cost_usd: 0.02,
      success: false,
      error_message: 'Budget exceeded',
    });
    expect(updatedRows[0]).toMatchObject({ success: false, error_message: 'Budget exceeded' });
  });

  it('DB error swallowed', async () => {
    const { db } = makeMockDb({ updateError: 'DB down' });
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    await updateInvocation(db, 'inv-1', { cost_usd: 0, success: true });
    spy.mockRestore();
    // No throw
  });

  it('null id is no-op', async () => {
    const { db } = makeMockDb();
    await updateInvocation(db, null, { cost_usd: 0, success: true });
    expect(db.from).not.toHaveBeenCalled();
  });
});
