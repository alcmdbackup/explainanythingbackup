/**
 * Mock for @supabase/ssr
 * Provides mock implementations of createBrowserClient and createServerClient
 */

/**
 * Mock auth object with all necessary methods for Phase 9 testing
 */
export const createMockAuth = () => ({
  getUser: jest.fn().mockResolvedValue({
    data: {
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        aud: 'authenticated',
        role: 'authenticated',
      },
    },
    error: null,
  }),
  getSession: jest.fn().mockResolvedValue({
    data: {
      session: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        user: {
          id: 'test-user-id',
          email: 'test@example.com',
        },
      },
    },
    error: null,
  }),
  signInWithPassword: jest.fn().mockResolvedValue({
    data: {
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
      },
      session: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
      },
    },
    error: null,
  }),
  signUp: jest.fn().mockResolvedValue({
    data: {
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
      },
      session: null,
    },
    error: null,
  }),
  signOut: jest.fn().mockResolvedValue({
    error: null,
  }),
  onAuthStateChange: jest.fn().mockReturnValue({
    data: {
      subscription: {
        unsubscribe: jest.fn(),
      },
    },
  }),
  exchangeCodeForSession: jest.fn().mockResolvedValue({
    data: {
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
      },
      session: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
      },
    },
    error: null,
  }),
  verifyOtp: jest.fn().mockResolvedValue({
    data: {
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
      },
      session: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
      },
    },
    error: null,
  }),
});

export const createBrowserClient = jest.fn(() => ({
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  auth: createMockAuth(),
}));

export const createServerClient = jest.fn((url, key, options) => ({
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  auth: createMockAuth(),
  // Store the cookies config for testing
  _cookiesConfig: options?.cookies,
}));
