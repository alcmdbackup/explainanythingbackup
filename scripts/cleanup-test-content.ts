#!/usr/bin/env npx tsx
/**
 * One-time cleanup script for test content in production database.
 * Removes test explanations and their associated vectors from Pinecone.
 *
 * Usage:
 *   npx tsx scripts/cleanup-test-content.ts --dry-run          # Preview what would be deleted
 *   npx tsx scripts/cleanup-test-content.ts                    # Run on dev database
 *   npx tsx scripts/cleanup-test-content.ts --prod             # Run on production (with confirmation)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Test content patterns to match
const TEST_PATTERNS = [
  '[TEST]%',           // New standard format
  'test-%',            // Legacy format (test-timestamp-random-title)
  'e2e-test-%',        // E2E seeded content
];

// Protected terms - don't delete educational content about testing
const PROTECTED_TERMS = [
  'test-driven',
  'unit testing',
  'integration testing',
  'a/b testing',
  'load testing',
  'performance testing',
  'smoke testing',
  'regression testing',
  'acceptance testing',
  'testing framework',
];

interface CleanupResult {
  explanationId: number;
  title: string;
  vectorsDeleted: number;
  status: 'deleted' | 'dry-run' | 'error';
  error?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isProd = args.includes('--prod');

  console.log('🧹 Test Content Cleanup Script');
  console.log('================================');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (preview only)' : 'LIVE (will delete)'}`);
  console.log(`Environment: ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'}`);
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

  // Production safety check
  if (isProd) {
    console.log('⚠️  PRODUCTION MODE - This will modify production data!');
    console.log('   Waiting 10 seconds for confirmation...');
    console.log('   Press Ctrl+C to cancel.');
    await new Promise(resolve => setTimeout(resolve, 10000));
    console.log('   Proceeding with production cleanup...\n');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Find all test content
  console.log('🔍 Searching for test content...\n');
  const testExplanations = await findTestContent(supabase);

  if (testExplanations.length === 0) {
    console.log('✅ No test content found. Database is clean!');
    return;
  }

  console.log(`Found ${testExplanations.length} test explanations:\n`);
  testExplanations.forEach((exp, i) => {
    console.log(`  ${i + 1}. [ID: ${exp.id}] ${exp.explanation_title}`);
  });
  console.log('');

  if (isDryRun) {
    console.log('📋 DRY RUN - No changes made.');
    console.log('   Run without --dry-run to delete these items.');
    return;
  }

  // Perform cleanup
  console.log('🗑️  Starting cleanup...\n');
  const results = await cleanupTestContent(supabase, testExplanations);

  // Write log file
  const logFile = `cleanup-log-${Date.now()}.json`;
  fs.writeFileSync(logFile, JSON.stringify(results, null, 2));
  console.log(`\n📄 Cleanup log written to: ${logFile}`);

  // Summary
  const deleted = results.filter(r => r.status === 'deleted').length;
  const errors = results.filter(r => r.status === 'error').length;
  const totalVectors = results.reduce((sum, r) => sum + r.vectorsDeleted, 0);

  console.log('\n📊 Summary:');
  console.log(`   Explanations deleted: ${deleted}`);
  console.log(`   Vectors deleted: ${totalVectors}`);
  if (errors > 0) {
    console.log(`   Errors: ${errors}`);
  }
  console.log('\n✅ Cleanup complete!');
}

async function findTestContent(supabase: SupabaseClient): Promise<Array<{ id: number; explanation_title: string }>> {
  const results: Array<{ id: number; explanation_title: string }> = [];

  for (const pattern of TEST_PATTERNS) {
    const { data, error } = await supabase
      .from('explanations')
      .select('id, explanation_title')
      .ilike('explanation_title', pattern);

    if (error) {
      console.error(`Error querying pattern "${pattern}":`, error.message);
      continue;
    }

    if (data) {
      // Filter out protected terms
      const filtered = data.filter(exp => {
        const title = exp.explanation_title.toLowerCase();
        return !PROTECTED_TERMS.some(term => title.includes(term));
      });
      results.push(...filtered);
    }
  }

  // Deduplicate by ID
  const seen = new Set<number>();
  return results.filter(exp => {
    if (seen.has(exp.id)) return false;
    seen.add(exp.id);
    return true;
  });
}

async function cleanupTestContent(
  supabase: SupabaseClient,
  explanations: Array<{ id: number; explanation_title: string }>
): Promise<CleanupResult[]> {
  const results: CleanupResult[] = [];

  // Initialize Pinecone if configured
  let pineconeIndex: ReturnType<Pinecone['index']> | null = null;
  const pineconeApiKey = process.env.PINECONE_API_KEY;
  const pineconeIndexName = process.env.PINECONE_INDEX_NAME_ALL;

  if (pineconeApiKey && pineconeIndexName) {
    const pc = new Pinecone({ apiKey: pineconeApiKey });
    pineconeIndex = pc.index(pineconeIndexName);
  }

  for (const exp of explanations) {
    const result: CleanupResult = {
      explanationId: exp.id,
      title: exp.explanation_title,
      vectorsDeleted: 0,
      status: 'deleted',
    };

    try {
      console.log(`  Deleting: ${exp.explanation_title} (ID: ${exp.id})...`);

      // Delete vectors from Pinecone
      if (pineconeIndex) {
        result.vectorsDeleted = await deleteVectorsForExplanation(pineconeIndex, exp.id);
      }

      // Delete related data in FK order
      await supabase.from('article_link_overrides').delete().eq('explanation_id', exp.id);
      await supabase.from('article_heading_links').delete().eq('explanation_id', exp.id);
      await supabase.from('article_sources').delete().eq('explanation_id', exp.id);
      await supabase.from('candidate_occurrences').delete().eq('explanation_id', exp.id);
      await supabase.from('link_candidates').delete().eq('first_seen_explanation_id', exp.id);
      await supabase.from('explanation_tags').delete().eq('explanation_id', exp.id);
      await supabase.from('explanationMetrics').delete().eq('explanationid', exp.id);
      await supabase.from('userLibrary').delete().eq('explanationid', exp.id);
      await supabase.from('userQueries').delete().eq('explanation_id', exp.id);

      // Delete the explanation itself
      const { error } = await supabase.from('explanations').delete().eq('id', exp.id);

      if (error) {
        throw new Error(`Failed to delete explanation: ${error.message}`);
      }

      console.log(`    ✓ Deleted (${result.vectorsDeleted} vectors)`);
    } catch (error) {
      result.status = 'error';
      result.error = error instanceof Error ? error.message : String(error);
      console.log(`    ✗ Error: ${result.error}`);
    }

    results.push(result);
  }

  return results;
}

async function deleteVectorsForExplanation(
  index: ReturnType<Pinecone['index']>,
  explanationId: number
): Promise<number> {
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

  // Delete in batches of 1000
  for (let i = 0; i < vectorIds.length; i += 1000) {
    const batch = vectorIds.slice(i, i + 1000);
    await index.namespace('default').deleteMany(batch);
  }

  return vectorIds.length;
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
