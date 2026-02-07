/**
 * Integration Test: Content Report Submission
 *
 * Tests content reporting with real database operations.
 * This validates:
 * - Creating content reports in the database
 * - Report retrieval for admin review
 * - Database constraints (foreign keys, required fields)
 *
 * Note: These tests use direct database inserts via service client
 * because createContentReportAction requires authentication context
 * that isn't available in Jest integration tests.
 */

import { setupTestDatabase, teardownTestDatabase, createTestContext } from '@/testing/utils/integration-helpers';
import { SupabaseClient } from '@supabase/supabase-js';

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
    // Clean up test reports using test reporter IDs
    await supabase
      .from('content_reports')
      .delete()
      .in('reporter_id', [
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      ]);
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

  // Helper to create reports directly in DB (bypasses auth requirement)
  const createReportInDb = async (
    explanationId: number,
    reason: string,
    details?: string | null
  ) => {
    // Use a test UUID for reporter_id
    const reporterUuid = '00000000-0000-0000-0000-000000000001';
    const { data, error } = await supabase
      .from('content_reports')
      .insert({
        explanation_id: explanationId,
        reporter_id: reporterUuid,
        reason,
        details: details || null,
        status: 'pending',
      })
      .select()
      .single();
    return { data, error };
  };

  describe('Creating Content Reports', () => {
    it('should create a report with valid data', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);

      const { data, error } = await createReportInDb(
        explanation.id,
        'misinformation',
        'This content contains false claims'
      );

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.explanation_id).toBe(explanation.id);
      expect(data?.reason).toBe('misinformation');
      expect(data?.details).toBe('This content contains false claims');
      expect(data?.status).toBe('pending');
    });

    it('should create a report without optional details', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);

      const { data, error } = await createReportInDb(explanation.id, 'spam');

      expect(error).toBeNull();
      expect(data?.reason).toBe('spam');
      expect(data?.details).toBeNull();
    });

    it('should handle different report reasons', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);

      const reasons = ['inappropriate', 'misinformation', 'spam', 'copyright', 'other'] as const;

      for (const reason of reasons) {
        const { data, error } = await createReportInDb(explanation.id, reason);

        expect(error).toBeNull();
        expect(data?.reason).toBe(reason);
      }
    });

    it('should fail for non-existent explanation', async () => {
      const { data, error } = await createReportInDb(999999999, 'spam');

      // Database foreign key constraint should reject this
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });
  });

  describe('Report Retrieval', () => {
    it('should be retrievable after creation', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);

      await createReportInDb(
        explanation.id,
        'inappropriate',
        'Test report for retrieval'
      );

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

      // Use different reporter IDs to allow multiple reports
      const { error: err1 } = await supabase
        .from('content_reports')
        .insert({
          explanation_id: explanation.id,
          reporter_id: '00000000-0000-0000-0000-000000000001',
          reason: 'misinformation',
          status: 'pending',
        });

      const { error: err2 } = await supabase
        .from('content_reports')
        .insert({
          explanation_id: explanation.id,
          reporter_id: '00000000-0000-0000-0000-000000000002',
          reason: 'spam',
          status: 'pending',
        });

      expect(err1).toBeNull();
      expect(err2).toBeNull();

      const { data: reports } = await supabase
        .from('content_reports')
        .select('*')
        .eq('explanation_id', explanation.id);

      expect(reports).toHaveLength(2);
    });
  });
});
