// Tests for evolution invocation server actions.

// Mock adminAction to extract the handler for direct testing
jest.mock('./adminAction', () => ({
  adminAction: (_name: string, handler: (...args: unknown[]) => unknown) => handler,
}));
jest.mock('./shared', () => ({
  validateUuid: (id: string) => /^[0-9a-f]{8}-/.test(id),
}));

import { listInvocationsAction, getInvocationDetailAction } from './invocationActions';

type ListHandler = (
  args: { runId?: string; filterTestContent?: boolean; limit?: number; offset?: number },
  ctx: { supabase: unknown; adminUserId: string },
) => Promise<{ items: unknown[]; total: number }>;

type DetailHandler = (
  invocationId: string,
  ctx: { supabase: unknown; adminUserId: string },
) => Promise<unknown>;

const listHandler = listInvocationsAction as unknown as ListHandler;
const detailHandler = getInvocationDetailAction as unknown as DetailHandler;

function makeMockCtx(returnData: unknown[] = [], count = 0) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.not = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.ilike = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.range = jest.fn(() => Promise.resolve({ data: returnData, error: null, count }));
  chain.single = jest.fn(() => Promise.resolve({ data: returnData[0] ?? null, error: null }));
  // Default thenable for awaited queries without range/single
  chain.then = jest.fn((resolve: (v: unknown) => void) => resolve({ data: returnData, error: null }));
  return {
    ctx: { supabase: { from: jest.fn(() => chain) }, adminUserId: 'admin-1' },
    chain,
  };
}

function makeMockCtxWithError(errorMsg: string) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.not = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.range = jest.fn(() => Promise.resolve({ data: null, error: { message: errorMsg }, count: 0 }));
  chain.single = jest.fn(() => Promise.resolve({ data: null, error: { message: errorMsg } }));
  return {
    ctx: { supabase: { from: jest.fn(() => chain) }, adminUserId: 'admin-1' },
    chain,
  };
}

const VALID_UUID = 'a0000000-0000-0000-0000-000000000001';

describe('listInvocationsAction', () => {
  it('returns items and total from query', async () => {
    const rows = [{ id: '1', agent_name: 'gen' }];
    const { ctx } = makeMockCtx(rows, 5);
    const result = await listHandler({ limit: 10, offset: 0 }, ctx);
    expect(result).toEqual({ items: rows, total: 5 });
  });

  it('filters by runId when provided', async () => {
    const { ctx, chain } = makeMockCtx();
    await listHandler({ runId: VALID_UUID, limit: 10, offset: 0 }, ctx);
    expect(chain.eq).toHaveBeenCalledWith('run_id', VALID_UUID);
  });

  it('does not filter by runId when omitted', async () => {
    const { ctx, chain } = makeMockCtx();
    await listHandler({ limit: 10, offset: 0 }, ctx);
    expect(chain.eq).not.toHaveBeenCalled();
  });

  it('applies pagination (offset, limit)', async () => {
    const { ctx, chain } = makeMockCtx();
    await listHandler({ limit: 20, offset: 10 }, ctx);
    // range is offset to offset+limit-1
    expect(chain.range).toHaveBeenCalledWith(10, 29);
  });

  it('defaults limit=50 offset=0', async () => {
    const { ctx, chain } = makeMockCtx();
    await listHandler({}, ctx);
    expect(chain.range).toHaveBeenCalledWith(0, 49);
  });

  it('rejects invalid runId format (Zod parse error)', async () => {
    const { ctx } = makeMockCtx();
    await expect(listHandler({ runId: 'not-a-uuid', limit: 10, offset: 0 }, ctx)).rejects.toThrow();
  });

  it('rejects limit > 200', async () => {
    const { ctx } = makeMockCtx();
    await expect(listHandler({ limit: 201, offset: 0 }, ctx)).rejects.toThrow();
  });

  it('rejects negative offset', async () => {
    const { ctx } = makeMockCtx();
    await expect(listHandler({ limit: 10, offset: -1 }, ctx)).rejects.toThrow();
  });

  it('propagates DB errors', async () => {
    const { ctx } = makeMockCtxWithError('connection refused');
    await expect(listHandler({ limit: 10, offset: 0 }, ctx)).rejects.toEqual({ message: 'connection refused' });
  });

  it('filters test content by excluding test strategy run IDs', async () => {
    const { ctx, chain } = makeMockCtx([{ id: '1' }], 1);
    await listHandler({ filterTestContent: true, limit: 10, offset: 0 }, ctx);
    // Should query evolution_strategies for [TEST] names via ilike
    expect(chain.ilike).toHaveBeenCalledWith('name', '%[TEST]%');
  });

  it('does not filter test content when filterTestContent is false', async () => {
    const { ctx, chain } = makeMockCtx();
    await listHandler({ filterTestContent: false, limit: 10, offset: 0 }, ctx);
    expect(chain.not).not.toHaveBeenCalled();
  });
});

describe('getInvocationDetailAction', () => {
  it('returns full detail record', async () => {
    const detail = { id: VALID_UUID, agent_name: 'gen', success: true };
    const { ctx } = makeMockCtx([detail]);
    const result = await detailHandler(VALID_UUID, ctx);
    expect(result).toEqual(detail);
  });

  it('rejects invalid UUID', async () => {
    const { ctx } = makeMockCtx();
    await expect(detailHandler('not-valid', ctx)).rejects.toThrow('Invalid invocationId');
  });

  it('propagates DB errors', async () => {
    const { ctx } = makeMockCtxWithError('row not found');
    await expect(detailHandler(VALID_UUID, ctx)).rejects.toEqual({ message: 'row not found' });
  });
});
