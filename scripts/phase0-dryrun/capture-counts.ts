// Phase 0 dry-run helper: capture per-table row counts to a JSON file.
// Run twice against staging — once before the reset SQL, once after — then
// feed both files to diff-counts.ts to verify Phase 5 expectations.
//
// Usage:
//   tsx scripts/phase0-dryrun/capture-counts.ts pre  > /tmp/counts-pre.json
//   tsx scripts/phase0-dryrun/capture-counts.ts post > /tmp/counts-post.json
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env. ALWAYS
// run against staging — refuses to run if the URL points at production.

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const PROD_URL_FRAGMENTS = ['ifubinffdbyewoezcidz']; // prod project ref — refuse if URL matches

type PhaseLabel = 'pre' | 'post';

async function main(): Promise<void> {
  const phase = (process.argv[2] ?? '') as PhaseLabel;
  if (phase !== 'pre' && phase !== 'post') {
    console.error('Usage: tsx capture-counts.ts <pre|post>');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (PROD_URL_FRAGMENTS.some((f) => url.includes(f))) {
    console.error(`Refusing to run against production: URL contains ${PROD_URL_FRAGMENTS.join(' | ')}`);
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Discover all public.* tables via a SECURITY DEFINER RPC if available, else
  // a fixed list. We hardcode the list because exec_sql isn't enabled by default
  // on Supabase and discovery via the REST API is awkward.
  const tables = {
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
  };

  const result: Record<string, Record<string, number | string>> = {
    _meta: {
      phase,
      timestamp: new Date().toISOString(),
      url_fragment: url.split('//')[1]?.split('.')[0] ?? 'unknown',
    },
  };

  for (const [bucket, list] of Object.entries(tables)) {
    result[bucket] = {};
    for (const table of list) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        if (error) {
          result[bucket]![table] = `ERROR: ${error.message}`;
        } else {
          result[bucket]![table] = count ?? 0;
        }
      } catch (err) {
        result[bucket]![table] = `THROWN: ${(err as Error).message}`;
      }
    }
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
