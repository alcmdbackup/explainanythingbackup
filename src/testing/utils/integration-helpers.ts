/**
 * Integration Testing Helpers
 *
 * Utilities for setting up, seeding, and tearing down integration tests
 * that interact with real database and services.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createMockExplanation, createMockTopic, createMockTag } from './test-helpers';

/**
 * Test data prefix for easy cleanup
 */
export const TEST_PREFIX = 'test-';

/**
 * Interface for test context that can be passed between tests
 */
export interface TestContext {
  supabase: SupabaseClient;
  testId: string;
  userId: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a Supabase service role client for integration tests
 * This bypasses RLS and allows full database access for testing
 */
export function createTestSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Sets up test database connection and verifies connectivity
 */
export async function setupTestDatabase(): Promise<SupabaseClient> {
  const supabase = createTestSupabaseClient();

  // Verify connection by attempting a simple query
  try {
    const { error } = await supabase.from('topics').select('id').limit(1);
    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "no rows returned" which is fine
      console.error('Database connection test failed:', error);
      throw new Error(`Failed to connect to test database: ${error.message}`);
    }
  } catch (err) {
    console.error('Database setup failed:', err);
    throw err;
  }

  console.log('Test database connection established');
  return supabase;
}

/**
 * Tears down test database - cleans up all test data
 * Uses test prefix to identify and remove test records
 */
export async function teardownTestDatabase(supabase: SupabaseClient): Promise<void> {
  try {
    console.log('Cleaning up test data...');

    // Clean up test data by filtering on text fields that contain our test prefix
    // Can't use .ilike() on integer ID fields, must use text fields

    // 1. Get IDs of test records first (for junction tables)
    const { data: testTopics } = await supabase
      .from('topics')
      .select('id')
      .ilike('topic_title', `%${TEST_PREFIX}%`);

    const { data: testExplanations } = await supabase
      .from('explanations')
      .select('id')
      .ilike('explanation_title', `%${TEST_PREFIX}%`);

    const { data: testTags } = await supabase
      .from('tags')
      .select('id')
      .ilike('tag_name', `%${TEST_PREFIX}%`);

    const topicIds = testTopics?.map(t => t.id) || [];
    const explanationIds = testExplanations?.map(e => e.id) || [];
    const tagIds = testTags?.map(t => t.id) || [];

    // 2. Clean up junction tables using the IDs
    if (explanationIds.length > 0) {
      await supabase.from('explanation_tags').delete().in('explanation_id', explanationIds);
      await supabase.from('userLibrary').delete().in('explanation_id', explanationIds);
    }

    // 3. Clean up main tables by text fields
    await supabase.from('explanations').delete().ilike('explanation_title', `%${TEST_PREFIX}%`);
    await supabase.from('topics').delete().ilike('topic_title', `%${TEST_PREFIX}%`);
    await supabase.from('tags').delete().ilike('tag_name', `%${TEST_PREFIX}%`);

    console.log('Test data cleanup complete');
  } catch (error) {
    console.error('Error during test cleanup:', error);
    // Don't throw - allow tests to complete even if cleanup fails
  }
}

/**
 * Seeds test database with baseline data for integration tests
 * Returns test data IDs for use in tests
 */
export async function seedTestData(supabase: SupabaseClient): Promise<{
  topicId: number;
  explanationId: number;
  tagIds: number[];
}> {
  const testId = `${TEST_PREFIX}${Date.now()}`;

  // Create test topic
  const mockTopic = {
    topic_title: `Test Topic ${testId}`,
    topic_description: 'Test topic for integration testing',
  };

  const { data: topic, error: topicError } = await supabase
    .from('topics')
    .insert(mockTopic)
    .select()
    .single();

  if (topicError) {
    throw new Error(`Failed to seed test topic: ${topicError.message}`);
  }

  // Create test explanation
  const mockExplanation = {
    explanation_title: `Test Explanation ${testId}`,
    primary_topic_id: topic.id,
    content: 'This is a test explanation for integration testing.',
    status: 'published',
  };

  const { data: explanation, error: explanationError } = await supabase
    .from('explanations')
    .insert(mockExplanation)
    .select()
    .single();

  if (explanationError) {
    throw new Error(`Failed to seed test explanation: ${explanationError.message}`);
  }

  // Create test tags
  const mockTags = [
    {
      tag_name: `basic-${testId}`,
      tag_description: 'Basic level tag for testing',
    },
    {
      tag_name: `technical-${testId}`,
      tag_description: 'Technical tag for testing',
    },
  ];

  const { data: tags, error: tagsError } = await supabase
    .from('tags')
    .insert(mockTags)
    .select();

  if (tagsError) {
    throw new Error(`Failed to seed test tags: ${tagsError.message}`);
  }

  console.log('Test data seeded successfully');

  return {
    topicId: topic.id,
    explanationId: explanation.id,
    tagIds: tags?.map((t) => t.id) || [],
  };
}

/**
 * Cleans up test data for a specific test run
 * More targeted than teardownTestDatabase
 */
export async function cleanupTestData(
  supabase: SupabaseClient,
  testId: string
): Promise<void> {
  try {
    // Get IDs of test records for this specific testId
    const { data: testTopics } = await supabase
      .from('topics')
      .select('id')
      .ilike('topic_title', `%${testId}%`);

    const { data: testExplanations } = await supabase
      .from('explanations')
      .select('id')
      .ilike('explanation_title', `%${testId}%`);

    const { data: testTags } = await supabase
      .from('tags')
      .select('id')
      .ilike('tag_name', `%${testId}%`);

    const explanationIds = testExplanations?.map(e => e.id) || [];

    // Clean up junction tables using the IDs
    if (explanationIds.length > 0) {
      await supabase.from('explanation_tags').delete().in('explanation_id', explanationIds);
    }

    // Clean up main tables by text fields
    await supabase.from('explanations').delete().ilike('explanation_title', `%${testId}%`);
    await supabase.from('topics').delete().ilike('topic_title', `%${testId}%`);
    await supabase.from('tags').delete().ilike('tag_name', `%${testId}%`);
  } catch (error) {
    console.error(`Error cleaning up test data for ${testId}:`, error);
  }
}

/**
 * Creates a complete test context with database connection and cleanup
 * Useful for tests that need full setup/teardown
 */
export async function createTestContext(): Promise<TestContext> {
  const supabase = createTestSupabaseClient();
  const testId = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const userId = `${testId}-user`;

  const cleanup = async () => {
    await cleanupTestData(supabase, testId);
  };

  return {
    supabase,
    testId,
    userId,
    cleanup,
  };
}

/**
 * Helper to wait for async database operations to complete
 * Useful for testing eventual consistency scenarios
 */
export async function waitForDatabaseOperation<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delayMs?: number;
  } = {}
): Promise<T> {
  const { maxAttempts = 10, delayMs = 100 } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error('Should not reach here');
}

/**
 * Helper to create test user ID with prefix
 */
export function createTestUserId(suffix?: string): string {
  const baseSuffix = suffix || Math.random().toString(36).substr(2, 9);
  return `${process.env.TEST_USER_ID_PREFIX || TEST_PREFIX}${baseSuffix}`;
}

/**
 * Helper to create test data ID with prefix
 */
export function createTestDataId(type: string, suffix?: string): string {
  const baseSuffix = suffix || Math.random().toString(36).substr(2, 9);
  return `${process.env.TEST_DATA_PREFIX || TEST_PREFIX}${type}-${baseSuffix}`;
}
