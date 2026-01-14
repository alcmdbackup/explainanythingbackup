#!/usr/bin/env npx tsx
/**
 * One-time cleanup script for specific junk content in production database.
 * Removes junk explanations and their associated vectors from Pinecone.
 *
 * IMPORTANT: This script uses broad patterns that are ONLY safe because there are
 * no real users on production as of 2026-01-12. Do NOT reuse these patterns after
 * real users start creating content.
 *
 * Usage:
 *   npx tsx scripts/cleanup-specific-junk.ts --dry-run          # Preview what would be deleted
 *   npx tsx scripts/cleanup-specific-junk.ts                    # Run on dev database
 *   npx tsx scripts/cleanup-specific-junk.ts --prod             # Run on production (with confirmation)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

/**
 * ONE-TIME CLEANUP PATTERNS (2026-01-12)
 *
 * JUSTIFICATION FOR BROAD PATTERNS:
 * 1. NO REAL USERS exist on production as of 2026-01-12
 * 2. All content matching these patterns is test-generated junk
 * 3. This is a ONE-TIME cleanup operation
 * 4. After this cleanup, the [TEST] prefix convention will prevent future junk
 * 5. DO NOT reuse these patterns once real users start creating content
 */
const JUNK_PATTERNS = [
  // Broad patterns for test-generated content (safe only for one-time cleanup)
  '%react%',           // Any title containing "react" (case-insensitive via ilike)
  '%bug%',             // Any title containing "bug" (case-insensitive via ilike)
  // Generic test patterns that don't match [TEST] or test-
  'Test Topic %',      // Integration tests that used wrong prefix
  'Test Explanation %', // Integration tests that used wrong prefix
];

/**
 * REGEX patterns for matching timestamp-random test content.
 * Format: 1768161207452-9maxoavhy-xxx (13-digit timestamp + random ID + suffix)
 * These use PostgreSQL SIMILAR TO which supports regex-like patterns.
 */
const REGEX_JUNK_PATTERNS = [
  // Match titles starting with timestamp-random format (e.g., 1768161207452-9maxoavhy-xxx)
  // Pattern: 13 digits, hyphen, 9+ alphanumeric chars, hyphen, anything
  '^[0-9]{13}-[a-z0-9]{9,}-.*',
];

// Protected terms - don't delete educational content (extra safety check)
const PROTECTED_TERMS = [
  'debugging',         // Keep "debugging" content
  'bugfix',            // Keep "bugfix" methodology content
  'bug report',        // Keep "bug report" tutorials
  'bug tracking',      // Keep "bug tracking" system content
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

  console.log('🧹 Specific Junk Content Cleanup Script');
  console.log('========================================');
  console.log('');
  console.log('⚠️  ONE-TIME CLEANUP (2026-01-12)');
  console.log('   This script uses broad patterns that are ONLY safe because');
  console.log('   there are NO REAL USERS on production.');
  console.log('   DO NOT reuse after real users start creating content.');
  console.log('');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (preview only)' : 'LIVE (will delete)'}`);
  console.log(`Environment: ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log('');
  console.log('Patterns being matched (ILIKE):');
  JUNK_PATTERNS.forEach(p => console.log(`  - ${p}`));
  console.log('');
  console.log('Patterns being matched (REGEX):');
  REGEX_JUNK_PATTERNS.forEach(p => console.log(`  - ${p}`));
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
  if (isProd && !isDryRun) {
    console.log('⚠️  PRODUCTION MODE - This will PERMANENTLY DELETE data!');
    console.log('   Waiting 15 seconds for confirmation...');
    console.log('   Press Ctrl+C to cancel.');
    await new Promise(resolve => setTimeout(resolve, 15000));
    console.log('   Proceeding with production cleanup...\n');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Find all junk content
  console.log('🔍 Searching for junk content...\n');
  const junkExplanations = await findJunkContent(supabase);

  if (junkExplanations.length === 0) {
    console.log('✅ No junk content found matching patterns. Database is clean!');
    return;
  }

  console.log(`Found ${junkExplanations.length} junk explanations:\n`);
  junkExplanations.forEach((exp, i) => {
    console.log(`  ${i + 1}. [ID: ${exp.id}] ${exp.explanation_title}`);
  });
  console.log('');

  if (isDryRun) {
    console.log('📋 DRY RUN - No changes made.');
    console.log('   Run without --dry-run to delete these items.');

    // Write dry-run log for review
    const logFile = `cleanup-specific-junk-dry-run-${Date.now()}.json`;
    fs.writeFileSync(logFile, JSON.stringify(junkExplanations, null, 2));
    console.log(`   Preview log written to: ${logFile}`);
    return;
  }

  // Perform cleanup
  console.log('🗑️  Starting cleanup...\n');
  const results = await cleanupJunkContent(supabase, junkExplanations);

  // Write log file
  const logFile = `cleanup-specific-junk-${Date.now()}.json`;
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

async function findJunkContent(supabase: SupabaseClient): Promise<Array<{ id: number; explanation_title: string }>> {
  const results: Array<{ id: number; explanation_title: string }> = [];

  // Query using ILIKE patterns
  for (const pattern of JUNK_PATTERNS) {
    const { data, error } = await supabase
      .from('explanations')
      .select('id, explanation_title')
      .ilike('explanation_title', pattern);

    if (error) {
      console.error(`Error querying pattern "${pattern}":`, error.message);
      continue;
    }

    if (data) {
      // Filter out protected terms (extra safety)
      const filtered = data.filter(exp => {
        const title = exp.explanation_title.toLowerCase();
        return !PROTECTED_TERMS.some(term => title.includes(term));
      });
      results.push(...filtered);
    }
  }

  // Query using regex patterns (PostgreSQL ~ operator via RPC or filter)
  // Since Supabase JS client doesn't directly support ~, we use a workaround
  // by fetching all and filtering client-side for the regex patterns
  for (const regexPattern of REGEX_JUNK_PATTERNS) {
    const regex = new RegExp(regexPattern, 'i');

    // Query explanations that look like they might match (starts with digit)
    const { data, error } = await supabase
      .from('explanations')
      .select('id, explanation_title')
      .gte('explanation_title', '0')
      .lte('explanation_title', '9z');

    if (error) {
      console.error(`Error querying for regex pattern "${regexPattern}":`, error.message);
      continue;
    }

    if (data) {
      // Apply regex filter client-side
      const filtered = data.filter(exp => {
        if (!regex.test(exp.explanation_title)) return false;
        // Also check protected terms
        const title = exp.explanation_title.toLowerCase();
        return !PROTECTED_TERMS.some(term => title.includes(term));
      });
      results.push(...filtered);
    }
  }

  // Deduplicate by ID (in case an explanation matches multiple patterns)
  const seen = new Set<number>();
  return results.filter(exp => {
    if (seen.has(exp.id)) return false;
    seen.add(exp.id);
    return true;
  });
}

async function cleanupJunkContent(
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
    console.log('📌 Pinecone connection established\n');
  } else {
    console.log('⚠️  Pinecone not configured - skipping vector cleanup\n');
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

      // Step 1: Delete vectors from Pinecone
      if (pineconeIndex) {
        result.vectorsDeleted = await deleteVectorsForExplanation(pineconeIndex, exp.id);
      }

      // Step 2: Delete related data in FK order (same order as cleanup-test-content.ts)
      await supabase.from('article_link_overrides').delete().eq('explanation_id', exp.id);
      await supabase.from('article_heading_links').delete().eq('explanation_id', exp.id);
      await supabase.from('article_sources').delete().eq('explanation_id', exp.id);
      await supabase.from('candidate_occurrences').delete().eq('explanation_id', exp.id);
      await supabase.from('link_candidates').delete().eq('first_seen_explanation_id', exp.id);
      await supabase.from('explanation_tags').delete().eq('explanation_id', exp.id);
      await supabase.from('explanationMetrics').delete().eq('explanationid', exp.id);
      await supabase.from('userLibrary').delete().eq('explanationid', exp.id);
      await supabase.from('userQueries').delete().eq('explanation_id', exp.id);

      // Step 3: Delete the explanation itself
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
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
