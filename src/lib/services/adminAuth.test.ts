/**
 * Unit tests for adminAuth service.
 * Tests admin authentication and authorization logic, including the hostname
 * assertion added for the explainanything/evolution website split.
 */

import { isUserAdmin, requireAdmin, getAdminUser } from './adminAuth';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { headers } from 'next/headers';
import { PROD_PUBLIC_HOST, PROD_EVOLUTION_HOST } from '@/config/hostnames';

// Mock dependencies
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn()
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

// next/headers throws outside a request context in real Next.js. Default the
// mock to throw too so existing tests behave the same as before (they go
// through the catch path → host check is treated as "not in request context"
// → permissive). Per-test, override to return a Headers object.
jest.mock('next/headers', () => ({
  headers: jest.fn().mockImplementation(() => {
    throw new Error('headers() outside request context');
  })
}));

const mockHeaders = headers as jest.MockedFunction<typeof headers>;

function setHostHeader(host: string | null): void {
  const h = new Headers(host ? { host } : {});
  mockHeaders.mockResolvedValue(h as unknown as Awaited<ReturnType<typeof headers>>);
}

describe('AdminAuth Service', () => {
  let mockSupabase: {
    auth: { getUser: jest.Mock };
    from: jest.Mock;
    select: jest.Mock;
    eq: jest.Mock;
    limit: jest.Mock;
  };
  const mockLogger = logger as jest.Mocked<typeof logger>;
  const originalVercelEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.VERCEL_ENV;

    // Default headers() to throw (non-request context). Per-test overrides flip this.
    mockHeaders.mockImplementation(() => {
      throw new Error('headers() outside request context');
    });

    // Create mock Supabase client with chainable methods
    mockSupabase = {
      auth: {
        getUser: jest.fn()
      },
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn()
    };

    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  afterAll(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  });

  describe('isUserAdmin', () => {
    it('should return true when user is authenticated and has admin record', async () => {
      const mockUser = { id: 'user-123', email: 'admin@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSupabase.limit.mockResolvedValue({ data: [{ id: 1 }], error: null });

      const result = await isUserAdmin();

      expect(result).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('admin_users');
      expect(mockSupabase.eq).toHaveBeenCalledWith('user_id', 'user-123');
    });

    it('should return false when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

      const result = await isUserAdmin();

      expect(result).toBe(false);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should return false when user has no admin record', async () => {
      const mockUser = { id: 'user-123', email: 'regular@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSupabase.limit.mockResolvedValue({ data: [], error: null });

      const result = await isUserAdmin();

      expect(result).toBe(false);
    });

    it('should return false and log error when database query fails', async () => {
      const mockUser = { id: 'user-123', email: 'admin@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSupabase.limit.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      const result = await isUserAdmin();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error checking admin status',
        expect.objectContaining({ userId: 'user-123' })
      );
    });

    it('should return false when exception is thrown', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Network error'));

      const result = await isUserAdmin();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Exception in isUserAdmin',
        expect.any(Object)
      );
    });

    describe('hostname assertion', () => {
      it('returns false when called from the public host even with a valid admin', async () => {
        setHostHeader(PROD_PUBLIC_HOST);
        const mockUser = { id: 'admin-1', email: 'admin@example.com' };
        mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
        mockSupabase.limit.mockResolvedValue({ data: [{ id: 1 }], error: null });

        const result = await isUserAdmin();

        expect(result).toBe(false);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Admin access attempted from non-evolution host',
          expect.objectContaining({ tier: 'public' })
        );
        // Should short-circuit before querying admin_users
        expect(mockSupabase.from).not.toHaveBeenCalled();
      });

      it('returns true on the evolution host with a valid admin', async () => {
        setHostHeader(PROD_EVOLUTION_HOST);
        const mockUser = { id: 'admin-1', email: 'admin@example.com' };
        mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
        mockSupabase.limit.mockResolvedValue({ data: [{ id: 1 }], error: null });

        const result = await isUserAdmin();

        expect(result).toBe(true);
      });

      it('returns true on localhost with a valid admin', async () => {
        setHostHeader('localhost:3008');
        const mockUser = { id: 'admin-1', email: 'admin@example.com' };
        mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
        mockSupabase.limit.mockResolvedValue({ data: [{ id: 1 }], error: null });

        const result = await isUserAdmin();

        expect(result).toBe(true);
      });

      it('returns false for unknown host (suffix-extension attempt)', async () => {
        setHostHeader(`${PROD_EVOLUTION_HOST}.attacker.com`);
        const mockUser = { id: 'admin-1', email: 'admin@example.com' };
        mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
        mockSupabase.limit.mockResolvedValue({ data: [{ id: 1 }], error: null });

        const result = await isUserAdmin();

        expect(result).toBe(false);
      });

      it('returns true on a preview deployment with a valid admin', async () => {
        process.env.VERCEL_ENV = 'preview';
        setHostHeader('feat-branch-explainanything-team.vercel.app');
        const mockUser = { id: 'admin-1', email: 'admin@example.com' };
        mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
        mockSupabase.limit.mockResolvedValue({ data: [{ id: 1 }], error: null });

        const result = await isUserAdmin();

        expect(result).toBe(true);
      });
    });
  });

  describe('requireAdmin', () => {
    it('should return user ID when user is authenticated admin', async () => {
      const mockUser = { id: 'admin-user-456', email: 'admin@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSupabase.limit.mockResolvedValue({ data: [{ id: 1 }], error: null });

      const result = await requireAdmin();

      expect(result).toBe('admin-user-456');
    });

    it('should throw error when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

      await expect(requireAdmin()).rejects.toThrow('Unauthorized: Not authenticated');
    });

    it('should throw error when user is not an admin', async () => {
      const mockUser = { id: 'user-123', email: 'regular@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSupabase.limit.mockResolvedValue({ data: [], error: null });

      await expect(requireAdmin()).rejects.toThrow('Unauthorized: Not an admin');
    });

    it('should throw error when database query fails', async () => {
      const mockUser = { id: 'user-123', email: 'admin@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSupabase.limit.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      await expect(requireAdmin()).rejects.toThrow('Unauthorized: Failed to verify admin status');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    describe('hostname assertion', () => {
      it('throws when called from the public host', async () => {
        setHostHeader(PROD_PUBLIC_HOST);

        await expect(requireAdmin()).rejects.toThrow(
          /not available from this hostname/i,
        );
        expect(mockSupabase.from).not.toHaveBeenCalled();
      });

      it('passes on the evolution host with a valid admin', async () => {
        setHostHeader(PROD_EVOLUTION_HOST);
        const mockUser = { id: 'admin-user', email: 'admin@example.com' };
        mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
        mockSupabase.limit.mockResolvedValue({ data: [{ id: 1 }], error: null });

        const result = await requireAdmin();

        expect(result).toBe('admin-user');
      });

      it('passes when called outside a request context (headers() throws)', async () => {
        // Default mock already throws — represents minicomputer batch runner or build-time.
        const mockUser = { id: 'admin-user', email: 'admin@example.com' };
        mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
        mockSupabase.limit.mockResolvedValue({ data: [{ id: 1 }], error: null });

        const result = await requireAdmin();

        expect(result).toBe('admin-user');
      });

      it('throws on an unknown host', async () => {
        setHostHeader('attacker.com');

        await expect(requireAdmin()).rejects.toThrow(/not available from this hostname/i);
      });
    });
  });

  describe('getAdminUser', () => {
    it('should return admin user record when user is admin', async () => {
      const mockUser = { id: 'admin-user-789', email: 'admin@example.com' };
      const mockAdminRecord = {
        id: 1,
        user_id: 'admin-user-789',
        role: 'admin',
        created_at: '2024-01-01T00:00:00Z',
        created_by: null
      };
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSupabase.limit.mockResolvedValue({ data: [mockAdminRecord], error: null });

      const result = await getAdminUser();

      expect(result).toEqual(mockAdminRecord);
    });

    it('should return null when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

      const result = await getAdminUser();

      expect(result).toBeNull();
    });

    it('should return null when user is not an admin', async () => {
      const mockUser = { id: 'user-123', email: 'regular@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSupabase.limit.mockResolvedValue({ data: [], error: null });

      const result = await getAdminUser();

      expect(result).toBeNull();
    });

    it('should return null and log error when exception occurs', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Network error'));

      const result = await getAdminUser();

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Exception in getAdminUser',
        expect.any(Object)
      );
    });

    it('returns null from the public host', async () => {
      setHostHeader(PROD_PUBLIC_HOST);

      const result = await getAdminUser();

      expect(result).toBeNull();
    });
  });
});
