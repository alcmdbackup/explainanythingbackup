import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { cleanupBypassCookieFile } from './vercel-bypass';
import { TEST_CONTENT_PREFIX, cleanupAllTrackedExplanations } from '../helpers/test-data-factory';
import { Pinecone } from '@pinecone-database/pinecone';

/**
 * Deletes vectors for an explanation from Pinecone.
 * Returns silently if Pinecone is not configured.
 */
async function deleteVectorsForExplanation(explanationId: number): Promise<void> {
  const pineconeApiKey = process.env.PINECONE_API_KEY;
  const pineconeIndexName = process.env.PINECONE_INDEX_NAME_ALL;

  if (!pineconeApiKey || !pineconeIndexName) {
    // Pinecone not configured, skip silently
    return;
  }

  try {
    const pc = new Pinecone({ apiKey: pineconeApiKey });
    const index = pc.index(pineconeIndexName);

    // B117: dimension must match the index. Prefer env var so infra can swap
    // embedding models without editing test code; fall back to the current
    // text-embedding-3-large default (3072).
    const dimEnv = process.env.PINECONE_INDEX_DIMENSION;
    const parsedDim = dimEnv ? Number(dimEnv) : NaN;
    const VECTOR_DIMENSION =
      Number.isFinite(parsedDim) && parsedDim > 0 ? parsedDim : 3072;
    // Query for vectors with this explanation_id
    const dummyVector = new Array(VECTOR_DIMENSION).fill(0);
    const queryResponse = await index.namespace('default').query({
      vector: dummyVector,
      topK: 10000,
      includeMetadata: false,
      filter: { explanation_id: { "$eq": explanationId } }
    });

    if (queryResponse.matches && queryResponse.matches.length > 0) {
      const vectorIds = queryResponse.matches.map(m => m.id);
      // Delete in batches of 1000
      for (let i = 0; i < vectorIds.length; i += 1000) {
        const batch = vectorIds.slice(i, i + 1000);
        await index.namespace('default').deleteMany(batch);
      }
      console.log(`   Deleted ${vectorIds.length} vectors for explanation ${explanationId}`);
    }
  } catch (error) {
    // Non-critical - log and continue
    console.warn(`   ⚠️  Failed to delete vectors for explanation ${explanationId}:`, error);
  }
}

async function globalTeardown() {
  console.log('🧹 E2E Global Teardown: Starting...');

  // Touch idle timestamp to prevent idle watcher from killing server after tests
  // Only relevant locally — CI uses webServer config, not tmux idle watcher
  if (!process.env.CI) {
    try {
      const fs = await import('fs');
      const instanceFiles = fs.readdirSync('/tmp').filter((f: string) => f.startsWith('claude-instance-'));
      for (const file of instanceFiles) {
        try {
          // eslint-disable-next-line flakiness/no-hardcoded-tmpdir -- reading tmux instance files (single-process global-teardown, not parallel)
          const info = JSON.parse(fs.readFileSync(`/tmp/${file}`, 'utf-8'));
          const instanceId = info.instance_id;
          if (instanceId) {
            // eslint-disable-next-line flakiness/no-hardcoded-tmpdir -- tmux idle timestamp file (single-process global-teardown, not parallel)
            const timestampFile = `/tmp/claude-idle-${instanceId}.timestamp`;
            if (fs.existsSync(timestampFile)) {
              const now = new Date();
              fs.utimesSync(timestampFile, now, now);
              console.log(`   ✓ Touched idle timestamp for instance ${instanceId}`);
            }
          }
        } catch { /* skip malformed files */ }
      }
    } catch (err) {
      console.warn('[global-teardown] Failed to touch idle timestamp:', err);
    }
  }

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
  const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
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
  // eslint-disable-next-line flakiness/no-hardcoded-tmpdir -- shared cross-worker file written by global-setup, cleaned here
  const testDataPath = '/tmp/e2e-prod-test-data.json';
  try {
    if (fs.existsSync(testDataPath)) {
      const testData = JSON.parse(fs.readFileSync(testDataPath, 'utf-8'));
      if (testData.explanationId) {
        console.log(`   Cleaning up production test explanation ${testData.explanationId}...`);

        // Delete vectors from Pinecone first
        await deleteVectorsForExplanation(testData.explanationId);

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

  // Each step has its own try/catch so one failure doesn't skip the rest
  let libraryEntries: { explanationid: number }[] | null = null;

  // Step 1: Get explanation IDs via userLibrary BEFORE deleting
  try {
    const { data } = await supabase
      .from('userLibrary')
      .select('explanationid')
      .eq('userid', testUserId);
    libraryEntries = data;
  } catch (error) {
    console.error('❌ Step 1 (get library entries) failed:', error);
  }

  // Step 2: Delete tables with direct userid column
  try {
    console.log('   Cleaning user-specific tables...');
    await supabase.from('userLibrary').delete().eq('userid', testUserId);
    await supabase.from('userQueries').delete().eq('userid', testUserId);
    await supabase.from('userExplanationEvents').delete().eq('userid', testUserId);
    await supabase.from('llmCallTracking').delete().eq('userid', testUserId);
  } catch (error) {
    console.error('❌ Step 2 (delete user tables) failed:', error);
  }

  // Step 3-4: Delete explanation-related data if any explanations were in library
  try {
    if (libraryEntries && libraryEntries.length > 0) {
      const ids = libraryEntries.map((e) => e.explanationid);
      console.log(`   Cleaning ${ids.length} explanations and related data...`);

      console.log('   Cleaning Pinecone vectors...');
      await Promise.all(ids.map(id => deleteVectorsForExplanation(id)));

      await Promise.all([
        supabase.from('explanationMetrics').delete().in('explanationid', ids),
        supabase.from('explanation_tags').delete().in('explanation_id', ids),
        supabase.from('link_candidates').delete().in('first_seen_explanation_id', ids),
      ]);

      const { error: deleteError } = await supabase.from('explanations').delete().in('id', ids);
      if (deleteError) {
        console.error('❌ Failed to delete explanations:', deleteError.message);
      }
    }
  } catch (error) {
    console.error('❌ Step 3-4 (delete explanations) failed:', error);
  }

  // Step 5: Clean pattern-matched independent tables
  try {
    console.log('   Cleaning test-prefixed tables...');
    await Promise.all([
      supabase.from('topics').delete().ilike('topic_title', 'test-%'),
      supabase.from('topics').delete().ilike('topic_title', `${TEST_CONTENT_PREFIX}%`),
      supabase.from('tags').delete().ilike('tag_name', 'test-%'),
      supabase.from('tags').delete().ilike('tag_name', `${TEST_CONTENT_PREFIX}%`),
      supabase.from('testing_edits_pipeline').delete().ilike('set_name', 'test-%'),
    ]);
  } catch (error) {
    console.error('❌ Step 5 (delete test-prefixed tables) failed:', error);
  }

  // Step 5b: Clean evolution entities created by E2E/TEST tests (FK-safe order)
  try {
    console.log('   Cleaning evolution test entities...');

    // Find test strategy and experiment IDs by name pattern
    const [testStrategies, testExperiments, testPrompts] = await Promise.all([
      supabase.from('evolution_strategies').select('id').or('name.ilike.%[TEST]%,name.ilike.%[E2E]%'),
      supabase.from('evolution_experiments').select('id').or('name.ilike.%[TEST]%,name.ilike.%[E2E]%'),
      supabase.from('evolution_prompts').select('id').or('name.ilike.%[TEST]%,name.ilike.%[E2E]%'),
    ]);

    const testStrategyIds = (testStrategies.data ?? []).map(s => s.id as string);
    const testExperimentIds = (testExperiments.data ?? []).map(e => e.id as string);
    const testPromptIds = (testPrompts.data ?? []).map(p => p.id as string);

    // Find test run IDs by strategy_id or experiment_id
    const testRunIds: string[] = [];
    if (testStrategyIds.length > 0) {
      const { data: runs } = await supabase.from('evolution_runs').select('id').in('strategy_id', testStrategyIds);
      testRunIds.push(...(runs ?? []).map(r => r.id as string));
    }
    if (testExperimentIds.length > 0) {
      const { data: runs } = await supabase.from('evolution_runs').select('id').in('experiment_id', testExperimentIds);
      for (const r of runs ?? []) {
        if (!testRunIds.includes(r.id as string)) testRunIds.push(r.id as string);
      }
    }

    // Delete leaf tables by run_id first
    if (testRunIds.length > 0) {
      await supabase.from('evolution_arena_comparisons').delete().in('run_id', testRunIds);
      await supabase.from('evolution_logs').delete().in('run_id', testRunIds);
      await supabase.from('evolution_agent_invocations').delete().in('run_id', testRunIds);
      await supabase.from('evolution_variants').delete().in('run_id', testRunIds);
      await supabase.from('evolution_runs').delete().in('id', testRunIds);
    }

    // Delete root entities
    if (testExperimentIds.length > 0) {
      await supabase.from('evolution_experiments').delete().in('id', testExperimentIds);
    }
    if (testStrategyIds.length > 0) {
      await supabase.from('evolution_strategies').delete().in('id', testStrategyIds);
    }
    if (testPromptIds.length > 0) {
      await supabase.from('evolution_prompts').delete().in('id', testPromptIds);
    }

    // Clean llmCallTracking entries from evolution system user
    await supabase.from('llmCallTracking').delete().eq('userid', '00000000-0000-4000-8000-000000000001');

    const totalCleaned = testRunIds.length + testExperimentIds.length + testStrategyIds.length + testPromptIds.length;
    if (totalCleaned > 0) {
      console.log(`   ✓ Cleaned ${totalCleaned} evolution test entities`);
    }
  } catch (error) {
    console.error('❌ Step 5b (evolution entity cleanup) failed:', error);
  }

  // Step 6: Defense-in-depth - clean any tracked explanations from temp files
  try {
    console.log('   Cleaning tracked explanations (defense-in-depth)...');
    const trackedCleanedCount = await cleanupAllTrackedExplanations();
    if (trackedCleanedCount > 0) {
      console.log(`   ✓ Cleaned ${trackedCleanedCount} tracked explanations`);
    }
  } catch (error) {
    console.error('❌ Step 6 (tracked explanations cleanup) failed:', error);
  }

  // Step 6b: Clean tracked evolution data (defense-in-depth)
  try {
    console.log('   Cleaning tracked evolution data (defense-in-depth)...');
    const mod = await import('../helpers/evolution-test-data-factory');
    if (typeof mod.cleanupAllTrackedEvolutionData === 'function') {
      const evolutionCleanedCount = await mod.cleanupAllTrackedEvolutionData();
      if (evolutionCleanedCount > 0) {
        console.log(`   ✓ Cleaned ${evolutionCleanedCount} tracked evolution records`);
      }
    } else {
      console.warn('   ⚠ cleanupAllTrackedEvolutionData not found in module (skipping)');
    }
  } catch (error) {
    console.error('❌ Step 6b (tracked evolution cleanup) failed:', error);
  }

  console.log('✅ E2E Global Teardown: Complete');
}

export default globalTeardown;
