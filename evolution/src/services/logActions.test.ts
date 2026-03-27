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
    chain.ilike = jest.fn(() => chain);
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

  it('applies variantId filter with .eq(variant_id)', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'run', entityId: 'a0000000-0000-0000-0000-000000000001', filters: { variantId: 'v-123' } }, ctx);
    expect(chainMethods.eq).toHaveBeenCalledWith('variant_id', 'v-123');
  });

  it('applies messageSearch filter with .ilike(message)', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'run', entityId: 'a0000000-0000-0000-0000-000000000001', filters: { messageSearch: 'seed' } }, ctx);
    expect(chainMethods.ilike).toHaveBeenCalledWith('message', '%seed%');
  });

  it('applies agentName filter', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'run', entityId: 'a0000000-0000-0000-0000-000000000001', filters: { agentName: 'GenerationAgent' } }, ctx);
    expect(chainMethods.eq).toHaveBeenCalledWith('agent_name', 'GenerationAgent');
  });

  it('applies entityType filter', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'run', entityId: 'a0000000-0000-0000-0000-000000000001', filters: { entityType: 'experiment' } }, ctx);
    expect(chainMethods.eq).toHaveBeenCalledWith('entity_type', 'experiment');
  });

  it('applies iteration filter', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'run', entityId: 'a0000000-0000-0000-0000-000000000001', filters: { iteration: 3 } }, ctx);
    expect(chainMethods.eq).toHaveBeenCalledWith('iteration', 3);
  });

  it('returns empty items and zero total when no logs match', async () => {
    const { ctx } = makeMockCtx([], 0);
    const result = await handler({ entityType: 'run', entityId: 'a0000000-0000-0000-0000-000000000001' }, ctx);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('applies multiple filters simultaneously', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({
      entityType: 'run',
      entityId: 'a0000000-0000-0000-0000-000000000001',
      filters: { level: 'warn', agentName: 'RankingAgent', iteration: 2, variantId: 'v-1' },
    }, ctx);
    expect(chainMethods.eq).toHaveBeenCalledWith('level', 'warn');
    expect(chainMethods.eq).toHaveBeenCalledWith('agent_name', 'RankingAgent');
    expect(chainMethods.eq).toHaveBeenCalledWith('iteration', 2);
    expect(chainMethods.eq).toHaveBeenCalledWith('variant_id', 'v-1');
  });

  it('clamps limit to maximum 200', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'run', entityId: 'a0000000-0000-0000-0000-000000000001', filters: { limit: 500 } }, ctx);
    // limit clamped to 200, offset defaults to 0 → range(0, 199)
    expect(chainMethods.range).toHaveBeenCalledWith(0, 199);
  });

  it('escapes SQL LIKE wildcards in messageSearch', async () => {
    const { ctx, chainMethods } = makeMockCtx();
    await handler({ entityType: 'run', entityId: 'a0000000-0000-0000-0000-000000000001', filters: { messageSearch: '100%_done' } }, ctx);
    expect(chainMethods.ilike).toHaveBeenCalledWith('message', '%100\\%\\_done%');
  });
});
