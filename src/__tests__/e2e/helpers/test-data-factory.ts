import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
 * Generates a unique test ID prefix for isolation.
 */
function generateTestPrefix(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface CreateTestExplanationOptions {
  title: string;
  content?: string;
  status?: string;
}

interface TestExplanation {
  id: string;
  explanation_title: string;
  content: string;
  user_id: string;
  status: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test explanation in the database.
 * Returns the created record with a cleanup function.
 */
export async function createTestExplanation(
  options: CreateTestExplanationOptions
): Promise<TestExplanation> {
  const supabase = getSupabase();
  const prefix = generateTestPrefix();
  const testUserId = process.env.TEST_USER_ID;

  if (!testUserId) {
    throw new Error('TEST_USER_ID is required for creating test explanations');
  }

  const { data, error } = await supabase
    .from('explanations')
    .insert({
      user_id: testUserId,
      explanation_title: `${prefix}-${options.title}`,
      content: options.content ?? '<p>Test content for E2E testing.</p>',
      status: options.status ?? 'published',
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

interface CreateTestTagOptions {
  name: string;
}

interface TestTag {
  id: string;
  tag_name: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test tag in the database.
 */
export async function createTestTag(options: CreateTestTagOptions): Promise<TestTag> {
  const supabase = getSupabase();
  const prefix = generateTestPrefix();

  const { data, error } = await supabase
    .from('tags')
    .insert({
      tag_name: `${prefix}-${options.name}`,
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
