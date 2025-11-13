/**
 * Integration Test Helpers
 *
 * Utilities for setting up and managing integration tests with real
 * Supabase, OpenAI, and Pinecone connections.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface IntegrationTestContext {
  supabase: SupabaseClient;
  supabaseService: SupabaseClient;
  pinecone: Pinecone;
  openai: OpenAI;
  testUserId: string;
  testRequestId: string;
  cleanup: () => Promise<void>;
}

export interface TestExplanation {
  explanation_id: string;
  topic_id: string;
  title: string;
  content: string;
  created_at?: string;
}

export interface TestTopic {
  topic_id: string;
  topic: string;
  created_at?: string;
}

export interface TestTag {
  tag_id: string;
  tag_name: string;
  is_preset?: boolean;
  created_at?: string;
}

// ============================================
// CLIENT CREATION
// ============================================

/**
 * Creates a Supabase client for integration tests with anon key
 */
export function createTestSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing Supabase credentials. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.stage'
    );
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Creates a Supabase service client for integration tests (bypasses RLS)
 */
export function createTestSupabaseServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Missing Supabase service credentials. Ensure SUPABASE_SERVICE_ROLE_KEY is set in .env.stage'
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Creates a Pinecone client for integration tests
 */
export function createTestPineconeClient(): Pinecone {
  const apiKey = process.env.PINECONE_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Missing Pinecone credentials. Ensure PINECONE_API_KEY is set in .env.stage'
    );
  }

  return new Pinecone({ apiKey });
}

/**
 * Creates an OpenAI client for integration tests
 */
export function createTestOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Missing OpenAI credentials. Ensure OPENAI_API_KEY is set in .env.stage'
    );
  }

  return new OpenAI({ apiKey });
}

// ============================================
// TEST CONTEXT SETUP
// ============================================

/**
 * Creates a complete integration test context with all necessary clients
 * and cleanup utilities
 */
export async function setupIntegrationTestContext(): Promise<IntegrationTestContext> {
  const supabase = createTestSupabaseClient();
  const supabaseService = createTestSupabaseServiceClient();
  const pinecone = createTestPineconeClient();
  const openai = createTestOpenAIClient();

  const testUserId = process.env.TEST_USER_ID || `test-user-${uuidv4()}`;
  const testRequestId = `test-req-${uuidv4()}`;

  // Track created resources for cleanup
  const createdTopicIds: string[] = [];
  const createdExplanationIds: string[] = [];
  const createdTagIds: string[] = [];
  const createdVectorIds: string[] = [];

  const cleanup = async () => {
    // Delete in reverse order of dependencies
    try {
      // Delete vectors from Pinecone
      if (createdVectorIds.length > 0) {
        const indexName = process.env.PINECONE_INDEX || 'test-index';
        const index = pinecone.index(indexName);
        await index.namespace('').deleteMany(createdVectorIds);
      }

      // Delete explanation tags (junction table)
      if (createdExplanationIds.length > 0) {
        await supabaseService
          .from('explanation_tags')
          .delete()
          .in('explanation_id', createdExplanationIds);
      }

      // Delete user explanation events
      if (createdExplanationIds.length > 0) {
        await supabaseService
          .from('userExplanationEvents')
          .delete()
          .in('explanation_id', createdExplanationIds);
      }

      // Delete explanations
      if (createdExplanationIds.length > 0) {
        await supabaseService
          .from('explanations')
          .delete()
          .in('explanation_id', createdExplanationIds);
      }

      // Delete topics
      if (createdTopicIds.length > 0) {
        await supabaseService
          .from('topics')
          .delete()
          .in('topic_id', createdTopicIds);
      }

      // Delete tags (only non-preset tags)
      if (createdTagIds.length > 0) {
        await supabaseService
          .from('tags')
          .delete()
          .in('tag_id', createdTagIds)
          .eq('is_preset', false);
      }

      // Delete user queries
      await supabaseService
        .from('userQueries')
        .delete()
        .eq('user_id', testUserId);
    } catch (error) {
      console.error('Error during cleanup:', error);
      // Don't throw - cleanup errors shouldn't fail tests
    }
  };

  return {
    supabase,
    supabaseService,
    pinecone,
    openai,
    testUserId,
    testRequestId,
    cleanup,
  };
}

// ============================================
// DATABASE SEEDING
// ============================================

/**
 * Seeds a test topic in the database
 */
export async function seedTestTopic(
  supabase: SupabaseClient,
  topic?: Partial<TestTopic>
): Promise<TestTopic> {
  const testTopic: TestTopic = {
    topic_id: topic?.topic_id || uuidv4(),
    topic: topic?.topic || `Test Topic ${Date.now()}`,
    created_at: topic?.created_at || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('topics')
    .insert(testTopic)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to seed test topic: ${error.message}`);
  }

  return data as TestTopic;
}

/**
 * Seeds a test explanation in the database
 */
export async function seedTestExplanation(
  supabase: SupabaseClient,
  explanation?: Partial<TestExplanation>
): Promise<TestExplanation> {
  // Create a topic first if topic_id not provided
  let topicId = explanation?.topic_id;
  if (!topicId) {
    const topic = await seedTestTopic(supabase);
    topicId = topic.topic_id;
  }

  const testExplanation: TestExplanation = {
    explanation_id: explanation?.explanation_id || uuidv4(),
    topic_id: topicId,
    title: explanation?.title || `Test Explanation ${Date.now()}`,
    content: explanation?.content || '# Test Content\n\nThis is test content.',
    created_at: explanation?.created_at || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('explanations')
    .insert(testExplanation)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to seed test explanation: ${error.message}`);
  }

  return data as TestExplanation;
}

/**
 * Seeds a test tag in the database
 */
export async function seedTestTag(
  supabase: SupabaseClient,
  tag?: Partial<TestTag>
): Promise<TestTag> {
  const testTag: TestTag = {
    tag_id: tag?.tag_id || uuidv4(),
    tag_name: tag?.tag_name || `test-tag-${Date.now()}`,
    is_preset: tag?.is_preset ?? false,
    created_at: tag?.created_at || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('tags')
    .insert(testTag)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to seed test tag: ${error.message}`);
  }

  return data as TestTag;
}

/**
 * Seeds a test vector in Pinecone
 */
export async function seedTestVector(
  pinecone: Pinecone,
  vectorId: string,
  embedding: number[],
  metadata?: Record<string, any>
): Promise<void> {
  const indexName = process.env.PINECONE_INDEX || 'test-index';
  const index = pinecone.index(indexName);

  await index.namespace('').upsert([
    {
      id: vectorId,
      values: embedding,
      metadata: metadata || {},
    },
  ]);
}

// ============================================
// CLEANUP UTILITIES
// ============================================

/**
 * Deletes all test data created by a specific user ID
 */
export async function cleanupTestData(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  // Get all explanations created by this user
  const { data: explanations } = await supabase
    .from('explanations')
    .select('explanation_id')
    .eq('created_by', userId);

  const explanationIds = explanations?.map(e => e.explanation_id) || [];

  if (explanationIds.length > 0) {
    // Delete explanation tags
    await supabase
      .from('explanation_tags')
      .delete()
      .in('explanation_id', explanationIds);

    // Delete user explanation events
    await supabase
      .from('userExplanationEvents')
      .delete()
      .in('explanation_id', explanationIds);

    // Delete explanations
    await supabase
      .from('explanations')
      .delete()
      .in('explanation_id', explanationIds);
  }

  // Delete user queries
  await supabase
    .from('userQueries')
    .delete()
    .eq('user_id', userId);

  // Delete topics created by this user (if there's a created_by field)
  // await supabase.from('topics').delete().eq('created_by', userId);
}

/**
 * Deletes test vectors from Pinecone by prefix
 */
export async function cleanupTestVectors(
  pinecone: Pinecone,
  prefix: string = 'test-'
): Promise<void> {
  const indexName = process.env.PINECONE_INDEX || 'test-index';
  const index = pinecone.index(indexName);

  // Note: Pinecone doesn't support prefix deletion directly
  // You may need to query vectors by metadata and delete them
  // Or track vector IDs during test execution

  // Example: Delete by metadata filter (if your test vectors have a test flag)
  // await index.namespace('').deleteMany({ test: true });
}

// ============================================
// WAIT UTILITIES
// ============================================

/**
 * Waits for a condition to be true with timeout
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  options: {
    timeout?: number;
    interval?: number;
    errorMessage?: string;
  } = {}
): Promise<void> {
  const { timeout = 10000, interval = 100, errorMessage = 'Condition not met' } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(errorMessage);
}

/**
 * Waits for a database record to exist
 */
export async function waitForRecord(
  supabase: SupabaseClient,
  table: string,
  id: string,
  options?: { timeout?: number; interval?: number }
): Promise<any> {
  let record: any;

  await waitFor(
    async () => {
      const { data } = await supabase
        .from(table)
        .select('*')
        .eq('id', id)
        .single();

      record = data;
      return !!data;
    },
    {
      ...options,
      errorMessage: `Record with ID ${id} not found in table ${table}`,
    }
  );

  return record;
}

// ============================================
// UUID V4 EXPORT (for compatibility)
// ============================================

// Re-export uuidv4 for convenience
export { v4 as uuidv4 } from 'uuid';
