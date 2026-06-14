// Seed sample judge rubrics into evolution_judge_rubrics (+ dimensions junction).
//
// A judge rubric is a reusable named bundle of judging dimensions (each a reference
// to an evolution_criteria row + a weight) used by rubric-based pairwise judging.
// These samples reference the criteria seeded by seedSampleCriteria.ts, so run that
// first. Idempotent: a rubric whose name already exists is skipped; re-runs do not
// overwrite researcher edits. Weights are NOT required to sum to 1 — they are
// normalized at read time.
//
// Run command:
//
//   NEXT_PUBLIC_SUPABASE_URL=$URL SUPABASE_SERVICE_ROLE_KEY=$KEY \
//     npx tsx evolution/scripts/seedSampleJudgeRubrics.ts
//
// Add `--dry-run` to print what would be inserted without writing. Researchers can
// edit/archive/delete rubrics through the admin UI (`/admin/evolution/judge-rubrics`).

import { createClient } from '@supabase/supabase-js';

interface SampleRubric {
  name: string;
  label: string;
  description: string;
  /** Each dimension references a seeded criterion by name + a weight. */
  dimensions: ReadonlyArray<{ criterionName: string; weight: number }>;
}

export const SAMPLE_RUBRICS: ReadonlyArray<SampleRubric> = [
  {
    name: 'Balanced Quality',
    label: 'Balanced',
    description: 'Equal weight across clarity, structure, depth, and engagement — a neutral all-round judge.',
    dimensions: [
      { criterionName: 'clarity', weight: 1 },
      { criterionName: 'structure', weight: 1 },
      { criterionName: 'depth', weight: 1 },
      { criterionName: 'engagement', weight: 1 },
    ],
  },
  {
    name: 'Structure-Weighted',
    label: 'Structure-heavy',
    description: 'Weights structure most heavily (0.50), then clarity (0.30) and engagement (0.20) — demonstrates how weighting changes outcomes.',
    dimensions: [
      { criterionName: 'structure', weight: 0.5 },
      { criterionName: 'clarity', weight: 0.3 },
      { criterionName: 'engagement', weight: 0.2 },
    ],
  },
];

export interface SeedResult {
  inserted: number;
  skipped: number;
  errors: string[];
}

/** Seed sample rubrics; skip any whose name already exists. */
export async function seedSampleJudgeRubrics(
  supabaseUrl: string,
  supabaseKey: string,
  options: { dryRun?: boolean } = {},
): Promise<SeedResult> {
  const errors: string[] = [];
  let inserted = 0;
  let skipped = 0;

  if (options.dryRun) {
    for (const r of SAMPLE_RUBRICS) {
      console.log(`[seedSampleJudgeRubrics] would insert "${r.name}" (${r.dimensions.length} dimensions)`);
    }
    return { inserted: 0, skipped: SAMPLE_RUBRICS.length, errors: [] };
  }

  const db = createClient(supabaseUrl, supabaseKey);

  // Resolve criterion names → ids once.
  const allNames = [...new Set(SAMPLE_RUBRICS.flatMap((r) => r.dimensions.map((d) => d.criterionName)))];
  const { data: critRows, error: critErr } = await db
    .from('evolution_criteria')
    .select('id, name')
    .in('name', allNames)
    .eq('status', 'active')
    .is('deleted_at', null);
  if (critErr) return { inserted: 0, skipped: 0, errors: [`Criteria lookup failed: ${critErr.message}`] };
  const idByName = new Map((critRows ?? []).map((c) => [c.name as string, c.id as string]));

  for (const r of SAMPLE_RUBRICS) {
    const { data: existing } = await db
      .from('evolution_judge_rubrics')
      .select('id')
      .eq('name', r.name)
      .is('deleted_at', null)
      .limit(1);
    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const missing = r.dimensions.filter((d) => !idByName.has(d.criterionName));
    if (missing.length > 0) {
      errors.push(`"${r.name}": missing criteria ${missing.map((m) => m.criterionName).join(', ')} (run seedSampleCriteria first)`);
      continue;
    }

    const { data: rubric, error: insErr } = await db
      .from('evolution_judge_rubrics')
      .insert({ name: r.name, label: r.label, description: r.description })
      .select('id')
      .single();
    if (insErr || !rubric) {
      errors.push(`Failed to insert "${r.name}": ${insErr?.message ?? 'no row'}`);
      continue;
    }

    const dimRows = r.dimensions.map((d, i) => ({
      rubric_id: rubric.id as string,
      criteria_id: idByName.get(d.criterionName)!,
      weight: d.weight,
      position: i,
    }));
    const { error: dimErr } = await db.from('evolution_judge_rubric_dimensions').insert(dimRows);
    if (dimErr) {
      errors.push(`Failed to insert dimensions for "${r.name}": ${dimErr.message}`);
    } else {
      inserted++;
    }
  }

  return { inserted, skipped, errors };
}

// CLI entry point
if (require.main === module || process.argv[1]?.endsWith('seedSampleJudgeRubrics.ts')) {
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

  seedSampleJudgeRubrics(url, key, { dryRun }).then((result) => {
    const tag = dryRun ? '[seedSampleJudgeRubrics] (dry-run)' : '[seedSampleJudgeRubrics]';
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
