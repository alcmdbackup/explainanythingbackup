// Backfill prompt_id on content_evolution_runs that don't have one yet.
// Priority: (1) via article_bank_entries.topic_id, (2) via explanation title match.

import dotenv from 'dotenv';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

/** Core backfill logic — exported for tests. */
export async function backfillPromptIds(
  supabase: SupabaseClient,
): Promise<{ linked: number; unlinked: number }> {
  // Get all runs missing prompt_id
  const { data: runs, error: runsErr } = await supabase
    .from('content_evolution_runs')
    .select('id, explanation_id')
    .is('prompt_id', null);

  if (runsErr) throw new Error(`Failed to fetch runs: ${runsErr.message}`);
  if (!runs || runs.length === 0) return { linked: 0, unlinked: 0 };

  let linked = 0;

  for (const run of runs) {
    // Strategy 1: Via article_bank_entries.topic_id
    const { data: bankEntry } = await supabase
      .from('article_bank_entries')
      .select('topic_id')
      .eq('evolution_run_id', run.id)
      .limit(1)
      .single();

    if (bankEntry?.topic_id) {
      await supabase.from('content_evolution_runs')
        .update({ prompt_id: bankEntry.topic_id })
        .eq('id', run.id);
      linked++;
      continue;
    }

    // Strategy 2: Via explanation title → article_bank_topics.prompt
    if (run.explanation_id) {
      const { data: explanation } = await supabase
        .from('explanations')
        .select('explanation_title')
        .eq('id', run.explanation_id)
        .single();

      if (explanation?.explanation_title) {
        const { data: topic } = await supabase
          .from('article_bank_topics')
          .select('id')
          .ilike('prompt', explanation.explanation_title.trim())
          .is('deleted_at', null)
          .single();

        if (topic) {
          await supabase.from('content_evolution_runs')
            .update({ prompt_id: topic.id })
            .eq('id', run.id);
          linked++;
          continue;
        }
      }
    }

    // No match — leave prompt_id NULL
    console.warn(`Run ${run.id}: no prompt match found`);
  }

  return { linked, unlinked: runs.length - linked };
}

// ─── CLI entry point ─────────────────────────────────────────────

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const result = await backfillPromptIds(supabase);
  console.log(`Backfill complete: ${result.linked} linked, ${result.unlinked} unlinked`);
}

// Only run main when executed directly (not imported by tests)
if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}
