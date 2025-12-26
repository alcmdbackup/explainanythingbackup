import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

async function globalSetup() {
  console.log('🚀 E2E Global Setup: Starting...');

  // Load environment variables from .env.local
  // This is needed because Playwright tests run in Node.js, not through Next.js
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

  // Skip setup if E2E_TEST_MODE is not enabled
  if (process.env.E2E_TEST_MODE !== 'true') {
    console.log('⏭️  E2E_TEST_MODE not enabled, skipping setup');
    return;
  }

  // Verify required environment variables
  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ];

  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.warn(`⚠️  Missing environment variables: ${missingVars.join(', ')}`);
    console.warn('   E2E tests may fail without proper configuration');
    return;
  }

  // Optional: Seed shared fixtures if service role key is available
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await seedSharedFixtures();
    } catch (error) {
      console.warn('⚠️  Failed to seed shared fixtures:', error);
    }
  }

  console.log('✅ E2E Global Setup: Complete');
}

/**
 * Seeds shared test fixtures that are used across multiple tests.
 * Uses upsert to be idempotent - safe to run multiple times.
 */
async function seedSharedFixtures() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Seed a test topic if needed (idempotent via upsert)
  const { data: topic, error: topicError } = await supabase
    .from('topics')
    .upsert(
      {
        topic_title: 'test-e2e-topic',
        topic_description: 'Topic for E2E tests',
      },
      { onConflict: 'topic_title' }
    )
    .select()
    .single();

  if (topicError) {
    console.warn('⚠️  Failed to seed test topic:', topicError.message);
  } else {
    console.log('   ✓ Seeded test topic');
  }

  // Seed a test explanation with tag for library tests
  const topicId = topic?.id;
  await seedTestExplanation(supabase, topicId);
}

/**
 * Seeds a test explanation with a tag in the user's library.
 * This ensures library-dependent tests have data to work with.
 * Idempotent - skips if e2e-test explanation already exists.
 */
async function seedTestExplanation(supabase: SupabaseClient, topicId?: number) {
  const testUserId = process.env.TEST_USER_ID;
  console.log('   [DEBUG] seedTestExplanation called with testUserId:', testUserId);
  if (!testUserId) {
    console.log('⚠️  TEST_USER_ID not set, skipping explanation seeding');
    return;
  }

  // Check if test explanation already exists via userLibrary join
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: existingError } = await supabase
    .from('userLibrary')
    .select('explanationid, explanations!inner(explanation_title)')
    .eq('userid', testUserId)
    .ilike('explanations.explanation_title', 'e2e-test-%')
    .limit(1);

  console.log('   [DEBUG] Existing check result:', { existing, error: existingError?.message });

  if (existing && existing.length > 0) {
    console.log('   ✓ Test explanation already exists');
    return;
  }

  // Get a topic ID if not provided
  let actualTopicId = topicId;
  if (!actualTopicId) {
    const { data: existingTopic } = await supabase
      .from('topics')
      .select('id')
      .eq('topic_title', 'test-e2e-topic')
      .single();
    actualTopicId = existingTopic?.id;
  }

  if (!actualTopicId) {
    console.warn('⚠️  No topic found, cannot create explanation (primary_topic_id required)');
    return;
  }

  // Create explanation (no user_id column - uses userLibrary for association)
  console.log('   [DEBUG] Creating explanation with topicId:', actualTopicId);
  const { data: explanation, error } = await supabase
    .from('explanations')
    .insert({
      explanation_title: 'e2e-test-quantum-physics',
      content:
        '<h2>Quantum Physics</h2><p>This is test content for E2E testing about quantum physics. It contains enough text to test various UI elements like tags, save buttons, and content display.</p><p>Quantum mechanics describes the behavior of matter and energy at the molecular, atomic, nuclear, and even smaller microscopic levels.</p>',
      status: 'published',
      primary_topic_id: actualTopicId,
    })
    .select()
    .single();

  console.log('   [DEBUG] Explanation insert result:', { id: explanation?.id, error: error?.message });

  if (error) {
    console.warn('⚠️  Failed to create test explanation:', error.message);
    return;
  }

  // Add to userLibrary (this associates user with explanation)
  console.log('   [DEBUG] Adding to userLibrary:', { userid: testUserId, explanationid: explanation.id });
  const { data: libraryData, error: libraryError } = await supabase.from('userLibrary').insert({
    userid: testUserId,
    explanationid: explanation.id,
  }).select();

  console.log('   [DEBUG] userLibrary insert result:', { data: libraryData, error: libraryError?.message });

  if (libraryError) {
    console.warn('⚠️  Failed to add explanation to library:', libraryError.message);
    // Clean up the orphaned explanation
    await supabase.from('explanations').delete().eq('id', explanation.id);
    return;
  }

  // Verify the insert worked
  const { data: verifyData } = await supabase
    .from('userLibrary')
    .select('*')
    .eq('userid', testUserId)
    .eq('explanationid', explanation.id);
  console.log('   [DEBUG] Verification query:', verifyData);

  // Create a test tag and associate it
  const { data: tag } = await supabase
    .from('tags')
    .upsert({ tag_name: 'e2e-test-tag' }, { onConflict: 'tag_name' })
    .select()
    .single();

  if (tag) {
    const { error: tagError } = await supabase.from('explanation_tags').insert({
      explanation_id: explanation.id,
      tag_id: tag.id,
    });

    if (tagError) {
      console.warn('⚠️  Failed to associate tag:', tagError.message);
    } else {
      console.log('   ✓ Seeded test explanation with tag');
    }
  } else {
    console.log('   ✓ Seeded test explanation (no tag)');
  }
}

export default globalSetup;
