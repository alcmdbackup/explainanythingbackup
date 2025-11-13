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

    // Clean up in reverse dependency order to avoid foreign key violations
    // 1. Junction tables and dependents first
    await supabase.from('explanation_tags').delete().ilike('explanation_id', `${TEST_PREFIX}%`);
    await supabase.from('userExplanationEvents').delete().ilike('user_id', `${TEST_PREFIX}%`);
    await supabase.from('userLibrary').delete().ilike('user_id', `${TEST_PREFIX}%`);
    await supabase.from('userQueries').delete().ilike('user_id', `${TEST_PREFIX}%`);

    // 2. Main tables
    await supabase.from('explanations').delete().ilike('explanation_id', `${TEST_PREFIX}%`);
    await supabase.from('topics').delete().ilike('topic_id', `${TEST_PREFIX}%`);
    await supabase.from('tags').delete().ilike('tag_id', `${TEST_PREFIX}%`);

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
  topicId: string;
  explanationId: string;
  tagIds: string[];
}> {
  const testId = `${TEST_PREFIX}${Date.now()}`;

  // Create test topic
  const mockTopic = createMockTopic({
    topic_id: `${testId}-topic-1`,
    topic_name: 'Test Topic',
  });

  const { data: topic, error: topicError } = await supabase
    .from('topics')
    .insert(mockTopic)
    .select()
    .single();

  if (topicError) {
    throw new Error(`Failed to seed test topic: ${topicError.message}`);
  }

  // Create test explanation
  const mockExplanation = createMockExplanation({
    explanation_id: `${testId}-explanation-1`,
    topic_id: topic.topic_id,
    title: 'Test Explanation',
    content: 'This is a test explanation for integration testing.',
  });

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
    createMockTag({ tag_id: `${testId}-tag-basic`, tag_name: 'basic' }),
    createMockTag({ tag_id: `${testId}-tag-technical`, tag_name: 'technical' }),
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
    topicId: topic.topic_id,
    explanationId: explanation.explanation_id,
    tagIds: tags?.map((t) => t.tag_id) || [],
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
    // Clean up in reverse dependency order
    await supabase.from('explanation_tags').delete().ilike('explanation_id', `${testId}%`);
    await supabase.from('userExplanationEvents').delete().ilike('user_id', `${testId}%`);
    await supabase.from('explanations').delete().ilike('explanation_id', `${testId}%`);
    await supabase.from('topics').delete().ilike('topic_id', `${testId}%`);
    await supabase.from('tags').delete().ilike('tag_id', `${testId}%`);
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
