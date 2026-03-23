// Tests for multi-entity log query actions.

// Mock adminAction to extract the handler for direct testing
jest.mock('./adminAction', () => ({
  adminAction: (_name: string, handler: Function) => handler,
}));
jest.mock('./shared', () => ({
  validateUuid: (id: string) => /^[0-9a-f]{8}-/.test(id),
}));

import { getEntityLogsAction } from './logActions';

function makeMockCtx(returnData: unknown[] = [], count = 0) {
  const chainMethods: Record<string, jest.Mock> = {};

  const createChain = (): Record<string, jest.Mock> => {
    const chain: Record<string, jest.Mock> = {};
    chain.select = jest.fn(() => chain);
    chain.eq = jest.fn(() => chain);
    chain.order = jest.fn(() => chain);
    chain.range = jest.fn(() => Promise.resolve({ data: returnData, error: null, count }));
    return chain;
  };

  const chain = createChain();
  Object.assign(chainMethods, chain);

  return {
    ctx: {
      supabase: {
        from: jest.fn(() => chainMethods),
      },
      adminUserId: 'admin-1',
    },
    chainMethods,
  };
}

describe('getEntityLogsAction', () => {
  const handler = getEntityLogsAction as unknown as (
    args: { entityType: string; entityId: string; filters?: Record<string, unknown> },
    ctx: { supabase: unknown; adminUserId: string },
  ) => Promise<{ items: unknown[]; total: number }>;

  it('queries by run_id for entityType=run', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'run', entityId: 'a0000000-0000-0000-0000-000000000001' }, ctx);
    expect(chainMethods.eq).toHaveBeenCalledWith('run_id', 'a0000000-0000-0000-0000-000000000001');
  });

  it('queries by experiment_id for entityType=experiment', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'experiment', entityId: 'a0000000-0000-0000-0000-000000000001' }, ctx);
    expect(chainMethods.eq).toHaveBeenCalledWith('experiment_id', 'a0000000-0000-0000-0000-000000000001');
  });

  it('queries by strategy_id for entityType=strategy', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'strategy', entityId: 'a0000000-0000-0000-0000-000000000001' }, ctx);
    expect(chainMethods.eq).toHaveBeenCalledWith('strategy_id', 'a0000000-0000-0000-0000-000000000001');
  });

  it('queries by entity_type+entity_id for entityType=invocation', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'invocation', entityId: 'a0000000-0000-0000-0000-000000000001' }, ctx);
    expect(chainMethods.eq).toHaveBeenCalledWith('entity_type', 'invocation');
    expect(chainMethods.eq).toHaveBeenCalledWith('entity_id', 'a0000000-0000-0000-0000-000000000001');
  });

  it('validates entityId as UUID', async () => {
    const { ctx } = makeMockCtx();
    await expect(handler({ entityType: 'run', entityId: 'not-a-uuid' }, ctx)).rejects.toThrow('Invalid entityId');
  });

  it('applies level filter', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'run', entityId: 'a0000000-0000-0000-0000-000000000001', filters: { level: 'error' } }, ctx);
    expect(chainMethods.eq).toHaveBeenCalledWith('level', 'error');
  });

  it('applies pagination (limit/offset)', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'run', entityId: 'a0000000-0000-0000-0000-000000000001', filters: { limit: 50, offset: 10 } }, ctx);
    expect(chainMethods.range).toHaveBeenCalledWith(10, 59);
  });
});
