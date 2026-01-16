#!/usr/bin/env npx tsx
/**
 * One-time cleanup script for junk explanations missed by previous cleanup.
 * Removes "Test Title" and "Understanding Quantum Entanglement" from staging.
 *
 * These were created by integration tests that used mock LLM responses without
 * the [TEST] prefix, so they weren't caught by the standard cleanup logic.
 *
 * Usage:
 *   npx tsx scripts/cleanup-missed-junk.ts --dry-run    # Preview what would be deleted
 *   npx tsx scripts/cleanup-missed-junk.ts              # Run on staging database
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Exact titles to delete (from integration test mocks that lacked [TEST] prefix)
const JUNK_TITLES = [
  'Test Title',
  'Understanding Quantum Entanglement',
];

interface CleanupResult {
  explanationId: number;
  title: string;
  vectorsDeleted: number;
  status: 'deleted' | 'dry-run' | 'not-found' | 'error';
  error?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  console.log('🧹 Cleanup Missed Junk Explanations');
  console.log('====================================');
  console.log('');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (preview only)' : 'LIVE (will delete)'}`);
  console.log('');
  console.log('Titles to delete:');
  JUNK_TITLES.forEach(t => console.log(`  - "${t}"`));
  console.log('');

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing required environment variables:');
    console.error('- NEXT_PUBLIC_SUPABASE_URL');
    console.error('- SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Find explanations with exact title matches
  console.log('🔍 Searching for junk content...\n');
  const results: CleanupResult[] = [];

  for (const title of JUNK_TITLES) {
    const { data, error } = await supabase
      .from('explanations')
      .select('id, explanation_title')
      .eq('explanation_title', title);

    if (error) {
      console.error(`Error querying "${title}":`, error.message);
      results.push({
        explanationId: -1,
        title,
        vectorsDeleted: 0,
        status: 'error',
        error: error.message,
      });
      continue;
    }

    if (!data || data.length === 0) {
      console.log(`  ℹ️  "${title}" - not found`);
      results.push({
        explanationId: -1,
        title,
        vectorsDeleted: 0,
        status: 'not-found',
      });
      continue;
    }

    // Delete each matching explanation
    for (const exp of data) {
      console.log(`  Found: "${exp.explanation_title}" (ID: ${exp.id})`);

      if (isDryRun) {
        results.push({
          explanationId: exp.id,
          title: exp.explanation_title,
          vectorsDeleted: 0,
          status: 'dry-run',
        });
        continue;
      }

      // Delete the explanation
      const result = await deleteExplanation(supabase, exp.id, exp.explanation_title);
      results.push(result);
    }
  }

  // Summary
  console.log('\n📊 Summary:');
  const deleted = results.filter(r => r.status === 'deleted').length;
  const notFound = results.filter(r => r.status === 'not-found').length;
  const dryRun = results.filter(r => r.status === 'dry-run').length;
  const errors = results.filter(r => r.status === 'error').length;
  const totalVectors = results.reduce((sum, r) => sum + r.vectorsDeleted, 0);

  if (isDryRun) {
    console.log(`   Would delete: ${dryRun} explanations`);
  } else {
    console.log(`   Deleted: ${deleted} explanations`);
    console.log(`   Vectors deleted: ${totalVectors}`);
  }
  console.log(`   Not found: ${notFound}`);
  if (errors > 0) {
    console.log(`   Errors: ${errors}`);
  }
  console.log('\n✅ Done!');
}

async function deleteExplanation(
  supabase: SupabaseClient,
  explanationId: number,
  title: string
): Promise<CleanupResult> {
  const result: CleanupResult = {
    explanationId,
    title,
    vectorsDeleted: 0,
    status: 'deleted',
  };

  try {
    // Step 1: Delete vectors from Pinecone (if configured)
    const pineconeApiKey = process.env.PINECONE_API_KEY;
    const pineconeIndexName = process.env.PINECONE_INDEX_NAME_ALL;

    if (pineconeApiKey && pineconeIndexName) {
      const pc = new Pinecone({ apiKey: pineconeApiKey });
      const index = pc.index(pineconeIndexName);
      result.vectorsDeleted = await deleteVectorsForExplanation(index, explanationId);
    }

    // Step 2: Delete related data in FK order
    await supabase.from('article_link_overrides').delete().eq('explanation_id', explanationId);
    await supabase.from('article_heading_links').delete().eq('explanation_id', explanationId);
    await supabase.from('article_sources').delete().eq('explanation_id', explanationId);
    await supabase.from('candidate_occurrences').delete().eq('explanation_id', explanationId);
    await supabase.from('link_candidates').delete().eq('first_seen_explanation_id', explanationId);
    await supabase.from('explanation_tags').delete().eq('explanation_id', explanationId);
    await supabase.from('explanationMetrics').delete().eq('explanationid', explanationId);
    await supabase.from('userLibrary').delete().eq('explanationid', explanationId);
    await supabase.from('userQueries').delete().eq('explanation_id', explanationId);

    // Step 3: Delete the explanation itself
    const { error } = await supabase.from('explanations').delete().eq('id', explanationId);

    if (error) {
      throw new Error(`Failed to delete explanation: ${error.message}`);
    }

    console.log(`    ✓ Deleted (${result.vectorsDeleted} vectors)`);
  } catch (error) {
    result.status = 'error';
    result.error = error instanceof Error ? error.message : String(error);
    console.log(`    ✗ Error: ${result.error}`);
  }

  return result;
}

async function deleteVectorsForExplanation(
  index: ReturnType<Pinecone['index']>,
  explanationId: number
): Promise<number> {
  try {
    // Use dummy vector with metadata filter (serverless-compatible approach)
    const dummyVector = new Array(3072).fill(0); // text-embedding-3-large dimension

    const queryResponse = await index.namespace('default').query({
      vector: dummyVector,
      topK: 10000,
      includeMetadata: false,
      filter: { explanation_id: { "$eq": explanationId } }
    });

    if (!queryResponse.matches || queryResponse.matches.length === 0) {
      return 0;
    }

    const vectorIds = queryResponse.matches.map(m => m.id);

    // Delete in batches of 1000 (Pinecone limit)
    for (let i = 0; i < vectorIds.length; i += 1000) {
      const batch = vectorIds.slice(i, i + 1000);
      await index.namespace('default').deleteMany(batch);
    }

    return vectorIds.length;
  } catch {
    // Silently continue if Pinecone fails
    return 0;
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
