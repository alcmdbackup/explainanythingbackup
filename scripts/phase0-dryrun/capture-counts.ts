// Phase 0/5 row-count helper: capture per-table row counts to a JSON file.
// Run twice — once before the reset SQL, once after — then feed both files
// to diff-counts.ts to verify Phase 5 expectations.
//
// Usage:
//   tsx scripts/phase0-dryrun/capture-counts.ts pre  > /tmp/counts-pre.json
//   tsx scripts/phase0-dryrun/capture-counts.ts post > /tmp/counts-post.json
//
// Reads connection string from env var DATABASE_URL_FOR_COUNTS. Recommended
// sources:
//   - PROD_READONLY_DATABASE_URL   (from .env.prod.readonly — physically
//     SELECT-only, no possibility of writes from this script)
//   - STAGING_READONLY_DATABASE_URL (from .env.staging.readonly)
//
// Example:
//   set -a; source .env.prod.readonly; set +a
//   DATABASE_URL_FOR_COUNTS=$PROD_READONLY_DATABASE_URL \
//     npx tsx scripts/phase0-dryrun/capture-counts.ts pre > /tmp/counts-pre-prod.json
//
// Why a pg connection instead of the Supabase JS client: the readonly_local
// role has only SELECT privileges. Using that DSN means the harness physically
// cannot mutate the target — strongest possible safety guarantee.

import { Client } from 'pg';

type PhaseLabel = 'pre' | 'post';

const TABLES = {
  explainanything_truncated: [
    'userExplanationEvents',
    'userQueries',
    'userLibrary',
    'explanationMetrics',
    'content_reports',
    'candidate_occurrences',
    'link_candidates',
    'article_link_overrides',
    'article_heading_links',
    'article_sources',
    'link_whitelist_snapshot',
    'link_whitelist_aliases',
    'link_whitelist',
    'source_cache',
    'explanation_tags',
    'topics',
  ],
  explanations_deleted: ['explanations'],
  evolution_preserved: [
    'evolution_runs',
    'evolution_variants',
    'evolution_explanations',
    'evolution_experiments',
    'evolution_arena_comparisons',
    'evolution_agent_invocations',
    'evolution_logs',
    'evolution_run_logs',
    'evolution_metrics',
    'evolution_prompts',
    'evolution_strategies',
    'evolution_tactics',
    'evolution_criteria',
    'evolution_cost_calibration',
  ],
  shared_preserved: ['llmCallTracking', 'llm_cost_config', 'daily_cost_rollups'],
  untouched_reference: ['tags', 'admin_users', 'admin_audit_log'],
} as const;

async function main(): Promise<void> {
  const phase = (process.argv[2] ?? '') as PhaseLabel;
  if (phase !== 'pre' && phase !== 'post') {
    console.error('Usage: tsx capture-counts.ts <pre|post>');
    console.error('Env: DATABASE_URL_FOR_COUNTS=<postgres connection string>');
    process.exit(1);
  }

  const dsn = process.env.DATABASE_URL_FOR_COUNTS;
  if (!dsn) {
    console.error('Missing DATABASE_URL_FOR_COUNTS env var.');
    console.error('Recommended: export DATABASE_URL_FOR_COUNTS=$PROD_READONLY_DATABASE_URL');
    console.error('after sourcing .env.prod.readonly (or .env.staging.readonly).');
    process.exit(1);
  }

  // Extract project ref from DSN. Format options:
  //   - pooler:  postgresql://USER.PROJECTREF:PASS@aws-1-...pooler.supabase.com/...
  //   - direct:  postgresql://USER:PASS@db.PROJECTREF.supabase.co/...
  const projectRef =
    dsn.match(/[._]([a-z0-9]{20})[.:@]/)?.[1] ??
    dsn.match(/db\.([a-z0-9]{20})\.supabase\.co/)?.[1] ??
    'unknown';
  console.error(`[capture-counts] connecting to project ref ${projectRef} (phase=${phase})`);

  const client = new Client({ connectionString: dsn });
  await client.connect();

  // Defensive: assert the role is read-only. If it's not readonly_local
  // (e.g. operator accidentally passed a service-role DSN), warn loudly.
  try {
    const { rows } = await client.query<{ current_user: string }>('SELECT current_user');
    const user = rows[0]?.current_user ?? 'unknown';
    if (!user.startsWith('readonly_')) {
      console.error(`[capture-counts] WARNING: current_user is '${user}', not a readonly_* role.`);
      console.error('[capture-counts] This script ONLY needs SELECT — using a writable role is risky.');
    }
  } catch (err) {
    console.error('[capture-counts] could not check current_user:', (err as Error).message);
  }

  const result: Record<string, unknown> = {
    _meta: {
      phase,
      timestamp: new Date().toISOString(),
      project_ref: projectRef,
    },
  };

  for (const [bucket, list] of Object.entries(TABLES)) {
    const bucketResult: Record<string, number | string> = {};
    for (const table of list) {
      try {
        const { rows } = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM "${table}"`,
        );
        bucketResult[table] = Number(rows[0]?.count ?? 0);
      } catch (err) {
        bucketResult[table] = `ERROR: ${(err as Error).message}`;
      }
    }
    result[bucket] = bucketResult;
  }

  await client.end();

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
