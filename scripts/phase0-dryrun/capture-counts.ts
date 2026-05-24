// Phase 0/5 row-count helper: capture per-table row counts to a JSON file.
// Run twice — once before the reset SQL, once after — then feed both files
// to diff-counts.ts to verify Phase 5 expectations.
//
// Usage (against staging, default):
//   tsx scripts/phase0-dryrun/capture-counts.ts pre  > /tmp/counts-pre.json
//   tsx scripts/phase0-dryrun/capture-counts.ts post > /tmp/counts-post.json
//
// Usage (against production — Phase 5 collapse path; explicit opt-in required):
//   PHASE_ALLOW_PROD=I_KNOW_THIS_IS_PROD tsx ... pre  --allow-prod
//   PHASE_ALLOW_PROD=I_KNOW_THIS_IS_PROD tsx ... post --allow-prod
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env. Refuses
// to run against production unless --allow-prod is passed AND the env var
// PHASE_ALLOW_PROD=I_KNOW_THIS_IS_PROD is set (defense in depth — both required).

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const PROD_URL_FRAGMENTS = ['ifubinffdbyewoezcidz']; // prod project ref
const PROD_ALLOW_TOKEN = 'I_KNOW_THIS_IS_PROD';

type PhaseLabel = 'pre' | 'post';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const phase = args.find((a) => a === 'pre' || a === 'post') as PhaseLabel | undefined;
  const allowProd = args.includes('--allow-prod');
  if (!phase) {
    console.error('Usage: tsx capture-counts.ts <pre|post> [--allow-prod]');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const isProd = PROD_URL_FRAGMENTS.some((f) => url.includes(f));
  if (isProd) {
    if (!allowProd) {
      console.error(`Refusing to run against production without --allow-prod. URL contains ${PROD_URL_FRAGMENTS.join(' | ')}`);
      process.exit(1);
    }
    if (process.env.PHASE_ALLOW_PROD !== PROD_ALLOW_TOKEN) {
      console.error(`--allow-prod passed but PHASE_ALLOW_PROD env var is not set to '${PROD_ALLOW_TOKEN}'. Refusing.`);
      process.exit(1);
    }
    console.error(`[capture-counts] WARNING: running read-only count against PRODUCTION (${url.split('//')[1]?.split('.')[0]})`);
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
