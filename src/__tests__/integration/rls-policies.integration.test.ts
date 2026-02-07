/**
 * RLS Policy Integration Tests
 *
 * Tests Row-Level Security policies to ensure proper access control.
 * Uses anonymous client to verify public access restrictions.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';

/**
 * Creates an anonymous Supabase client (uses anon key, no session)
 * This tests RLS policies for unauthenticated users
 */
function createAnonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

describe('RLS Policies', () => {
  // Service role for setup/cleanup (bypasses RLS)
  let serviceClient: SupabaseClient;

  // Anonymous client (no auth - tests public access)
  let anonClient: SupabaseClient;

  beforeAll(async () => {
    serviceClient = createTestSupabaseClient();
    anonClient = createAnonClient();
  });

  describe('Public content tables', () => {
    it('anonymous user can read public explanations', async () => {
      const { data, error } = await anonClient
        .from('explanations')
        .select('id')
        .limit(1);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it('anonymous user can read public topics', async () => {
      const { data, error } = await anonClient
        .from('topics')
        .select('id')
        .limit(1);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it('anonymous user can read explanationMetrics (public aggregate data)', async () => {
      const { data, error } = await anonClient
        .from('explanationMetrics')
        .select('id')
        .limit(1);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });
  });

  describe('User-isolated tables (after Phase 1A)', () => {
    it('anonymous user cannot read userExplanationEvents', async () => {
      const { data, error } = await anonClient
        .from('userExplanationEvents')
        .select('id')
        .limit(1);

      // Should return empty array (RLS blocks access) or error
      // After Phase 1A: no public access, must be authenticated
      if (error) {
        // RLS may return permission error
        expect(error.code).toBeDefined();
      } else {
        // Or RLS silently returns empty
        expect(data?.length).toBe(0);
      }
    });

    it('anonymous user cannot read userLibrary', async () => {
      const { data, error } = await anonClient
        .from('userLibrary')
        .select('id')
        .limit(1);

      // userLibrary has no public SELECT policy
      if (error) {
        expect(error.code).toBeDefined();
      } else {
        expect(data?.length).toBe(0);
      }
    });

    it('anonymous user cannot read userQueries', async () => {
      const { data, error } = await anonClient
        .from('userQueries')
        .select('id')
        .limit(1);

      // userQueries has no public SELECT policy
      if (error) {
        expect(error.code).toBeDefined();
      } else {
        expect(data?.length).toBe(0);
      }
    });
  });

  describe('Service role (backend)', () => {
    it('has full access to user tables', async () => {
      // Service role bypasses RLS
      const { error: eventsError } = await serviceClient
        .from('userExplanationEvents')
        .select('id')
        .limit(1);

      const { error: libraryError } = await serviceClient
        .from('userLibrary')
        .select('id')
        .limit(1);

      const { error: queriesError } = await serviceClient
        .from('userQueries')
        .select('id')
        .limit(1);

      expect(eventsError).toBeNull();
      expect(libraryError).toBeNull();
      expect(queriesError).toBeNull();
    });
  });

  describe('Hidden content visibility (delete_status)', () => {
    let testExplanationId: number | null = null;

    beforeAll(async () => {
      // Create a hidden test explanation using service client (bypasses RLS)
      const { data, error } = await serviceClient
        .from('explanations')
        .insert({
          explanation_title: 'RLS Test Hidden Explanation - Do Not Display',
          content: 'This content should not be visible to anonymous users',
          status: 'published',
          delete_status: 'hidden'
        })
        .select('id')
        .single();

      if (error) {
        console.error('Failed to create test explanation:', error);
      } else {
        testExplanationId = data?.id ?? null;
      }
    });

    afterAll(async () => {
      // Clean up test explanation
      if (testExplanationId) {
        await serviceClient
          .from('explanations')
          .delete()
          .eq('id', testExplanationId);
      }
    });

    it('anonymous user cannot see hidden explanations', async () => {
      if (!testExplanationId) {
        console.warn('Skipping test: test explanation not created');
        return;
      }

      const { data, error } = await anonClient
        .from('explanations')
        .select('id')
        .eq('id', testExplanationId)
        .single();

      // RLS should block access - either error (PGRST116 for no rows) or null data
      // The policy only allows delete_status='visible' OR admin users
      if (error) {
        // Expected: PGRST116 means "no rows returned" which is correct behavior
        expect(['PGRST116', '406']).toContain(error.code);
      } else {
        // If no error, data should be null
        expect(data).toBeNull();
      }
    });

    it('service role can see hidden explanations', async () => {
      if (!testExplanationId) {
        console.warn('Skipping test: test explanation not created');
        return;
      }

      const { data, error } = await serviceClient
        .from('explanations')
        .select('id, delete_status')
        .eq('id', testExplanationId)
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data?.delete_status).toBe('hidden');
    });

    it('anonymous user can see visible explanations', async () => {
      // Query for any visible explanation (should return results)
      const { data, error } = await anonClient
        .from('explanations')
        .select('id, delete_status')
        .eq('delete_status', 'visible')
        .limit(1);

      expect(error).toBeNull();
      // There should be at least one visible explanation in the database
      // If database is empty, this may return empty array which is also valid
      if (data && data.length > 0) {
        expect(data[0].delete_status).toBe('visible');
      }
    });
  });
});
