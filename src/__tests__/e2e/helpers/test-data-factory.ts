import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import * as fs from 'fs';

/**
 * Prefix for all test content to enable filtering in discovery paths.
 * Used to exclude test content from Explore page, vector search, and related content.
 */
export const TEST_CONTENT_PREFIX = '[TEST]';

/**
 * Path to temp file for tracking created explanation IDs across Playwright workers.
 * Each worker appends IDs; global-teardown reads and cleans them all.
 */
const TRACKED_IDS_FILE = '/tmp/e2e-tracked-explanation-ids.json';

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
 * Automatically tracks the ID for defense-in-depth cleanup.
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

  // Auto-track for defense-in-depth cleanup
  trackExplanationForCleanup(data.id);

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

/**
 * Deletes vectors for an explanation from Pinecone.
 * Returns silently if Pinecone is not configured.
 */
async function deleteVectorsForExplanation(explanationId: number): Promise<void> {
  const pineconeApiKey = process.env.PINECONE_API_KEY;
  const pineconeIndexName = process.env.PINECONE_INDEX_NAME_ALL;

  if (!pineconeApiKey || !pineconeIndexName) {
    return;
  }

  try {
    const pc = new Pinecone({ apiKey: pineconeApiKey });
    const index = pc.index(pineconeIndexName);

    // Query for vectors with this explanation_id
    const dummyVector = new Array(3072).fill(0); // text-embedding-3-large dimension
    const queryResponse = await index.namespace('default').query({
      vector: dummyVector,
      topK: 10000,
      includeMetadata: false,
      filter: { explanation_id: { "$eq": explanationId } }
    });

    if (queryResponse.matches && queryResponse.matches.length > 0) {
      const vectorIds = queryResponse.matches.map(m => m.id);
      for (let i = 0; i < vectorIds.length; i += 1000) {
        const batch = vectorIds.slice(i, i + 1000);
        await index.namespace('default').deleteMany(batch);
      }
    }
  } catch {
    // Non-critical - silently continue
  }
}

/**
 * Deletes an explanation by ID, including Pinecone vectors and related records.
 * Used by import tests that create explanations through the API (not via factory).
 */
export async function deleteExplanationById(explanationId: number): Promise<void> {
  const supabase = getSupabase();

  // Delete vectors from Pinecone first
  await deleteVectorsForExplanation(explanationId);

  // Delete from userLibrary (if exists)
  await supabase.from('userLibrary').delete().eq('explanationid', explanationId);

  // Delete related records
  await Promise.all([
    supabase.from('explanationMetrics').delete().eq('explanationid', explanationId),
    supabase.from('explanation_tags').delete().eq('explanation_id', explanationId),
    supabase.from('link_candidates').delete().eq('first_seen_explanation_id', explanationId),
  ]);

  // Delete the explanation (cascades to dependent tables)
  await supabase.from('explanations').delete().eq('id', explanationId);
}

// ============================================================================
// Auto-tracking system for defense-in-depth cleanup
// ============================================================================

/**
 * Registers an explanation ID for cleanup. Called automatically by factory functions
 * and can be called manually for explanations created through the API.
 * IDs are persisted to a temp file so global-teardown can clean them.
 */
export function trackExplanationForCleanup(explanationId: number | string): void {
  const id = typeof explanationId === 'string' ? parseInt(explanationId, 10) : explanationId;
  if (isNaN(id)) return;

  try {
    let ids: number[] = [];
    if (fs.existsSync(TRACKED_IDS_FILE)) {
      const content = fs.readFileSync(TRACKED_IDS_FILE, 'utf-8');
      ids = JSON.parse(content);
    }
    if (!ids.includes(id)) {
      ids.push(id);
      fs.writeFileSync(TRACKED_IDS_FILE, JSON.stringify(ids));
    }
  } catch {
    // Non-critical - silently continue
  }
}

/**
 * Gets all tracked explanation IDs from the temp file.
 * Used by global-teardown for cleanup.
 */
export function getTrackedExplanationIds(): number[] {
  try {
    if (fs.existsSync(TRACKED_IDS_FILE)) {
      const content = fs.readFileSync(TRACKED_IDS_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Non-critical - return empty
  }
  return [];
}

/**
 * Clears the tracked IDs file. Called after cleanup.
 */
export function clearTrackedExplanationIds(): void {
  try {
    if (fs.existsSync(TRACKED_IDS_FILE)) {
      fs.unlinkSync(TRACKED_IDS_FILE);
    }
  } catch {
    // Non-critical - silently continue
  }
}

/**
 * Cleans up all tracked explanations and clears the tracking file.
 * Called by global-teardown as defense-in-depth.
 */
export async function cleanupAllTrackedExplanations(): Promise<number> {
  const ids = getTrackedExplanationIds();
  let cleaned = 0;

  for (const id of ids) {
    try {
      await deleteExplanationById(id);
      cleaned++;
    } catch {
      // Continue with other IDs
    }
  }

  clearTrackedExplanationIds();
  return cleaned;
}
