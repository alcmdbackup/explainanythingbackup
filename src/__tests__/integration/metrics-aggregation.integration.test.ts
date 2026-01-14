/**
 * Integration Test: Metrics Aggregation Pipeline
 *
 * Tests the metrics system including:
 * - User event tracking
 * - Aggregate metrics calculation
 * - View count incrementation
 * - Stored procedure execution
 */

import { setupTestDatabase, teardownTestDatabase, createTestContext } from '@/testing/utils/integration-helpers';
import { SupabaseClient } from '@supabase/supabase-js';

describe('Metrics Aggregation Integration Tests', () => {
  let supabase: SupabaseClient;
  let testId: string;
  let userId: string;
  let cleanup: () => Promise<void>;
  let testExplanationId: number;
  let testTopicId: number;

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    console.log('Metrics aggregation integration tests: Database setup complete');
  });

  afterAll(async () => {
    await teardownTestDatabase(supabase);
    console.log('Metrics aggregation integration tests: Database cleanup complete');
  });

  beforeEach(async () => {
    const context = await createTestContext();
    testId = context.testId;
    userId = context.userId;
    cleanup = context.cleanup;
    supabase = context.supabase;

    // Create test topic and explanation for metrics testing
    const { data: topic } = await supabase
      .from('topics')
      .insert({
        topic_title: `[TEST] topic-${testId}`,
        topic_description: 'Test topic for metrics',
      })
      .select()
      .single();

    testTopicId = topic!.id;

    const { data: explanation } = await supabase
      .from('explanations')
      .insert({
        explanation_title: `[TEST] explanation-${testId}`,
        content: 'Test content for metrics testing',
        primary_topic_id: testTopicId,
        status: 'published',
      })
      .select()
      .single();

    testExplanationId = explanation!.id;
  });

  afterEach(async () => {
    // Clean up events for this explanation
    if (supabase && testExplanationId) {
      await supabase
        .from('userExplanationEvents')
        .delete()
        .eq('explanationid', testExplanationId);

      // Clean up metrics for this explanation
      await supabase
        .from('explanationMetrics')
        .delete()
        .eq('explanationid', testExplanationId);
    }

    await cleanup();
  });

  describe('User Event Tracking', () => {
    it('should create user explanation event', async () => {
      // Act - create an event
      const { data: event, error } = await supabase
        .from('userExplanationEvents')
        .insert({
          event_name: 'explanation_viewed',
          userid: userId,
          explanationid: testExplanationId,
          value: 1,
          metadata: JSON.stringify({ source: 'test', duration_seconds: 30 }),
        })
        .select()
        .single();

      // Assert
      expect(error).toBeNull();
      expect(event).toBeDefined();
      expect(event?.event_name).toBe('explanation_viewed');
      expect(event?.userid).toBe(userId);
      expect(event?.explanationid).toBe(testExplanationId);
    });

    it('should track multiple events for same explanation', async () => {
      // Arrange - create multiple events
      const events = [
        {
          event_name: 'explanation_viewed',
          userid: userId,
          explanationid: testExplanationId,
          value: 1,
          metadata: JSON.stringify({ source: 'search' }),
        },
        {
          event_name: 'explanation_saved',
          userid: userId,
          explanationid: testExplanationId,
          value: 1,
          metadata: JSON.stringify({ source: 'library' }),
        },
        {
          event_name: 'explanation_shared',
          userid: userId,
          explanationid: testExplanationId,
          value: 1,
          metadata: JSON.stringify({ platform: 'twitter' }),
        },
      ];

      // Act
      const { data: insertedEvents, error } = await supabase
        .from('userExplanationEvents')
        .insert(events)
        .select();

      // Assert
      expect(error).toBeNull();
      expect(insertedEvents).toHaveLength(3);

      // Verify we can query all events for this explanation
      const { data: allEvents } = await supabase
        .from('userExplanationEvents')
        .select('*')
        .eq('explanationid', testExplanationId);

      expect(allEvents).toHaveLength(3);
      const eventNames = allEvents!.map((e) => e.event_name).sort();
      expect(eventNames).toEqual(['explanation_saved', 'explanation_shared', 'explanation_viewed']);
    });

    it('should count events by type', async () => {
      // Arrange - create multiple view events (same user, multiple views)
      const viewEvents = Array.from({ length: 3 }, (_, i) => ({
        event_name: 'explanation_viewed',
        userid: userId, // Same user can view multiple times
        explanationid: testExplanationId,
        value: 1,
        metadata: JSON.stringify({ view_number: i + 1 }),
      }));

      const { error: insertError } = await supabase.from('userExplanationEvents').insert(viewEvents);
      expect(insertError).toBeNull();

      // Act - count view events
      const { count, error } = await supabase
        .from('userExplanationEvents')
        .select('*', { count: 'exact', head: true })
        .eq('explanationid', testExplanationId)
        .eq('event_name', 'explanation_viewed');

      // Assert
      expect(error).toBeNull();
      expect(count).toBe(3);
    });
  });

  describe('Aggregate Metrics', () => {
    it('should create metrics record for explanation', async () => {
      // Act - insert metrics record
      const { data: metrics, error } = await supabase
        .from('explanationMetrics')
        .insert({
          explanationid: testExplanationId,
          total_views: 10,
          total_saves: 2,
          save_rate: 0.2,
        })
        .select()
        .single();

      // Assert
      expect(error).toBeNull();
      expect(metrics).toBeDefined();
      expect(metrics?.total_views).toBe(10);
      expect(metrics?.total_saves).toBe(2);
      expect(metrics?.save_rate).toBeCloseTo(0.2);
    });

    it('should update existing metrics record', async () => {
      // Arrange - create initial metrics
      await supabase.from('explanationMetrics').insert({
        explanationid: testExplanationId,
        total_views: 5,
        total_saves: 1,
        save_rate: 0.2,
      });

      // Act - update metrics
      const { data: updated, error } = await supabase
        .from('explanationMetrics')
        .update({
          total_views: 15,
          total_saves: 3,
          save_rate: 0.2,
        })
        .eq('explanationid', testExplanationId)
        .select()
        .single();

      // Assert
      expect(error).toBeNull();
      expect(updated?.total_views).toBe(15);
      expect(updated?.total_saves).toBe(3);
    });

    it('should upsert metrics using ON CONFLICT', async () => {
      // Arrange - create initial metrics
      await supabase.from('explanationMetrics').insert({
        explanationid: testExplanationId,
        total_views: 5,
        total_saves: 1,
        save_rate: 0.2,
      });

      // Act - upsert with new values
      const { data: upserted, error } = await supabase
        .from('explanationMetrics')
        .upsert(
          {
            explanationid: testExplanationId,
            total_views: 20,
            total_saves: 5,
            save_rate: 0.25,
          },
          { onConflict: 'explanationid' }
        )
        .select()
        .single();

      // Assert
      expect(error).toBeNull();
      expect(upserted?.total_views).toBe(20);
      expect(upserted?.total_saves).toBe(5);
      expect(upserted?.save_rate).toBeCloseTo(0.25);
    });
  });
});
