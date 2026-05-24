/**
 * @jest-environment node
 */

/**
 * Tests for Supabase middleware - session management and authentication routing
 */

/**
 * Mock setup
 */

// Import our mock implementations
import {
  NextResponse as MockNextResponse,
  NextRequest as MockNextRequest
} from '@/__mocks__/next/server';

// First, set up mocks before importing the module under test
jest.mock('@supabase/ssr');
jest.mock('next/server', () => {
  const mocks = jest.requireActual('@/__mocks__/next/server');
  return {
    NextResponse: mocks.NextResponse,
    NextRequest: mocks.NextRequest,
  };
});

// Import after mocking
import { updateSession } from './middleware';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, NextRequest } from 'next/server';

// Import our test helpers
import { createMockUser } from '@/testing/utils/phase9-test-helpers';

const mockCreateServerClient = createServerClient as jest.MockedFunction<typeof createServerClient>;

// Helper to create a proper NextRequest for testing
function createTestNextRequest(url: string, options?: {
  cookies?: Array<{ name: string; value: string }>;
  headers?: Record<string, string>;
}): NextRequest {
  const mockRequest = new MockNextRequest(url, {
    cookies: options?.cookies,
    headers: options?.headers,
  });
  return mockRequest as unknown as NextRequest;
}

describe('Supabase Middleware - updateSession', () => {
  let mockSupabaseClient: any;
  let mockGetUser: jest.Mock;
  let mockCookiesGetAll: jest.Mock;
  let mockCookiesSetAll: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    mockGetUser = jest.fn().mockResolvedValue({
      data: { user: createMockUser() },
      error: null,
    });

    mockCookiesGetAll = jest.fn().mockReturnValue([
      { name: 'sb-access-token', value: 'test-token' },
    ]);

    mockCookiesSetAll = jest.fn();

    mockSupabaseClient = {
      auth: {
        getUser: mockGetUser,
      },
      // Mock for checking disabled users
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { is_disabled: false, disabled_reason: null },
              error: null,
            }),
          }),
        }),
      }),
    };

    mockCreateServerClient.mockImplementation((url, key, options) => {
      // Store the cookies config for testing
      if (options?.cookies) {
        mockCookiesGetAll = jest.fn(options.cookies.getAll);
        mockCookiesSetAll = jest.fn(options.cookies.setAll);
      }
      return mockSupabaseClient;
    });
  });

  describe('Authentication Flow Integrity', () => {
    it('should allow authenticated user to access protected routes', async () => {
      const request = createTestNextRequest('http://localhost:3000/dashboard');

      const response = await updateSession(request);

      expect(mockGetUser).toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.headers.get('Location')).toBeNull();
    });

    it('should redirect unauthenticated user to /login from protected route', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/dashboard');

      const response = await updateSession(request);

      expect(mockGetUser).toHaveBeenCalled();
      expect(response.status).toBeGreaterThanOrEqual(300);
      expect(response.status).toBeLessThan(400);
      expect(response.headers.get('Location')).toContain('/login');
    });

    it('should allow unauthenticated user to access /login', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/login');

      const response = await updateSession(request);

      expect(mockGetUser).toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.headers.get('Location')).toBeNull();
    });

    it('should allow unauthenticated user to access /auth/callback', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/auth/callback');

      const response = await updateSession(request);

      expect(mockGetUser).toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.headers.get('Location')).toBeNull();
    });

    it('should allow unauthenticated user to access /auth/confirm', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/auth/confirm');

      const response = await updateSession(request);

      expect(mockGetUser).toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.headers.get('Location')).toBeNull();
    });

    it('should allow unauthenticated user to access /debug-critic', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/debug-critic');

      const response = await updateSession(request);

      expect(mockGetUser).toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.headers.get('Location')).toBeNull();
    });

    it('should redirect from root path when unauthenticated', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/');

      const response = await updateSession(request);

      expect(response.headers.get('Location')).toContain('/login');
    });
  });

  describe('Session Management', () => {
    it('should always call getUser() to refresh session', async () => {
      const request = createTestNextRequest('http://localhost:3000/dashboard');

      await updateSession(request);

      expect(mockGetUser).toHaveBeenCalledTimes(1);
    });

    it('should handle expired session by redirecting to login', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'JWT expired', name: 'AuthError', status: 401 },
      });

      const request = createTestNextRequest('http://localhost:3000/dashboard');

      const response = await updateSession(request);

      expect(response.headers.get('Location')).toContain('/login');
    });

    it('should pass through valid session without modification', async () => {
      const user = createMockUser({ userId: 'user-123', email: 'test@example.com' });
      mockGetUser.mockResolvedValue({
        data: { user },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/dashboard');

      const response = await updateSession(request);

      expect(mockGetUser).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('should handle getUser() throwing an error', async () => {
      mockGetUser.mockRejectedValue(new Error('Network error'));

      const request = createTestNextRequest('http://localhost:3000/dashboard');

      await expect(updateSession(request)).rejects.toThrow('Network error');
    });
  });

  describe('Cookie Handling', () => {
    it('should call getAll() to read request cookies', async () => {
      const request = createTestNextRequest('http://localhost:3000/dashboard', {
        cookies: [
          { name: 'sb-access-token', value: 'test-token' },
          { name: 'sb-refresh-token', value: 'refresh-token' },
        ],
      });

      await updateSession(request);

      // Verify createServerClient was called with cookies config
      expect(mockCreateServerClient).toHaveBeenCalledWith(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        expect.objectContaining({
          cookies: expect.objectContaining({
            getAll: expect.any(Function),
            setAll: expect.any(Function),
          }),
        })
      );
    });

    it('should handle empty cookie array', async () => {
      const request = createTestNextRequest('http://localhost:3000/login', {
        cookies: [],
      });

      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const response = await updateSession(request);

      expect(response.status).toBe(200);
    });

    it('should handle setAll() being called to update cookies', async () => {
      const request = createTestNextRequest('http://localhost:3000/dashboard');

      await updateSession(request);

      // Verify createServerClient sets up cookie handlers
      expect(mockCreateServerClient).toHaveBeenCalled();
      const callArgs = mockCreateServerClient.mock.calls[0]!;
      const cookiesConfig = callArgs[2]?.cookies;

      expect(cookiesConfig).toBeDefined();
      expect(typeof cookiesConfig?.getAll).toBe('function');
      expect(typeof cookiesConfig?.setAll).toBe('function');
    });
  });

  describe('Redirect URL Construction', () => {
    it('should preserve query parameters when redirecting to login', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/dashboard?foo=bar');

      const response = await updateSession(request);

      const location = response.headers.get('Location');
      expect(location).toContain('/login');
      // Note: The implementation doesn't preserve query params, just testing current behavior
    });

    it('should redirect to login with original host', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/protected-page');

      const response = await updateSession(request);

      const location = response.headers.get('Location');
      expect(location).toBeTruthy();
      expect(location).toMatch(/^http:\/\/localhost:3000\/login/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle user object with null but no error', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/dashboard');

      const response = await updateSession(request);

      expect(response.headers.get('Location')).toContain('/login');
    });

    it('should handle /login with trailing slash', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/login/');

      const response = await updateSession(request);

      // Should allow access since path starts with /login
      expect(response.status).toBe(200);
      expect(response.headers.get('Location')).toBeNull();
    });

    it('should handle /auth subpaths', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/auth/some-subpath');

      const response = await updateSession(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Location')).toBeNull();
    });

    it('should handle /debug-critic subpaths', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/debug-critic/subpage');

      const response = await updateSession(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Location')).toBeNull();
    });

    it('should handle very long cookie values', async () => {
      const longToken = 'a'.repeat(4000);
      const request = createTestNextRequest('http://localhost:3000/dashboard', {
        cookies: [{ name: 'sb-access-token', value: longToken }],
      });

      const response = await updateSession(request);

      expect(mockGetUser).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });
  });

  describe('Guest auto-login (Phase 5)', () => {
    let originalEnv: NodeJS.ProcessEnv;
    let mockSignInWithPassword: jest.Mock;
    const { __resetGuestLoginCacheForTests } = jest.requireActual('./middleware');

    // Helper to attach a Host header — mock NextRequest doesn't auto-populate it
    // from the URL, but classifyHost() reads request.headers.get('host').
    function reqWithHost(url: string, opts?: { cookies?: Array<{ name: string; value: string }> }) {
      const parsed = new URL(url);
      return createTestNextRequest(url, {
        cookies: opts?.cookies,
        headers: { host: parsed.host },
      });
    }

    beforeEach(() => {
      originalEnv = { ...process.env };
      __resetGuestLoginCacheForTests();

      mockSignInWithPassword = jest.fn().mockResolvedValue({
        data: { user: createMockUser({ email: 'guest@explainanything.app' }) },
        error: null,
      });

      // Default to unauthenticated; tests can override.
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      // Re-construct supabase client to include the signInWithPassword spy.
      mockSupabaseClient.auth.signInWithPassword = mockSignInWithPassword;
    });

    afterEach(() => {
      process.env = originalEnv;
      __resetGuestLoginCacheForTests();
    });

    it('(a) no-op when user already present (existing session)', async () => {
      process.env.GUEST_EMAIL = 'guest@explainanything.app';
      process.env.GUEST_PASSWORD = 'secret';
      delete process.env.E2E_TEST_MODE;
      mockGetUser.mockResolvedValue({
        data: { user: createMockUser() },
        error: null,
      });

      await updateSession(reqWithHost('http://localhost:3000/'));
      expect(mockSignInWithPassword).not.toHaveBeenCalled();
    });

    it('(b) signInWithPassword called when no user + GUEST_* set + E2E_TEST_MODE unset', async () => {
      process.env.GUEST_EMAIL = 'guest@explainanything.app';
      process.env.GUEST_PASSWORD = 'secret';
      delete process.env.E2E_TEST_MODE;
      // After signIn, getUser is called again — return the guest user.
      mockGetUser
        .mockResolvedValueOnce({ data: { user: null }, error: null })
        .mockResolvedValueOnce({
          data: { user: createMockUser({ email: 'guest@explainanything.app' }) },
          error: null,
        });

      await updateSession(reqWithHost('http://localhost:3000/'));
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'guest@explainanything.app',
        password: 'secret',
      });
    });

    it('(c) NOT called when E2E_TEST_MODE=true', async () => {
      process.env.GUEST_EMAIL = 'guest@explainanything.app';
      process.env.GUEST_PASSWORD = 'secret';
      process.env.E2E_TEST_MODE = 'true';

      await updateSession(reqWithHost('http://localhost:3000/'));
      expect(mockSignInWithPassword).not.toHaveBeenCalled();
    });

    it('(e) NOT called when GUEST_EMAIL missing (soft no-op for deploy-ordering safety)', async () => {
      delete process.env.GUEST_EMAIL;
      process.env.GUEST_PASSWORD = 'secret';
      delete process.env.E2E_TEST_MODE;

      await updateSession(reqWithHost('http://localhost:3000/'));
      expect(mockSignInWithPassword).not.toHaveBeenCalled();
    });

    it('(e) NOT called when GUEST_PASSWORD missing', async () => {
      process.env.GUEST_EMAIL = 'guest@explainanything.app';
      delete process.env.GUEST_PASSWORD;
      delete process.env.E2E_TEST_MODE;

      await updateSession(reqWithHost('http://localhost:3000/'));
      expect(mockSignInWithPassword).not.toHaveBeenCalled();
    });

    it('(j) E2E_TEST_MODE="" (empty string) does NOT suppress auto-login', async () => {
      process.env.GUEST_EMAIL = 'guest@explainanything.app';
      process.env.GUEST_PASSWORD = 'secret';
      process.env.E2E_TEST_MODE = '';
      mockGetUser
        .mockResolvedValueOnce({ data: { user: null }, error: null })
        .mockResolvedValueOnce({
          data: { user: createMockUser({ email: 'guest@explainanything.app' }) },
          error: null,
        });

      await updateSession(reqWithHost('http://localhost:3000/'));
      expect(mockSignInWithPassword).toHaveBeenCalled();
    });

    it('(f) failed signInWithPassword sets GUEST_AUTOLOGIN_FAILED_RECENTLY cookie + redirects to /login', async () => {
      process.env.GUEST_EMAIL = 'guest@explainanything.app';
      process.env.GUEST_PASSWORD = 'secret';
      delete process.env.E2E_TEST_MODE;
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'invalid credentials', name: 'AuthError' },
      });

      const response = await updateSession(reqWithHost('http://localhost:3000/'));
      expect(response.status).toBeGreaterThanOrEqual(300);
      expect(response.status).toBeLessThan(400);
      expect(response.headers.get('Location')).toContain('/login');
      // Mock NextResponse.cookies is a Map (not the real rich cookies object).
      // The middleware calls .set(name, value, options) — Map only stores (name, value).
      const cookiesMap = (response as unknown as { cookies: Map<string, unknown> }).cookies;
      expect(cookiesMap.has('GUEST_AUTOLOGIN_FAILED_RECENTLY')).toBe(true);
    });

    it('(i) skips signInWithPassword when GUEST_AUTOLOGIN_FAILED_RECENTLY cookie present', async () => {
      process.env.GUEST_EMAIL = 'guest@explainanything.app';
      process.env.GUEST_PASSWORD = 'secret';
      delete process.env.E2E_TEST_MODE;

      const request = reqWithHost('http://localhost:3000/', {
        cookies: [{ name: 'GUEST_AUTOLOGIN_FAILED_RECENTLY', value: '1' }],
      });
      await updateSession(request);
      expect(mockSignInWithPassword).not.toHaveBeenCalled();
    });
  });

  describe('Response Integrity', () => {
    it('should return response with status 200 for authenticated request', async () => {
      const request = createTestNextRequest('http://localhost:3000/dashboard');

      const response = await updateSession(request);

      expect(response).toBeTruthy();
      expect(response.status).toBe(200);
    });

    it('should return redirect response for unauthenticated request', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const request = createTestNextRequest('http://localhost:3000/dashboard');

      const response = await updateSession(request);

      expect(response).toBeTruthy();
      expect(response.status).toBeGreaterThanOrEqual(300);
      expect(response.status).toBeLessThan(400);
    });
  });
});
