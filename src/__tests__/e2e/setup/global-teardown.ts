import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { cleanupBypassCookieFile } from './vercel-bypass';

async function globalTeardown() {
  console.log('🧹 E2E Global Teardown: Starting...');

  // Load environment variables from .env.local
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

  // Cleanup Vercel bypass cookie file
  await cleanupBypassCookieFile();

  const testUserId = process.env.TEST_USER_ID;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!testUserId || !serviceRoleKey) {
    console.warn('⚠️  TEST_USER_ID or SUPABASE_SERVICE_ROLE_KEY not set, skipping cleanup');
    console.log('✅ E2E Global Teardown: Complete (skipped)');
    return;
  }

  // Create client with timeout to prevent hanging
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) }
  });

  // PRODUCTION SAFETY CHECK (before any destructive operations)
  const isProduction = process.env.BASE_URL?.includes('vercel.app') ||
                       process.env.BASE_URL?.includes('explainanything');

  if (isProduction) {
    try {
      // Re-verify test user email pattern before ANY cleanup
      const { data: userData, error } = await supabase.auth.admin.getUserById(testUserId);

      if (error || !userData?.user) {
        console.error('❌ SAFETY ABORT: Could not verify test user:', error?.message);
        console.log('✅ E2E Global Teardown: Complete (aborted - safety check failed)');
        return;
      }

      const email = userData.user.email || '';
      const isTestUser = email.includes('e2e') || email.includes('test');

      if (!isTestUser) {
        console.error('❌ SAFETY ABORT: User email does not match test pattern!');
        console.error('   Email:', email);
        console.error('   Expected pattern: *e2e* or *test*');
        console.log('✅ E2E Global Teardown: Complete (aborted - safety check failed)');
        return;
      }

      console.log(`   ✓ Verified test user for cleanup: ${email}`);
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') {
        console.error('❌ SAFETY ABORT: Supabase verification timed out after 10s');
      } else {
        console.error('❌ SAFETY ABORT: Unexpected error verifying test user:', e);
      }
      console.log('✅ E2E Global Teardown: Complete (aborted - safety check failed)');
      return;
    }
  }

  // Clean up production test explanation if it exists
  const fs = await import('fs');
  const testDataPath = '/tmp/e2e-prod-test-data.json';
  try {
    if (fs.existsSync(testDataPath)) {
      const testData = JSON.parse(fs.readFileSync(testDataPath, 'utf-8'));
      if (testData.explanationId) {
        console.log(`   Cleaning up production test explanation ${testData.explanationId}...`);

        // Delete from userLibrary first (FK constraint)
        await supabase.from('userLibrary').delete()
          .eq('explanationid', testData.explanationId)
          .eq('userid', testUserId);

        // Delete the explanation
        await supabase.from('explanations').delete()
          .eq('id', testData.explanationId);

        console.log('   ✓ Cleaned up production test explanation');
      }
      fs.unlinkSync(testDataPath);
    }
  } catch (e) {
    console.warn('   ⚠️  Failed to clean up production test explanation:', e);
  }

  try {
    // Step 1: Get explanation IDs via userLibrary BEFORE deleting (explanations table has no user_id)
    const { data: libraryEntries } = await supabase
      .from('userLibrary')
      .select('explanationid')
      .eq('userid', testUserId);

    // Step 2: Delete tables with direct userid column
    console.log('   Cleaning user-specific tables...');

    await supabase.from('userLibrary').delete().eq('userid', testUserId);
    await supabase.from('userQueries').delete().eq('userid', testUserId);
    await supabase.from('userExplanationEvents').delete().eq('userid', testUserId);
    await supabase.from('llmCallTracking').delete().eq('userid', testUserId);

    // Step 3: Delete explanation-related data if any explanations were in library
    if (libraryEntries && libraryEntries.length > 0) {
      const ids = libraryEntries.map((e) => e.explanationid);
      console.log(`   Cleaning ${ids.length} explanations and related data...`);

      // Delete non-cascading tables in parallel
      await Promise.all([
        supabase.from('explanationMetrics').delete().in('explanationid', ids),
        supabase.from('explanation_tags').delete().in('explanation_id', ids),
        supabase.from('link_candidates').delete().in('first_seen_explanation_id', ids),
      ]);

      // Step 4: Delete explanations (auto-cascades to dependent tables)
      // Note: userLibrary entries are already deleted in Step 2
      // Cascades: candidate_occurrences, article_sources, article_heading_links, article_link_overrides
      const { error: deleteError } = await supabase.from('explanations').delete().in('id', ids);

      if (deleteError) {
        console.error('❌ Failed to delete explanations:', deleteError.message);
      }
    }

    // Step 5: Clean pattern-matched independent tables
    console.log('   Cleaning test-prefixed tables...');
    await Promise.all([
      supabase.from('topics').delete().ilike('topic_title', 'test-%'),
      supabase.from('tags').delete().ilike('tag_name', 'test-%'),
      supabase.from('testing_edits_pipeline').delete().ilike('set_name', 'test-%'),
    ]);

    console.log('✅ E2E Global Teardown: Complete');
  } catch (error) {
    // Log but don't throw - cleanup failures shouldn't fail the test run
    console.error('❌ E2E Global Teardown failed:', error);
  }
}

export default globalTeardown;
