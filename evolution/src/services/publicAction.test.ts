/**
 * @jest-environment node
 */
// Unit tests for publicAction factory (Phase 1 of build_website_for_evolutiOn_20260626).
// Mirror of adminAction shape but without requireAdmin.

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({ from: jest.fn() }),
}));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn,
}));
jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn,
}));

import { publicAction } from './publicAction';

describe('publicAction', () => {
  it('zero-arg handler — passes ctx through, returns success envelope', async () => {
    const action = publicAction('zeroArg', async (ctx) => {
      expect(ctx.supabase).toBeDefined();
      return { value: 42 };
    });
    const result = await action();
    expect(result).toEqual({ success: true, data: { value: 42 }, error: null });
  });

  it('one-arg handler — input + ctx threaded through', async () => {
    const action = publicAction<{ x: number }, number>('oneArg', async (input, ctx) => {
      expect(ctx.supabase).toBeDefined();
      return input.x * 2;
    });
    const result = await action({ x: 21 });
    expect(result).toEqual({ success: true, data: 42, error: null });
  });

  it('wraps thrown errors in the ActionResult error envelope', async () => {
    const action = publicAction('thrower', async () => {
      throw new Error('boom');
    });
    const result = await action();
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
  });
});
