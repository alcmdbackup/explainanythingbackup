/**
 * Integration Test: Content Report Submission
 *
 * Tests content reporting with real database operations
 * This validates:
 * - Creating content reports in the database
 * - Report retrieval for admin review
 * - Error handling for invalid inputs
 */

import { setupTestDatabase, teardownTestDatabase, createTestContext } from '@/testing/utils/integration-helpers';
import { SupabaseClient } from '@supabase/supabase-js';
import { createContentReportAction } from '@/lib/services/contentReports';

describe('Content Report Integration Tests', () => {
  let supabase: SupabaseClient;
  let testId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    console.log('Content report integration tests: Database setup complete');
  });

  afterAll(async () => {
    await teardownTestDatabase(supabase);
    console.log('Content report integration tests: Database cleanup complete');
  });

  beforeEach(async () => {
    const context = await createTestContext();
    testId = context.testId;
    cleanup = context.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  const createTopicInDb = async () => {
    const mockTopic = {
      topic_title: `[TEST] Topic ${testId}-${Date.now()}`,
      topic_description: 'Test topic description',
    };
    const { data, error } = await supabase.from('topics').insert(mockTopic).select().single();
    if (error) throw new Error(`Failed to create topic: ${error.message}`);
    return data;
  };

  const createExplanationInDb = async (topicId: number) => {
    const mockExplanation = {
      explanation_title: `[TEST] Explanation ${testId}-${Date.now()}`,
      primary_topic_id: topicId,
      content: 'Test explanation content for report tests',
      status: 'published',
    };
    const { data, error } = await supabase.from('explanations').insert(mockExplanation).select().single();
    if (error) throw new Error(`Failed to create explanation: ${error.message}`);
    return data;
  };

  describe('Creating Content Reports', () => {
    it('should create a report with valid data', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);

      const result = await createContentReportAction({
        explanation_id: explanation.id,
        reason: 'misinformation',
        details: 'This content contains false claims',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.explanation_id).toBe(explanation.id);
      expect(result.data?.reason).toBe('misinformation');
      expect(result.data?.details).toBe('This content contains false claims');
      expect(result.data?.status).toBe('pending');
    });

    it('should create a report without optional details', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);

      const result = await createContentReportAction({
        explanation_id: explanation.id,
        reason: 'spam',
      });

      expect(result.success).toBe(true);
      expect(result.data?.reason).toBe('spam');
      expect(result.data?.details).toBeNull();
    });

    it('should handle different report reasons', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);

      const reasons = ['inappropriate', 'misinformation', 'spam', 'copyright', 'other'] as const;

      for (const reason of reasons) {
        const result = await createContentReportAction({
          explanation_id: explanation.id,
          reason,
        });

        expect(result.success).toBe(true);
        expect(result.data?.reason).toBe(reason);
      }
    });

    it('should fail for non-existent explanation', async () => {
      const result = await createContentReportAction({
        explanation_id: 999999999,
        reason: 'spam',
      });

      // Note: The actual behavior depends on database constraints
      // This test documents expected behavior
      expect(result.success).toBe(false);
    });
  });

  describe('Report Retrieval', () => {
    it('should be retrievable after creation', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);

      await createContentReportAction({
        explanation_id: explanation.id,
        reason: 'inappropriate',
        details: 'Test report for retrieval',
      });

      // Query the reports directly
      const { data: reports, error } = await supabase
        .from('content_reports')
        .select('*')
        .eq('explanation_id', explanation.id);

      expect(error).toBeNull();
      expect(reports).toHaveLength(1);
      expect(reports?.[0].reason).toBe('inappropriate');
    });

    it('should allow multiple reports for same explanation', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);

      await createContentReportAction({
        explanation_id: explanation.id,
        reason: 'misinformation',
      });

      await createContentReportAction({
        explanation_id: explanation.id,
        reason: 'spam',
      });

      const { data: reports } = await supabase
        .from('content_reports')
        .select('*')
        .eq('explanation_id', explanation.id);

      expect(reports).toHaveLength(2);
    });
  });
});
