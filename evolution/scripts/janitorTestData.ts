// Janitor — periodic cleanup of stale test-content evolution data.
// reduce_e2e_testing_llm_costs_20260621 Phase 3.
//
// After the gate (20260621000001_evolution_claim_gate.sql) shipped, pending runs
// inserted by E2E/integration tests are no longer claimed by the systemd runner,
// so they accumulate in staging as un-claimable `pending` rows along with their
// `[TEST]` / `[TEST_EVO]` strategies and prompts.
//
// This script deletes `evolution_strategies` rows where `is_test_content=true`
// and `last_used_at < now() - interval '14 days'`, plus their dependent rows.
// `evolution_runs.strategy_id` FK is ON DELETE RESTRICT, so we must clear
// dependents first:
//   1. evolution_runs (id IN test-runs) → CASCADE drops variants/invocations/logs/comparisons
//   2. evolution_strategies (id IN test-strategies)
//
// Paginated at LIMIT 50 per batch with 250ms sleep between batches to avoid
// Supabase rate-limits. Dry-run default; --apply for actual deletes.
//
// Usage:
//   npx tsx evolution/scripts/janitorTestData.ts                  # dry-run
//   npx tsx evolution/scripts/janitorTestData.ts --apply          # apply
//   npx tsx evolution/scripts/janitorTestData.ts --days 7         # custom TTL
//
// CI: .github/workflows/evolution-test-data-cleanup.yml runs weekly Mondays 06:00 UTC.

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

const BATCH_SIZE = 50;
const BATCH_SLEEP_MS = 250;
const MAX_BATCHES = 100; // sanity cap — 5000 strategies max per run
const SANITY_TOTAL_CAP = 5000; // abort if first batch reveals > 5000 candidates

interface Args {
  apply: boolean;
  days: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const daysIdx = argv.indexOf('--days');
  const daysVal = daysIdx >= 0 ? argv[daysIdx + 1] : argv.find(a => a.startsWith('--days='))?.split('=')[1];
  const days = daysVal ? Number(daysVal) : 14;
  if (!Number.isFinite(days) || days < 1) {
    console.error(`Invalid --days value: ${daysVal}`);
    process.exit(2);
  }
  return { apply, days };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }
  const db = createClient<Database>(url, key);

  console.log(`Janitor: TTL=${args.days}d | mode=${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  const cutoffMs = Date.now() - args.days * 86_400_000;
  const cutoffISO = new Date(cutoffMs).toISOString();
  console.log(`Cutoff: last_used_at < ${cutoffISO}`);

  const peek = await db
    .from('evolution_strategies')
    .select('id', { count: 'exact', head: true })
    .eq('is_test_content', true)
    .lt('last_used_at', cutoffISO);
  if (peek.error) {
    console.error('Sanity peek failed:', peek.error.message);
    process.exit(1);
  }
  const totalCandidates = peek.count ?? 0;
  console.log(`Total candidate strategies: ${totalCandidates}`);
  if (totalCandidates === 0) {
    console.log('Nothing to delete. Exiting clean.');
    return;
  }
  if (totalCandidates > SANITY_TOTAL_CAP) {
    console.error(`Aborting — ${totalCandidates} candidates exceeds sanity cap ${SANITY_TOTAL_CAP}.`);
    console.error('Run with smaller --days window to chunk, or raise the cap intentionally.');
    process.exit(1);
  }

  let totalStrategiesDeleted = 0;
  let totalRunsDeleted = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const stratBatch = await db
      .from('evolution_strategies')
      .select('id, name, last_used_at')
      .eq('is_test_content', true)
      .lt('last_used_at', cutoffISO)
      .order('last_used_at', { ascending: true })
      .limit(BATCH_SIZE);
    if (stratBatch.error) {
      console.error(`Batch ${batch} strategy select failed:`, stratBatch.error.message);
      process.exit(1);
    }
    if (!stratBatch.data?.length) {
      console.log(`Batch ${batch}: no more candidates`);
      break;
    }
    const stratIds = stratBatch.data.map(r => r.id as string);
    console.log(`Batch ${batch}: ${stratIds.length} strategies`);

    const runsRes = await db
      .from('evolution_runs')
      .select('id')
      .in('strategy_id', stratIds);
    if (runsRes.error) {
      console.error(`Batch ${batch} runs lookup failed:`, runsRes.error.message);
      process.exit(1);
    }
    const runIds = (runsRes.data ?? []).map(r => r.id as string);

    if (!args.apply) {
      console.log(`  [DRY-RUN] would delete ${runIds.length} runs + ${stratIds.length} strategies`);
      totalRunsDeleted += runIds.length;
      totalStrategiesDeleted += stratIds.length;
    } else {
      if (runIds.length > 0) {
        const delRuns = await db.from('evolution_runs').delete().in('id', runIds);
        if (delRuns.error) {
          console.error(`Batch ${batch} runs delete failed:`, delRuns.error.message);
          process.exit(1);
        }
      }
      const delStrats = await db.from('evolution_strategies').delete().in('id', stratIds);
      if (delStrats.error) {
        console.error(`Batch ${batch} strategies delete failed:`, delStrats.error.message);
        process.exit(1);
      }
      console.log(`  deleted ${runIds.length} runs + ${stratIds.length} strategies`);
      totalRunsDeleted += runIds.length;
      totalStrategiesDeleted += stratIds.length;
    }

    if (stratIds.length < BATCH_SIZE) break;
    await new Promise(r => setTimeout(r, BATCH_SLEEP_MS));
  }

  console.log();
  console.log(`Janitor complete. ${args.apply ? 'Deleted' : 'Would delete'} ${totalStrategiesDeleted} strategies + ${totalRunsDeleted} runs.`);

  if (process.env.GITHUB_OUTPUT) {
    const out = [`strategies_deleted=${totalStrategiesDeleted}`, `runs_deleted=${totalRunsDeleted}`, `dry_run=${args.apply ? 'false' : 'true'}`].join('\n');
    await import('fs').then(fs => fs.promises.appendFile(process.env.GITHUB_OUTPUT!, out + '\n'));
  }
}

main().catch(e => {
  console.error('Janitor fatal error:', e);
  process.exit(1);
});
