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
//
// 2026-05-03: `point_of_view` and `engagement` rubric anchors revised based on the
// understand_critera_agent_performance_evolution_20260503 investigation. Original
// anchors penalized neutral writing for educational content (POV scored 4.15/10 avg,
// pushing 96.8% of variants toward opinionated framing) and demanded page-turner
// pacing (engagement). Reframed POV around authorial-voice/pedagogical-fit and
// engagement around logical-pacing/example-sequencing. See
// `docs/planning/understand_critera_agent_performance_evolution_20260503/` for the
// full investigation. Existing staging/prod rows are NOT updated by this script
// (skip-if-exists semantics); `evolution/scripts/updatePovEngagementRubrics.ts` is
// the in-place update tool for those.

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
    description: 'Logical pacing and example sequencing — does the reader feel guided from one idea to the next, with examples that build understanding?',
    min_rating: 1,
    max_rating: 10,
    evaluation_guidance: [
      { score: 1, description: 'Examples appear randomly or as bullet-list filler; transitions between concepts are abrupt or absent.' },
      { score: 5, description: 'Examples are present and mostly relevant, but transitions feel mechanical and pacing is uneven.' },
      { score: 10, description: 'Each example builds on the last; transitions feel inevitable; pacing matches the cognitive load of the material.' },
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
    description: 'Clarity of authorial voice and pedagogical framing — does the reader understand who is explaining this and why each section is included?',
    min_rating: 1,
    max_rating: 10,
    evaluation_guidance: [
      { score: 1, description: 'No discernible voice; the article reads like disconnected facts with no guiding intent.' },
      { score: 5, description: 'Voice is present but inconsistent; the framing of why-this-matters appears in some sections and is missing in others.' },
      { score: 10, description: 'Strong, consistent authorial voice; the reader always understands the framing and why each section is included.' },
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
