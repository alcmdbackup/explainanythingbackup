import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Prefix for all test content to enable filtering in discovery paths.
 * Used to exclude test content from Explore page, vector search, and related content.
 */
export const TEST_CONTENT_PREFIX = '[TEST]';

let supabaseInstance: SupabaseClient | null = null;

/**
 * Gets or creates a Supabase client using service role key.
 * Cached for reuse across test data operations.
 */
function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for test data factory');
    }
    supabaseInstance = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return supabaseInstance;
}

/**
 * Generates a unique timestamp suffix for test content isolation.
 * Used with TEST_CONTENT_PREFIX to create unique test titles.
 */
function generateTestSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface CreateTestExplanationOptions {
  title: string;
  content?: string;
  status?: string;
  topicId?: number;
}

export interface TestExplanation {
  id: string;
  explanation_title: string;
  content: string;
  status: string;
  cleanup: () => Promise<void>;
}

/**
 * Gets or creates a test topic for explanations.
 * Uses upsert to be idempotent and handle concurrent access safely.
 * Returns the topic ID.
 */
async function getOrCreateTestTopic(): Promise<number> {
  const supabase = getSupabase();

  // Use upsert to atomically get or create - safe for concurrent test workers
  const { data: topic, error } = await supabase
    .from('topics')
    .upsert(
      {
        topic_title: 'test-e2e-topic',
        topic_description: 'Topic for E2E tests (test-data-factory)',
      },
      { onConflict: 'topic_title' }
    )
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to get or create test topic: ${error.message}`);
  }

  if (!topic?.id) {
    throw new Error('Failed to get topic ID after upsert');
  }

  return topic.id;
}

/**
 * Creates a test explanation in the database.
 * Returns the created record with a cleanup function.
 */
export async function createTestExplanation(
  options: CreateTestExplanationOptions
): Promise<TestExplanation> {
  const supabase = getSupabase();
  const suffix = generateTestSuffix();
  const testUserId = process.env.TEST_USER_ID;

  if (!testUserId) {
    throw new Error('TEST_USER_ID is required for creating test explanations');
  }

  // Get or create a topic (required field)
  const topicId = options.topicId ?? await getOrCreateTestTopic();

  const { data, error } = await supabase
    .from('explanations')
    .insert({
      // Note: explanations table has no user_id column
      // User association is via userLibrary junction table
      // Format: [TEST] Title - timestamp for easy filtering
      explanation_title: `${TEST_CONTENT_PREFIX} ${options.title} - ${suffix}`,
      content: options.content ?? '<p>Test content for E2E testing.</p>',
      status: options.status ?? 'published',
      primary_topic_id: topicId,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create test explanation: ${error.message}`);
  }

  return {
    ...data,
    cleanup: async () => {
      await supabase.from('explanations').delete().eq('id', data.id);
    },
  };
}

/**
 * Creates a test explanation and adds it to the user's library.
 */
export async function createTestExplanationInLibrary(
  options: CreateTestExplanationOptions
): Promise<TestExplanation> {
  const supabase = getSupabase();
  const explanation = await createTestExplanation(options);
  const testUserId = process.env.TEST_USER_ID!;

  const { error } = await supabase.from('userLibrary').insert({
    explanationid: explanation.id,
    userid: testUserId,
  });

  if (error) {
    // Clean up the explanation if library insert fails
    await explanation.cleanup();
    throw new Error(`Failed to add explanation to library: ${error.message}`);
  }

  return explanation;
}

export interface CreateTestTagOptions {
  name: string;
  description?: string;
}

export interface TestTag {
  id: string;
  tag_name: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test tag in the database.
 */
export async function createTestTag(options: CreateTestTagOptions): Promise<TestTag> {
  const supabase = getSupabase();
  const suffix = generateTestSuffix();

  const { data, error } = await supabase
    .from('tags')
    .insert({
      tag_name: `${TEST_CONTENT_PREFIX} ${options.name} - ${suffix}`,
      tag_description: options.description ?? 'Test tag for E2E testing',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create test tag: ${error.message}`);
  }

  return {
    ...data,
    cleanup: async () => {
      await supabase.from('tags').delete().eq('id', data.id);
    },
  };
}

/**
 * Creates multiple test explanations at once.
 */
export async function createTestExplanations(
  count: number,
  baseOptions: Omit<CreateTestExplanationOptions, 'title'>
): Promise<TestExplanation[]> {
  const explanations: TestExplanation[] = [];

  for (let i = 0; i < count; i++) {
    const explanation = await createTestExplanation({
      ...baseOptions,
      title: `Test Explanation ${i + 1}`,
    });
    explanations.push(explanation);
  }

  return explanations;
}

/**
 * Cleans up multiple test explanations.
 */
export async function cleanupTestExplanations(explanations: TestExplanation[]): Promise<void> {
  await Promise.all(explanations.map((e) => e.cleanup()));
}
