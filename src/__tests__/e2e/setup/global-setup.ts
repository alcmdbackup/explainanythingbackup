import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { readdirSync, readFileSync } from 'fs';
import { setupVercelBypass } from './vercel-bypass';
import { TEST_CONTENT_PREFIX } from '../helpers/test-data-factory';

/**
 * Discovers the frontend URL from Claude Code instance files.
 * Mirrors the logic in playwright.config.ts to ensure consistency.
 */
function discoverInstanceURL(): string | null {
  try {
    const instanceFiles = readdirSync('/tmp').filter(f => f.startsWith('claude-instance-'));
    if (instanceFiles.length === 0) return null;

    const cwd = process.cwd();

    // Try to find an instance matching our project root
    for (const file of instanceFiles) {
      try {
        const info = JSON.parse(readFileSync(`/tmp/${file}`, 'utf-8'));
        if (info.project_root === cwd) {
          return info.frontend_url;
        }
      } catch (err) {
        console.warn(`[global-setup] Skipping malformed instance file ${file}:`, err instanceof Error ? err.message : err);
      }
    }

    // Fallback to first available instance
    const firstInfo = JSON.parse(readFileSync(`/tmp/${instanceFiles[0]}`, 'utf-8'));
    return firstInfo.frontend_url;
  } catch (err) {
    console.warn('[global-setup] Instance discovery failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

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
    } catch (err) {
      // Server not ready yet, continue polling
      if (i === 0) console.log(`   ⏳ Waiting for server... (${err instanceof Error ? err.message : 'connection failed'})`);
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
  // Priority: BASE_URL env > instance discovery > hardcoded fallback
  const instanceURL = discoverInstanceURL();
  const baseUrl = process.env.BASE_URL || instanceURL || 'http://localhost:3008';
  console.log(`   Using server: ${baseUrl}${instanceURL && !process.env.BASE_URL ? ' (discovered from instance)' : ''}`);
  // Use /api/health endpoint which is excluded from auth middleware
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

  // Detect production environment for safety checks
  const isProduction = baseUrl.includes('vercel.app') || baseUrl.includes('explainanything');

  // PRODUCTION SAFETY: Cross-validate TEST_USER_ID matches TEST_USER_EMAIL
  if (isProduction) {
    const testUserId = process.env.TEST_USER_ID;
    const testUserEmail = process.env.TEST_USER_EMAIL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!testUserId || !testUserEmail || !serviceRoleKey) {
      throw new Error('PRODUCTION SAFETY: TEST_USER_ID, TEST_USER_EMAIL, and SUPABASE_SERVICE_ROLE_KEY required');
    }

    // Create client with timeout to prevent hanging
    const prodSupabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
      global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) }
    });

    try {
      const { data: userData, error } = await prodSupabase.auth.admin.getUserById(testUserId);

      if (error || !userData?.user) {
        throw new Error(`PRODUCTION SAFETY: Could not verify TEST_USER_ID: ${error?.message}`);
      }

      if (userData.user.email !== testUserEmail) {
        throw new Error(
          `PRODUCTION SAFETY: TEST_USER_ID belongs to "${userData.user.email}" but TEST_USER_EMAIL is "${testUserEmail}"`
        );
      }

      const isTestUser = testUserEmail.includes('e2e') || testUserEmail.includes('test');
      if (!isTestUser) {
        throw new Error(`PRODUCTION SAFETY: Email "${testUserEmail}" doesn't match pattern *e2e* or *test*`);
      }

      console.log(`   ✓ Verified production test user: ${testUserEmail}`);

      // Seed a test explanation for production E2E tests
      // This creates a REAL explanation that tests can load via getExplanationByIdAction
      await seedProductionTestExplanation(prodSupabase, testUserId);
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') {
        throw new Error('PRODUCTION SAFETY: Supabase verification timed out after 10s');
      }
      throw e;
    }
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
  // Skip fixture seeding in production - we use pre-existing test data
  if (!isProduction && process.env.SUPABASE_SERVICE_ROLE_KEY) {
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
  if (!testUserId) {
    console.log('⚠️  TEST_USER_ID not set, skipping explanation seeding');
    return;
  }

  // Check if test explanation already exists via userLibrary join
  // Look for both legacy 'e2e-test-%' and new '[TEST]%' patterns

  const { data: existing } = await supabase
    .from('userLibrary')
    .select('explanationid, explanations!inner(explanation_title)')
    .eq('userid', testUserId)
    .or(`explanation_title.ilike.${TEST_CONTENT_PREFIX}%,explanation_title.ilike.e2e-test-%`, { referencedTable: 'explanations' })
    .limit(1);

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
  const { data: explanation, error } = await supabase
    .from('explanations')
    .insert({
      explanation_title: `${TEST_CONTENT_PREFIX} Quantum Physics - e2e-seed`,
      content:
        '<h2>Quantum Physics</h2><p>This is test content for E2E testing about quantum physics. It contains enough text to test various UI elements like tags, save buttons, and content display.</p><p>Quantum mechanics describes the behavior of matter and energy at the molecular, atomic, nuclear, and even smaller microscopic levels.</p>',
      status: 'published',
      primary_topic_id: actualTopicId,
    })
    .select()
    .single();

  if (error) {
    console.warn('⚠️  Failed to create test explanation:', error.message);
    return;
  }

  // Add to userLibrary (this associates user with explanation)
  const { error: libraryError } = await supabase.from('userLibrary').insert({
    userid: testUserId,
    explanationid: explanation.id,
  }).select();

  if (libraryError) {
    console.warn('⚠️  Failed to add explanation to library:', libraryError.message);
    // Clean up the orphaned explanation
    await supabase.from('explanations').delete().eq('id', explanation.id);
    return;
  }

  // Verify the insert worked
  await supabase
    .from('userLibrary')
    .select('*')
    .eq('userid', testUserId)
    .eq('explanationid', explanation.id);
  // Associate tag with the new explanation
  await ensureTagAssociated(supabase, explanation.id);
  console.log('   ✓ Seeded test explanation');
}

/**
 * Seeds a test explanation for production E2E testing.
 * Unlike local fixtures, this creates content that matches what tests expect.
 * The explanation ID is written to a temp file for tests to read.
 */
async function seedProductionTestExplanation(supabase: SupabaseClient, testUserId: string) {
  console.log('   Seeding production test explanation...');

  const timestamp = Date.now();

  // Get or create topic - THROW on failure so we know about it
  const { data: topic, error: topicError } = await supabase
    .from('topics')
    .upsert({ topic_title: 'e2e-test-topic', topic_description: 'Topic for E2E tests' }, { onConflict: 'topic_title' })
    .select()
    .single();

  if (topicError || !topic) {
    throw new Error(`PRODUCTION SEEDING FAILED: Could not create topic: ${topicError?.message}`);
  }

  // Create explanation with content matching defaultMockExplanation
  // Use timestamp in title to ensure uniqueness across runs
  const { data: explanation, error } = await supabase
    .from('explanations')
    .insert({
      explanation_title: `${TEST_CONTENT_PREFIX} Understanding Quantum Entanglement - ${timestamp}`,
      content: `# Understanding Quantum Entanglement

Quantum entanglement is a phenomenon in quantum physics where two or more particles become interconnected.

## Key Concepts

1. **Superposition** - Particles can exist in multiple states simultaneously
2. **Measurement** - Observing one particle instantly affects its entangled partner

## Applications

- Quantum computing
- Quantum cryptography`,
      status: 'published',
      primary_topic_id: topic.id,
    })
    .select()
    .single();

  if (error || !explanation) {
    throw new Error(`PRODUCTION SEEDING FAILED: Could not create explanation: ${error?.message}`);
  }

  // Add to user's library
  const { error: libraryError } = await supabase.from('userLibrary').insert({
    userid: testUserId,
    explanationid: explanation.id,
  });

  if (libraryError) {
    // Clean up orphaned explanation before throwing
    await supabase.from('explanations').delete().eq('id', explanation.id);
    throw new Error(`PRODUCTION SEEDING FAILED: Could not add to library: ${libraryError.message}`);
  }

  // Write the explanation ID to temp file for tests to read
  const fs = await import('fs');
  const testDataPath = '/tmp/e2e-prod-test-data.json';
  fs.writeFileSync(testDataPath, JSON.stringify({
    explanationId: explanation.id,
    title: explanation.explanation_title,
    createdAt: new Date().toISOString(),
  }));

  console.log(`   ✓ Seeded production explanation ID ${explanation.id} → ${testDataPath}`);
}

export default globalSetup;
