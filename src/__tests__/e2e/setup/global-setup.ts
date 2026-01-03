import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { setupVercelBypass } from './vercel-bypass';

/**
 * Waits for the web server to be ready by polling the health endpoint.
 * This is especially important when using production builds in CI,
 * where the build step adds significant startup time.
 *
 * For Vercel-protected deployments, includes the bypass header to get past
 * deployment protection before the bypass cookie is available.
 */
async function waitForServerReady(
  url: string,
  options: { maxRetries?: number; retryInterval?: number } = {}
): Promise<void> {
  const { maxRetries = 30, retryInterval = 1000 } = options;
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  console.log(`   Waiting for server at ${url}...`);

  for (let i = 0; i < maxRetries; i++) {
    try {
      // Build headers - include bypass header for Vercel-protected deployments
      const headers: Record<string, string> = {};
      if (bypassSecret) {
        headers['x-vercel-protection-bypass'] = bypassSecret;
      }

      const response = await fetch(url, {
        method: 'GET', // Use GET for /api/health to get actual response
        headers,
        signal: AbortSignal.timeout(5000),
        redirect: 'follow', // Follow Vercel's 307 redirect
      });
      if (response.ok || response.status === 304) {
        console.log(`   ✓ Server is ready (attempt ${i + 1}/${maxRetries})`);
        return;
      }
      // Log non-OK status for debugging
      if (i === 0 || (i + 1) % 10 === 0) {
        console.log(`   ⏳ Server returned ${response.status} (attempt ${i + 1}/${maxRetries})`);
      }
    } catch {
      // Server not ready yet, continue polling
    }

    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryInterval));
    }
  }

  throw new Error(`Server at ${url} did not become ready within ${maxRetries * retryInterval / 1000}s`);
}

/**
 * Ensures a tag is associated with the explanation.
 * Creates the tag if it doesn't exist, and associates it if not already associated.
 */
async function ensureTagAssociated(supabase: SupabaseClient, explanationId: number) {
  // Create or get the test tag
  const { data: tag } = await supabase
    .from('tags')
    .upsert({ tag_name: 'e2e-test-tag', tag_description: 'Test tag for E2E tests' }, { onConflict: 'tag_name' })
    .select()
    .single();

  if (!tag) {
    console.log('   ⚠️  Could not create/get test tag');
    return;
  }

  // Check if already associated (including soft-deleted ones)
  const { data: existingAssoc } = await supabase
    .from('explanation_tags')
    .select('id, isDeleted')
    .eq('explanation_id', explanationId)
    .eq('tag_id', tag.id)
    .single();

  if (existingAssoc) {
    if (existingAssoc.isDeleted === false) {
      console.log('   ✓ Tag already associated (active)');
      return;
    }
    // Reactivate soft-deleted association
    console.log('   ↻ Reactivating soft-deleted tag association');
    const { error: reactivateError } = await supabase
      .from('explanation_tags')
      .update({ isDeleted: false })
      .eq('id', existingAssoc.id);
    if (reactivateError) {
      console.warn('   ⚠️  Failed to reactivate tag:', reactivateError.message);
    } else {
      console.log('   ✓ Tag reactivated');
    }
    return;
  }

  // Associate tag with explanation (explicitly set isDeleted to false)
  const { error: tagError } = await supabase.from('explanation_tags').insert({
    explanation_id: explanationId,
    tag_id: tag.id,
    isDeleted: false,
  });

  if (tagError) {
    console.warn('   ⚠️  Failed to associate tag:', tagError.message);
  } else {
    console.log('   ✓ Tag associated with explanation');
  }
}

async function globalSetup() {
  console.log('🚀 E2E Global Setup: Starting...');

  // Load environment variables from .env.local
  // This is needed because Playwright tests run in Node.js, not through Next.js
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

  // Note: E2E_TEST_MODE check removed - this setup only runs during Playwright tests,
  // so we always want it to execute. The env var is now set at runtime only.

  // Setup Vercel bypass BEFORE server check (for external URLs)
  // This obtains the cryptographically-signed bypass cookie from Vercel's edge
  await setupVercelBypass();

  // Wait for server to be ready (especially important for production builds in CI)
  // Use /api/health endpoint which is excluded from auth middleware
  const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
  const healthUrl = `${baseUrl}/api/health`;
  try {
    await waitForServerReady(healthUrl, {
      maxRetries: process.env.CI ? 60 : 30, // 60s for CI (build takes time), 30s locally
      retryInterval: 1000,
    });
  } catch (error) {
    console.error('❌ Server did not become ready:', error);
    throw error;
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
   
  const { data: existing, error: existingError } = await supabase
    .from('userLibrary')
    .select('explanationid, explanations!inner(explanation_title)')
    .eq('userid', testUserId)
    .ilike('explanations.explanation_title', 'e2e-test-%')
    .limit(1);

  console.log('   [DEBUG] Existing check result:', { existing, error: existingError?.message });

  if (existing && existing.length > 0) {
    console.log('   ✓ Test explanation already exists');
    // Ensure tag is associated even for existing explanations
    const existingExplanationId = existing[0].explanationid;
    await ensureTagAssociated(supabase, existingExplanationId);
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

  // Associate tag with the new explanation
  await ensureTagAssociated(supabase, explanation.id);
  console.log('   ✓ Seeded test explanation');
}

export default globalSetup;
