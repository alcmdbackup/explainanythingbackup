// Phase 1 helper for understand_critera_agent_performance_evolution_20260503.
//
// Updates the `point_of_view` and `engagement` rubrics in `evolution_criteria` with
// reframed anchors better suited to educational content (the original seeded anchors
// penalized neutral writing and demanded page-turner pacing — see project research
// doc for the full investigation). Does NOT change name or rating bounds, so the
// `is_test_content` BEFORE-trigger and the `evolution_criteria_rubric_anchors_in_range`
// CHECK constraint are both satisfied.
//
// Run command (staging first; only mirror to prod after Phase 1 validation passes):
//
//   NEXT_PUBLIC_SUPABASE_URL=$STAGING_URL SUPABASE_SERVICE_ROLE_KEY=$STAGING_KEY \
//     npx tsx evolution/scripts/updatePovEngagementRubrics.ts --dry-run
//   NEXT_PUBLIC_SUPABASE_URL=$STAGING_URL SUPABASE_SERVICE_ROLE_KEY=$STAGING_KEY \
//     npx tsx evolution/scripts/updatePovEngagementRubrics.ts --apply
//
// Pre-edit rubric snapshot is captured in the project's _research.md as rollback insurance.

import { createClient } from '@supabase/supabase-js';

interface RubricUpdate {
  name: string;
  description: string;
  evaluation_guidance: ReadonlyArray<{ score: number; description: string }>;
}

const UPDATES: ReadonlyArray<RubricUpdate> = [
  {
    name: 'point_of_view',
    description:
      'Clarity of authorial voice and pedagogical framing — does the reader understand who is explaining this and why each section is included?',
    evaluation_guidance: [
      { score: 1, description: 'No discernible voice; the article reads like disconnected facts with no guiding intent.' },
      { score: 5, description: 'Voice is present but inconsistent; the framing of why-this-matters appears in some sections and is missing in others.' },
      { score: 10, description: 'Strong, consistent authorial voice; the reader always understands the framing and why each section is included.' },
    ],
  },
  {
    name: 'engagement',
    description:
      'Logical pacing and example sequencing — does the reader feel guided from one idea to the next, with examples that build understanding?',
    evaluation_guidance: [
      { score: 1, description: 'Examples appear randomly or as bullet-list filler; transitions between concepts are abrupt or absent.' },
      { score: 5, description: 'Examples are present and mostly relevant, but transitions feel mechanical and pacing is uneven.' },
      { score: 10, description: 'Each example builds on the last; transitions feel inevitable; pacing matches the cognitive load of the material.' },
    ],
  },
];

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');

  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!dryRun && !apply) {
    console.error('Specify either --dry-run or --apply');
    process.exit(1);
  }

  const host = new URL(url).host;
  console.log(`[updatePovEngagementRubrics] supabase_url=${host} mode=${dryRun ? 'dry-run' : 'apply'}`);

  const db = createClient(url, key);

  for (const u of UPDATES) {
    const { data: existing, error: readErr } = await db
      .from('evolution_criteria')
      .select('id, name, description, evaluation_guidance')
      .eq('name', u.name)
      .is('deleted_at', null)
      .single();

    if (readErr || !existing) {
      console.error(`[${u.name}] row not found or read failed: ${readErr?.message ?? 'no row'}`);
      process.exit(1);
    }

    console.log(`\n[${u.name}] (${existing.id})`);
    console.log(`  before description: ${existing.description}`);
    console.log(`  after  description: ${u.description}`);
    console.log(`  before anchors: ${JSON.stringify(existing.evaluation_guidance)}`);
    console.log(`  after  anchors: ${JSON.stringify(u.evaluation_guidance)}`);

    if (dryRun) {
      console.log(`  [dry-run] no write performed`);
      continue;
    }

    const { error: writeErr } = await db
      .from('evolution_criteria')
      .update({
        description: u.description,
        evaluation_guidance: u.evaluation_guidance,
      })
      .eq('id', existing.id);

    if (writeErr) {
      console.error(`[${u.name}] update failed: ${writeErr.message}`);
      process.exit(1);
    }
    console.log(`  ✓ updated`);
  }

  console.log(`\n[updatePovEngagementRubrics] done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
