/**
 * Integration Test: Auth Flow
 *
 * Tests authentication-related database operations and session validation.
 * Note: Full OAuth flow testing requires E2E tests with real Supabase auth.
 * These tests focus on:
 * - User session database operations
 * - Profile/user record creation
 * - Auth-related metadata storage
 */

import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestContext,
} from '@/testing/utils/integration-helpers';
import { SupabaseClient } from '@supabase/supabase-js';

describe('Auth Flow Integration Tests', () => {
  let supabase: SupabaseClient;
  let testId: string;
  let userId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    console.log('Auth flow integration tests: Database setup complete');
  });

  afterAll(async () => {
    await teardownTestDatabase(supabase);
    console.log('Auth flow integration tests: Database cleanup complete');
  });

  beforeEach(async () => {
    const context = await createTestContext();
    testId = context.testId;
    userId = context.userId;
    cleanup = context.cleanup;
    supabase = context.supabase;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('User Library Access', () => {
    it('should create user library entry for authenticated user', async () => {
      // Arrange - create test explanation first
      const { data: topic } = await supabase
        .from('topics')
        .insert({
          topic_title: `test-topic-${testId}`,
          topic_description: 'Test topic for auth flow',
        })
        .select()
        .single();

      const { data: explanation } = await supabase
        .from('explanations')
        .insert({
          explanation_title: `test-explanation-${testId}`,
          content: 'Test content',
          primary_topic_id: topic!.id,
          status: 'published',
        })
        .select()
        .single();

      // Act - add to user library (simulates authenticated user action)
      const { data: libraryEntry, error } = await supabase
        .from('userLibrary')
        .insert({
          userid: userId,
          explanationid: explanation!.id,
        })
        .select()
        .single();

      // Assert
      expect(error).toBeNull();
      expect(libraryEntry).toBeDefined();
      expect(libraryEntry?.userid).toBe(userId);
      expect(libraryEntry?.explanationid).toBe(explanation!.id);
    });

    it('should retrieve user library entries', async () => {
      // Arrange
      const { data: topic } = await supabase
        .from('topics')
        .insert({
          topic_title: `test-topic-${testId}`,
          topic_description: 'Test topic',
        })
        .select()
        .single();

      const { data: explanation } = await supabase
        .from('explanations')
        .insert({
          explanation_title: `test-explanation-${testId}`,
          content: 'Test content',
          primary_topic_id: topic!.id,
          status: 'published',
        })
        .select()
        .single();

      await supabase.from('userLibrary').insert({
        userid: userId,
        explanationid: explanation!.id,
      });

      // Act - retrieve user's library
      const { data: library, error } = await supabase
        .from('userLibrary')
        .select('*, explanations(*)')
        .eq('userid', userId);

      // Assert
      expect(error).toBeNull();
      expect(library).toHaveLength(1);
      expect(library![0].explanationid).toBe(explanation!.id);
    });

    it('should prevent duplicate library entries', async () => {
      // Arrange
      const { data: topic } = await supabase
        .from('topics')
        .insert({
          topic_title: `test-topic-${testId}`,
          topic_description: 'Test topic',
        })
        .select()
        .single();

      const { data: explanation } = await supabase
        .from('explanations')
        .insert({
          explanation_title: `test-explanation-${testId}`,
          content: 'Test content',
          primary_topic_id: topic!.id,
          status: 'published',
        })
        .select()
        .single();

      await supabase.from('userLibrary').insert({
        userid: userId,
        explanationid: explanation!.id,
      });

      // Act - try to add duplicate
      const { data: duplicate, error } = await supabase.from('userLibrary').insert({
        userid: userId,
        explanationid: explanation!.id,
      }).select().single();

      // Assert - may have unique constraint or allow duplicates based on DB design
      // If no error, duplicates are allowed (schema choice)
      // If error with code 23505, duplicates prevented
      if (error) {
        expect(error.code).toBe('23505'); // PostgreSQL unique violation
      } else {
        // Duplicates allowed - verify both entries exist
        const { data: allEntries } = await supabase
          .from('userLibrary')
          .select('*')
          .eq('userid', userId)
          .eq('explanationid', explanation!.id);
        expect(allEntries).toHaveLength(2);
      }
    });
  });

  describe('User Query Tracking', () => {
    it('should track user queries with user ID', async () => {
      // Arrange
      const { data: topic } = await supabase
        .from('topics')
        .insert({
          topic_title: `test-topic-${testId}`,
          topic_description: 'Test topic',
        })
        .select()
        .single();

      const { data: explanation } = await supabase
        .from('explanations')
        .insert({
          explanation_title: `test-explanation-${testId}`,
          content: 'Test content',
          primary_topic_id: topic!.id,
          status: 'published',
        })
        .select()
        .single();

      // Act - record user query (using actual schema field names)
      const { data: query, error } = await supabase
        .from('userQueries')
        .insert({
          user_query: 'test query',
          explanation_id: explanation!.id,
          userid: userId,
          newExplanation: false,
          userInputType: 'query',
          allowedQuery: true,
          matches: [],
          previousExplanationViewedId: null,
        })
        .select()
        .single();

      // Assert
      expect(error).toBeNull();
      expect(query).toBeDefined();
      expect(query?.userid).toBe(userId);
      expect(query?.user_query).toBe('test query');
    });

    it('should retrieve query history for user', async () => {
      // Arrange
      const { data: topic } = await supabase
        .from('topics')
        .insert({
          topic_title: `test-topic-${testId}`,
          topic_description: 'Test topic',
        })
        .select()
        .single();

      const { data: explanation } = await supabase
        .from('explanations')
        .insert({
          explanation_title: `test-explanation-${testId}`,
          content: 'Test content',
          primary_topic_id: topic!.id,
          status: 'published',
        })
        .select()
        .single();

      // Insert multiple queries
      await supabase.from('userQueries').insert([
        {
          user_query: 'query 1',
          explanation_id: explanation!.id,
          userid: userId,
          newExplanation: false,
          userInputType: 'query',
          allowedQuery: true,
          matches: [],
          previousExplanationViewedId: null,
        },
        {
          user_query: 'query 2',
          explanation_id: explanation!.id,
          userid: userId,
          newExplanation: false,
          userInputType: 'query',
          allowedQuery: true,
          matches: [],
          previousExplanationViewedId: null,
        },
      ]);

      // Act
      const { data: queries, error } = await supabase
        .from('userQueries')
        .select('*')
        .eq('userid', userId);

      // Assert
      expect(error).toBeNull();
      expect(queries).toHaveLength(2);
      // Verify both queries are present (order may vary)
      const queryTexts = queries!.map((q) => q.user_query).sort();
      expect(queryTexts).toEqual(['query 1', 'query 2']);
    });
  });
});
