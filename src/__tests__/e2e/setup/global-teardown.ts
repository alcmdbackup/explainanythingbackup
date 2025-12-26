import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

async function globalTeardown() {
  console.log('🧹 E2E Global Teardown: Starting...');

  // Load environment variables from .env.local
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

  const testUserId = process.env.TEST_USER_ID;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!testUserId || !serviceRoleKey) {
    console.warn('⚠️  TEST_USER_ID or SUPABASE_SERVICE_ROLE_KEY not set, skipping cleanup');
    console.log('✅ E2E Global Teardown: Complete (skipped)');
    return;
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey);

  try {
    // Step 1: Delete tables with direct user_id column
    // These are safe - always filter by user_id, no race condition
    console.log('   Cleaning user-specific tables...');

    await supabase.from('userLibrary').delete().eq('userid', testUserId);
    await supabase.from('userQueries').delete().eq('userid', testUserId);
    await supabase.from('userExplanationEvents').delete().eq('userid', testUserId);
    await supabase.from('llmCallTracking').delete().eq('userid', testUserId);

    // Step 2: Get explanation IDs for non-cascading table cleanup
    const { data: explanations } = await supabase
      .from('explanations')
      .select('id')
      .eq('user_id', testUserId);

    if (explanations && explanations.length > 0) {
      const ids = explanations.map((e) => e.id);
      console.log(`   Cleaning ${ids.length} explanations and related data...`);

      // Delete non-cascading tables in parallel
      await Promise.all([
        supabase.from('explanationMetrics').delete().in('explanationid', ids),
        supabase.from('explanation_tags').delete().in('explanation_id', ids),
        supabase.from('link_candidates').delete().in('first_seen_explanation_id', ids),
      ]);
    }

    // Step 3: Delete explanations (auto-cascades to dependent tables)
    // Cascades: candidate_occurrences, article_sources, article_heading_links, article_link_overrides
    const { error: deleteError } = await supabase
      .from('explanations')
      .delete()
      .eq('user_id', testUserId);

    if (deleteError) {
      console.error('❌ Failed to delete explanations:', deleteError.message);
    }

    // Step 4: Clean pattern-matched independent tables
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
