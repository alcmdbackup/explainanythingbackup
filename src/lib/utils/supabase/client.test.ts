/**
 * @jest-environment jsdom
 */

// Mock @supabase/ssr before imports
jest.mock('@supabase/ssr');
jest.mock('./rememberMe');

import { createBrowserClient } from '@supabase/ssr';
import { createClient } from './client';
import { getRememberMe } from './rememberMe';

describe('supabase/client', () => {
  let originalEnv: NodeJS.ProcessEnv;
  const mockCreateBrowserClient = createBrowserClient as jest.Mock;
  const mockGetRememberMe = getRememberMe as jest.Mock;

  beforeEach(() => {
    // Store original env and set test env vars
    originalEnv = process.env;
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    };

    // Reset mocks
    jest.clearAllMocks();
    mockGetRememberMe.mockReturnValue(true);
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('createClient', () => {
    it('should create browser client with correct env vars', () => {
      createClient();

      expect(createBrowserClient).toHaveBeenCalledWith(
        'https://test.supabase.co',
        'test-anon-key',
        expect.any(Object)
      );
    });

    it('should return client instance', () => {
      const client = createClient();

      expect(client).toBeDefined();
      expect(client).toHaveProperty('from');
      expect(client).toHaveProperty('auth');
    });

    it('should create new instance on each call', () => {
      createClient();
      createClient();
      createClient();

      expect(createBrowserClient).toHaveBeenCalledTimes(3);
    });

    it('should use environment variables from process.env', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://custom.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'custom-key';

      createClient();

      expect(createBrowserClient).toHaveBeenCalledWith(
        'https://custom.supabase.co',
        'custom-key',
        expect.any(Object)
      );
    });
  });

  describe('remember me storage selection', () => {
    it('should use localStorage when persistSession is explicitly true', () => {
      createClient(true);

      expect(mockCreateBrowserClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          auth: expect.objectContaining({
            storage: localStorage,
            persistSession: true,
          }),
        })
      );
    });

    it('should use sessionStorage when persistSession is explicitly false', () => {
      createClient(false);

      expect(mockCreateBrowserClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          auth: expect.objectContaining({
            storage: sessionStorage,
            persistSession: true,
          }),
        })
      );
    });

    it('should use localStorage when getRememberMe returns true and no param provided', () => {
      mockGetRememberMe.mockReturnValue(true);

      createClient();

      expect(mockGetRememberMe).toHaveBeenCalled();
      expect(mockCreateBrowserClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          auth: expect.objectContaining({
            storage: localStorage,
          }),
        })
      );
    });

    it('should use sessionStorage when getRememberMe returns false and no param provided', () => {
      mockGetRememberMe.mockReturnValue(false);

      createClient();

      expect(mockGetRememberMe).toHaveBeenCalled();
      expect(mockCreateBrowserClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          auth: expect.objectContaining({
            storage: sessionStorage,
          }),
        })
      );
    });

    it('should override getRememberMe when explicit persistSession is provided', () => {
      mockGetRememberMe.mockReturnValue(true);

      createClient(false);

      expect(mockCreateBrowserClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          auth: expect.objectContaining({
            storage: sessionStorage,
          }),
        })
      );
    });

    it('should always set persistSession to true in auth options', () => {
      createClient(false);

      expect(mockCreateBrowserClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          auth: expect.objectContaining({
            persistSession: true,
          }),
        })
      );
    });
  });
});
