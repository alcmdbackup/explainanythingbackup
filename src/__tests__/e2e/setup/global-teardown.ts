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

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey);

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
