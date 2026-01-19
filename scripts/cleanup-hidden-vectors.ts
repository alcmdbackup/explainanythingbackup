/**
 * One-time script to delete Pinecone vectors for already-hidden explanations.
 * This cleans up vectors that were created before the hide action deleted them.
 *
 * Usage:
 *   DRY_RUN=true npx tsx scripts/cleanup-hidden-vectors.ts  # Preview only
 *   npx tsx scripts/cleanup-hidden-vectors.ts                # Execute
 */

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { deleteVectorsByExplanationId } from '@/lib/services/vectorsim';

const DRY_RUN = process.env.DRY_RUN === 'true';

async function cleanupHiddenVectors() {
  console.log('=== Cleanup Hidden Vectors ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'EXECUTE'}`);
  console.log('');

  const supabase = await createSupabaseServiceClient();

  const { data: hidden, error } = await supabase
    .from('explanations')
    .select('id, explanation_title')
    .eq('is_hidden', true);

  if (error) {
    console.error('Error fetching hidden explanations:', error);
    throw error;
  }

  console.log(`Found ${hidden?.length || 0} hidden explanations`);

  if (!hidden || hidden.length === 0) {
    console.log('No hidden explanations to clean up');
    return;
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN - would delete vectors for:');
    for (const exp of hidden) {
      console.log(`  - ID ${exp.id}: ${exp.explanation_title}`);
    }
    console.log('\nRun without DRY_RUN=true to execute');
    return;
  }

  console.log('\nDeleting vectors...\n');

  let successCount = 0;
  let failCount = 0;
  let totalVectorsDeleted = 0;

  for (const exp of hidden) {
    try {
      const count = await deleteVectorsByExplanationId(exp.id);
      totalVectorsDeleted += count;
      successCount++;
      console.log(`✓ Deleted ${count} vectors for ID ${exp.id}: ${exp.explanation_title}`);
    } catch (err) {
      failCount++;
      console.error(`✗ Failed to delete vectors for ID ${exp.id}:`, err);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Explanations processed: ${hidden.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Total vectors deleted: ${totalVectorsDeleted}`);
}

// Run the cleanup
cleanupHiddenVectors()
  .then(() => {
    console.log('\nCleanup complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nCleanup failed:', error);
    process.exit(1);
  });
