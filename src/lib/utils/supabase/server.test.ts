/**
 * @jest-environment node
 */

// Mock dependencies before imports
jest.mock('@supabase/ssr');
jest.mock('next/headers');

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { mockCookieStore } from '@/__mocks__/next/headers';
import { createSupabaseServerClient } from './server';

describe('supabase/server', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Store original env and set test env vars
    originalEnv = process.env;
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    };

    // Reset all mocks
    jest.clearAllMocks();

    // Reset mock implementations
    mockCookieStore.getAll.mockReturnValue([]);
    mockCookieStore.set.mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('createSupabaseServerClient', () => {
    it('should create server client with correct env vars', async () => {
      await createSupabaseServerClient();

      expect(createServerClient).toHaveBeenCalledWith(
        'https://test.supabase.co',
        'test-anon-key',
        expect.objectContaining({
          cookies: expect.any(Object),
        })
      );
    });

    it('should call cookies() from next/headers', async () => {
      await createSupabaseServerClient();

      expect(cookies).toHaveBeenCalled();
    });

    it('should configure getAll to retrieve cookies from cookie store', async () => {
      const mockCookies: Array<{ name: string; value: string }> = [
        { name: 'session', value: 'token123' },
        { name: 'user', value: 'user456' },
      ];
      mockCookieStore.getAll.mockReturnValue(mockCookies);

      await createSupabaseServerClient();

      // Get the cookies config passed to createServerClient
      const callArgs = (createServerClient as jest.Mock).mock.calls[0];
      const cookiesConfig = callArgs[2].cookies;

      // Test that getAll returns the mocked cookies
      expect(cookiesConfig.getAll()).toEqual(mockCookies);
      expect(mockCookieStore.getAll).toHaveBeenCalled();
    });

    it('should configure setAll to set cookies in cookie store', async () => {
      await createSupabaseServerClient();

      // Get the cookies config passed to createServerClient
      const callArgs = (createServerClient as jest.Mock).mock.calls[0];
      const cookiesConfig = callArgs[2].cookies;

      // Test setAll with multiple cookies
      const cookiesToSet = [
        { name: 'session', value: 'new-token', options: { maxAge: 3600 } },
        { name: 'refresh', value: 'refresh-token', options: { httpOnly: true } },
      ];

      cookiesConfig.setAll(cookiesToSet);

      expect(mockCookieStore.set).toHaveBeenCalledTimes(2);
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'session',
        'new-token',
        { maxAge: 3600 }
      );
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'refresh',
        'refresh-token',
        { httpOnly: true }
      );
    });

    it('should handle setAll with empty array', async () => {
      await createSupabaseServerClient();

      const callArgs = (createServerClient as jest.Mock).mock.calls[0];
      const cookiesConfig = callArgs[2].cookies;

      cookiesConfig.setAll([]);

      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });

    it('should silently catch errors in setAll (Server Component context)', async () => {
      // Make set throw an error (simulating Server Component context)
      mockCookieStore.set.mockImplementation(() => {
        throw new Error('Cannot set cookies in Server Component');
      });

      await createSupabaseServerClient();

      const callArgs = (createServerClient as jest.Mock).mock.calls[0];
      const cookiesConfig = callArgs[2].cookies;

      // Should not throw
      expect(() => {
        cookiesConfig.setAll([
          { name: 'session', value: 'token', options: {} },
        ]);
      }).not.toThrow();

      expect(mockCookieStore.set).toHaveBeenCalled();
    });

    it('should handle getAll with empty cookie store', async () => {
      mockCookieStore.getAll.mockReturnValue([]);

      await createSupabaseServerClient();

      const callArgs = (createServerClient as jest.Mock).mock.calls[0];
      const cookiesConfig = callArgs[2].cookies;

      expect(cookiesConfig.getAll()).toEqual([]);
    });

    it('should preserve cookie options when setting', async () => {
      await createSupabaseServerClient();

      const callArgs = (createServerClient as jest.Mock).mock.calls[0];
      const cookiesConfig = callArgs[2].cookies;

      const complexCookie = {
        name: 'auth',
        value: 'complex-token',
        options: {
          maxAge: 7200,
          httpOnly: true,
          secure: true,
          sameSite: 'lax' as const,
          path: '/',
        },
      };

      cookiesConfig.setAll([complexCookie]);

      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'auth',
        'complex-token',
        complexCookie.options
      );
    });

    it('should return client instance', async () => {
      const client = await createSupabaseServerClient();

      expect(client).toBeDefined();
      expect(client).toHaveProperty('from');
      expect(client).toHaveProperty('auth');
    });

    it('should use environment variables from process.env', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://custom.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'custom-server-key';

      await createSupabaseServerClient();

      expect(createServerClient).toHaveBeenCalledWith(
        'https://custom.supabase.co',
        'custom-server-key',
        expect.any(Object)
      );
    });
  });
});
