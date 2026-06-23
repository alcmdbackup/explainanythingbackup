// Test-bucket cost check for evolution.
// reduce_e2e_testing_llm_costs_20260621 Phase 3.
//
// Sums `evolution_agent_invocations.cost_usd` for runs whose strategy is
// `is_test_content=true`, over a configurable window. Used in two ways:
//   1. 7-day post-merge verification: `--days 7 --threshold 0.50`
//   2. Daily alarm (.github/workflows/evolution-cost-alarm.yml):
//        `--days 1 --threshold 0.10 --soft 0.05`
//
// Args:
//   --days N         window in days (default 7)
//   --threshold N    hard threshold in USD; exit 1 if exceeded (default 0.50)
//   --soft N         soft threshold in USD; warn only (default = threshold / 2)
//
// Emits structured JSON to stdout + GITHUB_OUTPUT vars: total_usd, days,
// threshold, soft, status ('ok' | 'soft_warn' | 'hard_alarm'). Hard alarm exits
// with code 1 so the workflow `if: failure()` branch fires the Slack + issue.
//
// Pulls invocations + run.strategy_id in one Supabase call via the `runs!inner`
// nested select, filtering `runs.strategies.is_test_content = true` server-side.

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

interface Args {
  days: number;
  threshold: number;
  soft: number;
}

function arg(name: string, fallback: number): number {
  const a = process.argv.find(x => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return fallback;
  if (a.includes('=')) return Number(a.split('=')[1]);
  const idx = process.argv.indexOf(a);
  return Number(process.argv[idx + 1] ?? fallback);
}

function parseArgs(): Args {
  const days = arg('days', 7);
  const threshold = arg('threshold', 0.50);
  const soft = arg('soft', threshold / 2);
  for (const [n, v] of [['days', days], ['threshold', threshold], ['soft', soft]]) {
    if (!Number.isFinite(v as number) || (v as number) <= 0) {
      console.error(`Invalid --${n}: ${v}`);
      process.exit(2);
    }
  }
  return { days, threshold, soft };
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

  const since = new Date(Date.now() - args.days * 86_400_000).toISOString();

  // Pass 1: gather all test-strategy IDs.
  const testStrategyIds = new Set<string>();
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const r = await db
        .from('evolution_strategies')
        .select('id')
        .eq('is_test_content', true)
        .range(from, from + PAGE - 1);
      if (r.error) {
        console.error('strategies query failed:', r.error.message);
        process.exit(1);
      }
      const rows = r.data ?? [];
      for (const row of rows) testStrategyIds.add(row.id as string);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }

  if (testStrategyIds.size === 0) {
    await emit({ total_usd: 0, days: args.days, threshold: args.threshold, soft: args.soft, status: 'ok', sample_rows: 0 });
    return;
  }

  // Pass 2: collect run IDs for test strategies that overlap the window.
  // Filter by run.created_at >= since AS A PROXY (invocations on a run created
  // before the window but invoked inside it would be missed, but the runner
  // completes runs within minutes, so created_at vs invocation.created_at is
  // close enough for a daily/weekly alarm). The runs.strategy_id IN (...) query
  // is chunked since PostgREST URL filters cap around ~1000 IDs.
  const testRunIds = new Set<string>();
  {
    const CHUNK = 100;
    const stratArr = Array.from(testStrategyIds);
    for (let i = 0; i < stratArr.length; i += CHUNK) {
      const slice = stratArr.slice(i, i + CHUNK);
      const PAGE = 1000;
      let from = 0;
      for (;;) {
        const r = await db
          .from('evolution_runs')
          .select('id')
          .in('strategy_id', slice)
          .gte('created_at', since)
          .range(from, from + PAGE - 1);
        if (r.error) {
          console.error('runs query failed:', r.error.message);
          process.exit(1);
        }
        const rows = r.data ?? [];
        for (const row of rows) testRunIds.add(row.id as string);
        if (rows.length < PAGE) break;
        from += PAGE;
      }
    }
  }

  if (testRunIds.size === 0) {
    await emit({ total_usd: 0, days: args.days, threshold: args.threshold, soft: args.soft, status: 'ok', sample_rows: 0 });
    return;
  }

  // Pass 3: sum invocation costs for those run IDs in the window.
  let totalUsd = 0;
  let sampleRows = 0;
  {
    const CHUNK = 100;
    const runArr = Array.from(testRunIds);
    for (let i = 0; i < runArr.length; i += CHUNK) {
      const slice = runArr.slice(i, i + CHUNK);
      const PAGE = 1000;
      let from = 0;
      for (;;) {
        const r = await db
          .from('evolution_agent_invocations')
          .select('cost_usd')
          .in('run_id', slice)
          .gte('created_at', since)
          .range(from, from + PAGE - 1);
        if (r.error) {
          console.error('invocations query failed:', r.error.message);
          process.exit(1);
        }
        const rows = r.data ?? [];
        for (const row of rows) {
          totalUsd += Number(row.cost_usd ?? 0);
          sampleRows += 1;
        }
        if (rows.length < PAGE) break;
        from += PAGE;
      }
    }
  }

  const status: 'ok' | 'soft_warn' | 'hard_alarm' =
    totalUsd >= args.threshold ? 'hard_alarm' : totalUsd >= args.soft ? 'soft_warn' : 'ok';

  emit({ total_usd: totalUsd, days: args.days, threshold: args.threshold, soft: args.soft, status, sample_rows: sampleRows });

  if (status === 'hard_alarm') process.exit(1);
}

interface Out {
  total_usd: number;
  days: number;
  threshold: number;
  soft: number;
  status: 'ok' | 'soft_warn' | 'hard_alarm';
  sample_rows: number;
}

async function emit(o: Out): Promise<void> {
  console.log(JSON.stringify(o, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    const out = [
      `total_usd=${o.total_usd.toFixed(6)}`,
      `days=${o.days}`,
      `threshold=${o.threshold}`,
      `soft=${o.soft}`,
      `status=${o.status}`,
      `sample_rows=${o.sample_rows}`,
    ].join('\n');
    await import('fs').then(fs => fs.promises.appendFile(process.env.GITHUB_OUTPUT!, out + '\n'));
  }
}

main().catch(e => {
  console.error('cost-check fatal:', e);
  process.exit(1);
});
