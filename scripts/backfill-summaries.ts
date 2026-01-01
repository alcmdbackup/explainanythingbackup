/**
 * One-time backfill script for existing explanations without summaries.
 *
 * Usage:
 *   npx tsx scripts/backfill-summaries.ts [--dry-run] [--batch-size=10] [--delay-ms=1000]
 *
 * Options:
 *   --dry-run       Show what would be processed without making changes
 *   --batch-size=N  Process N explanations per batch (default: 10)
 *   --delay-ms=N    Wait N milliseconds between batches (default: 1000)
 *
 * Environment variables required:
 *   SUPABASE_URL            - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
 *   OPENAI_API_KEY          - OpenAI API key
 */

import { createClient } from '@supabase/supabase-js';

// Parse command line arguments
const args = process.argv.slice(2);
const BATCH_SIZE = parseInt(args.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '10');
const DELAY_MS = parseInt(args.find(a => a.startsWith('--delay-ms='))?.split('=')[1] || '1000');
const DRY_RUN = args.includes('--dry-run');

// Validate environment variables
function validateEnv(): void {
    const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.error(`Missing environment variables: ${missing.join(', ')}`);
        console.error('Please set these in your .env file or environment.');
        process.exit(1);
    }
}

async function main() {
    validateEnv();

    console.log('=== Backfill Summaries Script ===');
    console.log(`Batch size: ${BATCH_SIZE}`);
    console.log(`Delay between batches: ${DELAY_MS}ms`);
    console.log(`Dry run: ${DRY_RUN}`);
    console.log('');

    const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get count first using the partial index
    const { count, error: countError } = await supabase
        .from('explanations')
        .select('*', { count: 'exact', head: true })
        .is('summary_teaser', null)
        .eq('status', 'published');

    if (countError) {
        console.error('Failed to get count:', countError.message);
        process.exit(1);
    }

    console.log(`Found ${count} explanations needing summaries`);

    if (count === 0) {
        console.log('No explanations need summaries. Exiting.');
        return;
    }

    if (DRY_RUN) {
        // Show sample of what would be processed
        const { data: sample } = await supabase
            .from('explanations')
            .select('id, explanation_title')
            .is('summary_teaser', null)
            .eq('status', 'published')
            .limit(5);

        console.log('\nSample of explanations that would be processed:');
        sample?.forEach((exp, i) => {
            console.log(`  ${i + 1}. [${exp.id}] ${exp.explanation_title}`);
        });
        console.log('\nDry run complete - no changes made.');
        return;
    }

    // Dynamically import the summarizer to get proper module resolution
    // This works around the ESM/CommonJS issues in scripts
    const { generateAndSaveExplanationSummary } = await import('../src/lib/services/explanationSummarizer');

    let processed = 0;
    let errors = 0;

    while (true) {
        const { data: batch, error: batchError } = await supabase
            .from('explanations')
            .select('id, explanation_title, content')
            .is('summary_teaser', null)
            .eq('status', 'published')
            .limit(BATCH_SIZE);

        if (batchError) {
            console.error('Failed to fetch batch:', batchError.message);
            break;
        }

        if (!batch || batch.length === 0) {
            break;
        }

        for (const explanation of batch) {
            try {
                console.log(`[${processed + 1}/${count}] Processing: ${explanation.id} - ${explanation.explanation_title.slice(0, 50)}...`);

                await generateAndSaveExplanationSummary(
                    explanation.id,
                    explanation.explanation_title,
                    explanation.content,
                    'backfill-script'
                );
                processed++;
            } catch (err) {
                errors++;
                console.error(`  Failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        // Rate limiting between batches
        if (batch.length === BATCH_SIZE) {
            console.log(`Waiting ${DELAY_MS}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
    }

    console.log('\n=== Backfill Complete ===');
    console.log(`Processed: ${processed}`);
    console.log(`Errors: ${errors}`);
    console.log(`Success rate: ${((processed / (processed + errors)) * 100).toFixed(1)}%`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
