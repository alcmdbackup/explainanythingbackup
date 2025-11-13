/**
 * Integration Test: Metrics Aggregation Service (Scenario 7)
 *
 * Tests metrics aggregation with real:
 * - PostgreSQL stored procedures and triggers
 * - Database event handling
 * - Concurrent metric updates
 * - Aggregation calculations
 *
 * Covers:
 * - User event tracking
 * - Automatic metrics aggregation
 * - View/save increment operations
 * - Concurrent event handling
 * - Metrics query accuracy
 */

import {
  createUserExplanationEvent,
  refreshExplanationMetrics,
  getMultipleExplanationMetrics,
  incrementExplanationViews,
  incrementExplanationSaves,
} from './metrics';
import {
  setupIntegrationTestContext,
  seedTestTopic,
  seedTestExplanation,
  type IntegrationTestContext,
} from '@/testing/utils/integration-helpers';
import type { UserExplanationEventsType } from '@/lib/schemas/schemas';

describe('Metrics Aggregation Integration Tests (Scenario 7)', () => {
  let context: IntegrationTestContext;
  let testUserId: string;

  beforeAll(async () => {
    context = await setupIntegrationTestContext();
    testUserId = context.testUserId;
  });

  afterAll(async () => {
    await context.cleanup();
  });

  describe('User Event Tracking', () => {
    it('should create user explanation event', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Metrics Test Topic',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Metrics Test',
        content: '# Metrics\n\nTest content.',
      });

      const eventData: UserExplanationEventsType = {
        user_id: testUserId,
        explanation_id: parseInt(explanation.explanation_id),
        event_type: 'view',
      };

      // Act
      const createdEvent = await createUserExplanationEvent(eventData);

      // Assert
      expect(createdEvent).toBeDefined();
      expect(createdEvent.user_id).toBe(testUserId);
      expect(createdEvent.explanation_id).toBe(parseInt(explanation.explanation_id));
      expect(createdEvent.event_type).toBe('view');
      expect(createdEvent.user_explanation_event_id).toBeDefined();

      console.log('Event created:', createdEvent.user_explanation_event_id);
    });

    it('should track multiple event types', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Multi Event Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Multi Event Test',
        content: '# Multi Event',
      });

      const eventTypes = ['view', 'save', 'share'] as const;

      // Act - Create multiple events
      const events = await Promise.all(
        eventTypes.map(type =>
          createUserExplanationEvent({
            user_id: testUserId,
            explanation_id: parseInt(explanation.explanation_id),
            event_type: type,
          })
        )
      );

      // Assert
      expect(events.length).toBe(3);
      events.forEach((event, index) => {
        expect(event.event_type).toBe(eventTypes[index]);
      });

      console.log('Multiple event types tracked:', events.length);
    });
  });

  describe('Metrics Aggregation', () => {
    it('should aggregate metrics after events are created', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Aggregation Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Aggregation Test',
        content: '# Aggregation',
      });

      // Create multiple view events
      await Promise.all(
        [1, 2, 3].map(() =>
          createUserExplanationEvent({
            user_id: testUserId,
            explanation_id: parseInt(explanation.explanation_id),
            event_type: 'view',
          })
        )
      );

      // Act - Refresh metrics
      await refreshExplanationMetrics({
        explanationIds: parseInt(explanation.explanation_id),
      });

      // Wait for aggregation
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert - Get metrics
      const metrics = await getMultipleExplanationMetrics([
        parseInt(explanation.explanation_id),
      ]);

      expect(metrics).toBeDefined();
      expect(metrics.length).toBe(1);

      if (metrics[0]) {
        expect(metrics[0].explanation_id).toBe(parseInt(explanation.explanation_id));
        // Should have at least the views we created
        expect(metrics[0].view_count).toBeGreaterThanOrEqual(3);

        console.log('Aggregated metrics - Views:', metrics[0].view_count);
      }
    }, 30000);

    it('should calculate different metric types separately', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Separate Metrics Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Separate Metrics',
        content: '# Separate',
      });

      // Create different event types
      await createUserExplanationEvent({
        user_id: testUserId,
        explanation_id: parseInt(explanation.explanation_id),
        event_type: 'view',
      });

      await createUserExplanationEvent({
        user_id: testUserId,
        explanation_id: parseInt(explanation.explanation_id),
        event_type: 'save',
      });

      // Act - Refresh metrics
      await refreshExplanationMetrics({
        explanationIds: parseInt(explanation.explanation_id),
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert
      const metrics = await getMultipleExplanationMetrics([
        parseInt(explanation.explanation_id),
      ]);

      if (metrics[0]) {
        // Should have separate counts
        expect(metrics[0].view_count).toBeGreaterThanOrEqual(1);
        expect(metrics[0].save_count).toBeGreaterThanOrEqual(1);

        console.log('View count:', metrics[0].view_count);
        console.log('Save count:', metrics[0].save_count);
      }
    }, 30000);
  });

  describe('Increment Operations', () => {
    it('should increment explanation views', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Increment Views Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Increment Views',
        content: '# Views',
      });

      // Act - Increment views
      const result = await incrementExplanationViews(parseInt(explanation.explanation_id));

      // Assert
      expect(result).toBeDefined();
      expect(result.view_count).toBeGreaterThan(0);

      console.log('Views incremented to:', result.view_count);
    });

    it('should increment explanation saves', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Increment Saves Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Increment Saves',
        content: '# Saves',
      });

      // Act - Increment saves
      const result = await incrementExplanationSaves(parseInt(explanation.explanation_id));

      // Assert
      expect(result).toBeDefined();
      expect(result.save_count).toBeGreaterThan(0);

      console.log('Saves incremented to:', result.save_count);
    });

    it('should handle multiple increments correctly', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Multiple Increments Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Multiple Increments',
        content: '# Multiple',
      });

      // Act - Increment multiple times
      await incrementExplanationViews(parseInt(explanation.explanation_id));
      await incrementExplanationViews(parseInt(explanation.explanation_id));
      const final = await incrementExplanationViews(parseInt(explanation.explanation_id));

      // Assert
      expect(final.view_count).toBeGreaterThanOrEqual(3);

      console.log('Final view count after multiple increments:', final.view_count);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent metric updates without race conditions', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Concurrent Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Concurrent Test',
        content: '# Concurrent',
      });

      // Act - Create many events concurrently
      await Promise.all(
        Array(10)
          .fill(null)
          .map(() =>
            createUserExplanationEvent({
              user_id: testUserId,
              explanation_id: parseInt(explanation.explanation_id),
              event_type: 'view',
            })
          )
      );

      // Refresh metrics
      await refreshExplanationMetrics({
        explanationIds: parseInt(explanation.explanation_id),
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert - All events should be counted
      const metrics = await getMultipleExplanationMetrics([
        parseInt(explanation.explanation_id),
      ]);

      if (metrics[0]) {
        expect(metrics[0].view_count).toBeGreaterThanOrEqual(10);
        console.log('Concurrent events aggregated correctly:', metrics[0].view_count);
      }
    }, 30000);
  });

  describe('Batch Metrics Queries', () => {
    it('should retrieve metrics for multiple explanations', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Batch Metrics Test',
      });

      const explanations = await Promise.all([
        seedTestExplanation(context.supabaseService, {
          topic_id: topic.topic_id,
          title: 'Batch Test 1',
          content: '# Test 1',
        }),
        seedTestExplanation(context.supabaseService, {
          topic_id: topic.topic_id,
          title: 'Batch Test 2',
          content: '# Test 2',
        }),
        seedTestExplanation(context.supabaseService, {
          topic_id: topic.topic_id,
          title: 'Batch Test 3',
          content: '# Test 3',
        }),
      ]);

      const ids = explanations.map(e => parseInt(e.explanation_id));

      // Act - Get metrics for all
      const metrics = await getMultipleExplanationMetrics(ids);

      // Assert
      expect(metrics).toBeDefined();
      expect(metrics.length).toBe(3);

      console.log('Batch metrics retrieved for', metrics.length, 'explanations');
    });
  });
});
