/**
 * @jest-environment node
 */

// Mock @supabase/ssr before imports
jest.mock('@supabase/ssr');

import { createBrowserClient } from '@supabase/ssr';
import { createClient } from './client';

describe('supabase/client', () => {
  let originalEnv: NodeJS.ProcessEnv;

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
        'test-anon-key'
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
        'custom-key'
      );
    });
  });
});
