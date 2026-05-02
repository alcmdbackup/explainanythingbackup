// Seed 7 sample evaluation criteria into evolution_criteria.
//
// Run once after merging the criteria-driven evolution agent feature; once on
// staging, once on production. Idempotent: ON CONFLICT (name) DO NOTHING.
// Re-runs do not overwrite researcher edits to seeded rows.
//
// Run command (per Decision 9):
//
//   NEXT_PUBLIC_SUPABASE_URL=$STAGING_URL SUPABASE_SERVICE_ROLE_KEY=$STAGING_KEY \
//     npx tsx evolution/scripts/seedSampleCriteria.ts
//   NEXT_PUBLIC_SUPABASE_URL=$PROD_URL SUPABASE_SERVICE_ROLE_KEY=$PROD_KEY \
//     npx tsx evolution/scripts/seedSampleCriteria.ts
//
// Add `--dry-run` to print what would be inserted without writing.
//
// Sample criteria are intentionally generic; researchers can edit/archive/delete
// them through the admin UI (`/admin/evolution/criteria`) without re-running this
// script.

import { createClient } from '@supabase/supabase-js';

interface SampleCriterion {
  name: string;
  description: string;
  min_rating: number;
  max_rating: number;
  evaluation_guidance: ReadonlyArray<{ score: number; description: string }>;
}

export const SAMPLE_CRITERIA: ReadonlyArray<SampleCriterion> = [
  {
    name: 'clarity',
    description: 'How easy the article is to read for the target audience.',
    min_rating: 1,
    max_rating: 10,
    evaluation_guidance: [
      { score: 1, description: 'Unreadable; sentences fragment, jargon undefined, ideas buried.' },
      { score: 5, description: 'Average reading difficulty; some passages dense or jargon-heavy.' },
      { score: 10, description: 'Effortless to read; ideas surface immediately, no friction.' },
    ],
  },
  {
    name: 'engagement',
    description: 'How well the article holds reader attention from start to finish.',
    min_rating: 1,
    max_rating: 10,
    evaluation_guidance: [
      { score: 1, description: 'No hook; reader bounces in the first paragraph.' },
      { score: 5, description: 'Mild interest; pacing flat or uneven.' },
      { score: 10, description: 'Compelling throughout; reader can\'t stop until the end.' },
    ],
  },
  {
    name: 'structure',
    description: 'Logical flow between sections, paragraph organization, and transitions.',
    min_rating: 1,
    max_rating: 10,
    evaluation_guidance: [
      { score: 1, description: 'Random ordering; ideas don\'t connect; transitions absent.' },
      { score: 5, description: 'Mostly logical with a few abrupt jumps or weak transitions.' },
      { score: 10, description: 'Each section follows necessarily from the last; transitions feel inevitable.' },
    ],
  },
  {
    name: 'depth',
    description: 'Quality of detail, technical accuracy, and explanation of mechanisms.',
    min_rating: 1,
    max_rating: 10,
    evaluation_guidance: [
      { score: 1, description: 'Surface-level only; key concepts asserted without explanation.' },
      { score: 5, description: 'Some mechanisms explained; gaps where details would clarify.' },
      { score: 10, description: 'Mechanisms fully explained; every claim grounded in detail.' },
    ],
  },
  {
    name: 'tone',
    description: 'Voice and register; consistency with the article\'s intent (educational, persuasive, etc.).',
    min_rating: 1,
    max_rating: 10,
    evaluation_guidance: [
      { score: 1, description: 'Wildly inconsistent voice; register clashes with intent.' },
      { score: 5, description: 'Generally consistent voice with a few off-key passages.' },
      { score: 10, description: 'Distinctive, consistent voice perfectly matched to intent.' },
    ],
  },
  {
    name: 'point_of_view',
    description: 'Whether the article takes a clear stance or perspective rather than enumerating facts neutrally.',
    min_rating: 1,
    max_rating: 10,
    evaluation_guidance: [
      { score: 1, description: 'Pure enumeration; no perspective; reads like a Wikipedia summary.' },
      { score: 5, description: 'Implicit perspective; takes occasional positions but mostly neutral.' },
      { score: 10, description: 'Clear thesis or perspective; the article argues for something specific.' },
    ],
  },
  {
    name: 'sentence_variety',
    description: 'Variation in sentence length and structure across paragraphs to maintain rhythm.',
    min_rating: 1,
    max_rating: 10,
    evaluation_guidance: [
      { score: 1, description: 'All sentences nearly identical length; monotonous rhythm.' },
      { score: 5, description: 'Some variation but most sentences cluster in one length range.' },
      { score: 10, description: 'Strong rhythm — short sentences punch, long sentences develop, balanced throughout.' },
    ],
  },
];

export interface SeedResult {
  inserted: number;
  skipped: number;
  errors: string[];
}

/** Upsert all sample criteria with ON CONFLICT (name) DO NOTHING semantics. */
export async function seedSampleCriteria(
  supabaseUrl: string,
  supabaseKey: string,
  options: { dryRun?: boolean } = {},
): Promise<SeedResult> {
  const errors: string[] = [];
  let inserted = 0;
  let skipped = 0;

  if (options.dryRun) {
    for (const c of SAMPLE_CRITERIA) {
      console.log(`[seedSampleCriteria] would insert ${c.name} (${c.min_rating}-${c.max_rating}, ${c.evaluation_guidance.length} anchors)`);
    }
    return { inserted: 0, skipped: SAMPLE_CRITERIA.length, errors: [] };
  }

  const db = createClient(supabaseUrl, supabaseKey);

  for (const c of SAMPLE_CRITERIA) {
    // Check if a row with this name already exists (ON CONFLICT DO NOTHING semantics)
    const { data: existing } = await db
      .from('evolution_criteria')
      .select('id')
      .eq('name', c.name)
      .is('deleted_at', null)
      .limit(1);

    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const { error } = await db
      .from('evolution_criteria')
      .insert({
        name: c.name,
        description: c.description,
        min_rating: c.min_rating,
        max_rating: c.max_rating,
        evaluation_guidance: c.evaluation_guidance,
      });

    if (error) {
      errors.push(`Failed to insert '${c.name}': ${error.message}`);
    } else {
      inserted++;
    }
  }

  return { inserted, skipped, errors };
}

// CLI entry point
if (require.main === module || process.argv[1]?.endsWith('seedSampleCriteria.ts')) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dryRun = process.argv.includes('--dry-run');

  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const host = (() => {
    try { return new URL(url).host; } catch { return '<invalid-url>'; }
  })();

  seedSampleCriteria(url, key, { dryRun }).then((result) => {
    const tag = dryRun ? '[seedSampleCriteria] (dry-run)' : '[seedSampleCriteria]';
    console.log(`${tag} supabase_url=${host} inserted=${result.inserted} skipped=${result.skipped}`);
    if (result.errors.length > 0) {
      console.error('Errors:', result.errors);
      process.exit(1);
    }
  }).catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
