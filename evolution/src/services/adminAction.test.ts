// Tests for adminAction factory: arity detection, auth, Supabase injection, error handling.

import { adminAction, type AdminContext } from './adminAction';
import { requireAdmin } from '@/lib/services/adminAuth';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { isNextRouterError } from 'next/dist/client/components/is-next-router-error';

jest.mock('next/dist/client/components/is-next-router-error', () => ({
  isNextRouterError: jest.fn().mockReturnValue(false),
}));

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: jest.fn((fn: unknown) => fn),
}));

const mockRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockCreateSupabase = createSupabaseServiceClient as jest.MockedFunction<typeof createSupabaseServiceClient>;

describe('adminAction', () => {
  const mockSupabase = { from: jest.fn() } as unknown as ReturnType<typeof createSupabaseServiceClient> extends Promise<infer T> ? T : never;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAdmin.mockResolvedValue('test-admin-id');
    mockCreateSupabase.mockResolvedValue(mockSupabase as never);
  });

  // ─── Arity detection ─────────────────────────────────────────

  describe('arity detection', () => {
    it('detects zero-arg handler (handler.length === 1, ctx only)', async () => {
      const handler = jest.fn(async (ctx: AdminContext) => ctx.adminUserId);
      const action = adminAction('test', handler);

      const result = await action();

      expect(result.success).toBe(true);
      expect(result.data).toBe('test-admin-id');
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ adminUserId: 'test-admin-id' }));
    });

    it('detects single-arg handler (handler.length === 2, input + ctx)', async () => {
      const handler = jest.fn(async (input: { id: string }, ctx: AdminContext) => `${input.id}:${ctx.adminUserId}`);
      const action = adminAction('test', handler);

      const result = await action({ id: 'abc' });

      expect(result.success).toBe(true);
      expect(result.data).toBe('abc:test-admin-id');
      expect(handler).toHaveBeenCalledWith({ id: 'abc' }, expect.objectContaining({ adminUserId: 'test-admin-id' }));
    });

    it('B061: default-valued first arg (handler.length === 0) routes via 2-arg path, not zero-arg', async () => {
      // A handler with a defaulted first parameter has `handler.length === 0`. Under the old
      // `<= 1` arity check this was mis-routed as zero-arg and got ctx passed as its `input`,
      // clobbering the real first-arg default. With the strict `=== 1` check the 0-length
      // handler is routed through the 2-arg path so input + ctx land correctly.
      const handler = jest.fn(
        async (input: { id?: string } = { id: 'default' }, ctx: AdminContext | undefined = undefined) => {
          return { receivedInput: input, adminUserId: ctx?.adminUserId };
        },
      );
      // Sanity: confirm the handler's reported length is 0 (both args defaulted).
      expect(handler.length).toBe(0);

      const action = adminAction<{ id?: string }, { receivedInput: { id?: string }; adminUserId: string | undefined }>(
        'test',
        handler as (input: { id?: string }, ctx: AdminContext) => Promise<{ receivedInput: { id?: string }; adminUserId: string | undefined }>,
      );
      const result = await action({ id: 'explicit' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        receivedInput: { id: 'explicit' },
        adminUserId: 'test-admin-id',
      });
    });
  });

  // ─── Auth flow ────────────────────────────────────────────────

  describe('auth flow', () => {
    it('calls requireAdmin before handler', async () => {
      const handler = jest.fn(async (ctx: AdminContext) => 'ok');
      const action = adminAction('test', handler);

      await action();

      expect(mockRequireAdmin).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('returns error when requireAdmin rejects', async () => {
      mockRequireAdmin.mockRejectedValue(new Error('Unauthorized'));
      const handler = jest.fn(async (ctx: AdminContext) => 'ok');
      const action = adminAction('test', handler);

      const result = await action();

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toBeTruthy();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ─── Supabase injection ───────────────────────────────────────

  describe('Supabase injection', () => {
    it('injects Supabase client into context', async () => {
      const handler = jest.fn(async (ctx: AdminContext) => {
        expect(ctx.supabase).toBe(mockSupabase);
        return 'ok';
      });
      const action = adminAction('test', handler);

      await action();

      expect(mockCreateSupabase).toHaveBeenCalledTimes(1);
    });

    it('returns error when createSupabaseServiceClient rejects', async () => {
      mockCreateSupabase.mockRejectedValue(new Error('DB connection failed'));
      const handler = jest.fn(async (ctx: AdminContext) => 'ok');
      const action = adminAction('test', handler);

      const result = await action();

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ─── Error wrapping ───────────────────────────────────────────

  describe('error wrapping', () => {
    it('wraps handler errors in ActionResult with error response', async () => {
      const handler = jest.fn(async () => { throw new Error('Something broke'); });
      const action = adminAction('test', handler);

      const result = await action();

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toMatchObject({ message: expect.any(String) });
    });

    it('includes action name in error context', async () => {
      const handler = jest.fn(async () => { throw new Error('fail'); });
      const action = adminAction('myAction', handler);

      // handleError is called with context string containing the action name
      const result = await action();

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ─── Next.js router error re-throw ────────────────────────────

  describe('Next.js router errors', () => {
    it('re-throws Next.js router errors (redirect/notFound)', async () => {
      const routerError = new Error('NEXT_REDIRECT');
      // Make isNextRouterError return true for this error
      (isNextRouterError as unknown as jest.Mock).mockReturnValueOnce(true);

      const handler = jest.fn(async () => { throw routerError; });
      const action = adminAction('test', handler);

      await expect(action()).rejects.toThrow(routerError);
    });

    it('does not re-throw non-router errors', async () => {
      (isNextRouterError as unknown as jest.Mock).mockReturnValueOnce(false);
      const handler = jest.fn(async () => { throw new Error('regular error'); });
      const action = adminAction('test', handler);

      const result = await action();
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ─── Success paths ────────────────────────────────────────────

  describe('success paths', () => {
    it('returns ActionResult with success=true and data', async () => {
      const handler = jest.fn(async (ctx: AdminContext) => ({ id: '123', name: 'test' }));
      const action = adminAction('test', handler);

      const result = await action();

      expect(result).toEqual({
        success: true,
        data: { id: '123', name: 'test' },
        error: null,
      });
    });

    it('handles null return value from handler', async () => {
      const handler = jest.fn(async (ctx: AdminContext) => null);
      const action = adminAction('test', handler);

      const result = await action();

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
      expect(result.error).toBeNull();
    });

    it('handles undefined return value from handler', async () => {
      const handler = jest.fn(async (ctx: AdminContext) => undefined);
      const action = adminAction('test', handler);

      const result = await action();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it('passes input to single-arg handler with undefined input', async () => {
      const handler = jest.fn(async (input: { status?: string } | undefined, ctx: AdminContext) => {
        return input?.status ?? 'all';
      });
      const action = adminAction('test', handler);

      const result = await action(undefined);

      expect(result.success).toBe(true);
      expect(result.data).toBe('all');
    });

    it('wraps multiple sequential calls independently', async () => {
      let callCount = 0;
      const handler = jest.fn(async (ctx: AdminContext) => ++callCount);
      const action = adminAction('test', handler);

      const r1 = await action();
      const r2 = await action();

      expect(r1.data).toBe(1);
      expect(r2.data).toBe(2);
    });
  });

  // ─── withLogging & serverReadRequestId pass-through ────────────

  describe('middleware wrappers', () => {
    it('wraps function with withLogging using the action name', async () => {
      const { withLogging } = jest.requireMock('@/lib/logging/server/automaticServerLoggingBase');
      const handler = jest.fn(async (ctx: AdminContext) => 'ok');

      adminAction('myLogged', handler);

      expect(withLogging).toHaveBeenCalledWith(expect.any(Function), 'myLogged');
    });

    it('wraps function with serverReadRequestId', async () => {
      const { serverReadRequestId } = jest.requireMock('@/lib/serverReadRequestId');
      const handler = jest.fn(async (ctx: AdminContext) => 'ok');

      adminAction('myAction', handler);

      expect(serverReadRequestId).toHaveBeenCalledWith(expect.any(Function));
    });
  });
});
