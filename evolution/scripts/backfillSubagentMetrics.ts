// Backfill script for subagent:* metric rows on historical runs.
//
// rename_agents_subagents_evolution_20260508 Phase 3.
//
// For every existing evolution_runs row with status='completed', this script:
//   1. Fetches the run's invocations + their execution_detail JSONB.
//   2. Dispatches each invocation through the shared parser at
//      evolution/src/lib/shared/subagentTreeParser.ts (same module the UI Subagents
//      tab + the run-finalize write path use).
//   3. Sums per-subagent cost / duration_ms / count.
//   4. Writes subagent:<name>.<measure> rows at run, strategy, and experiment levels
//      via three explicit writeMetricMax calls each — mirrors the eloAttrDelta:*
//      pattern in computeEloAttributionMetrics.
//
// Usage:
//   npx tsx evolution/scripts/backfillSubagentMetrics.ts            # dry run (default)
//   npx tsx evolution/scripts/backfillSubagentMetrics.ts --apply    # actually write
//   npx tsx evolution/scripts/backfillSubagentMetrics.ts --apply --run-id <uuid>  # one run
//
// Idempotent: writeMetricMax uses GREATEST-on-conflict, so re-running the script over
// the same fixture does not duplicate or regress rows. Monotonic-up caveat: too-high
// values cannot be corrected by re-running; corrections require a separate one-shot
// repair script.

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { writeMetricMax } from '../src/lib/metrics/writeMetrics';
import type { MetricName } from '../src/lib/metrics/types';
import {
  parseSubagentTreeByAgentName,
  type SubagentNode,
} from '../src/lib/shared/subagentTreeParser';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const SUBAGENT_ALLOWLIST = new Set<string>([
  'reflection', 'generation', 'ranking', 'comparison',
  'evaluate_and_suggest',
  'cycle.propose', 'cycle.review', 'cycle.apply',
  'drift_recovery', 'approve_forward', 'approve_mirror',
  'seed_title', 'seed_article',
  'merge', 'pair',
]);

function accumulate(
  nodes: SubagentNode[],
  acc: Map<string, { cost: number; durationMs: number; count: number }>,
  parentName?: string,
): void {
  for (const node of nodes) {
    const groupKey = node.name.startsWith('comparison.') ? 'comparison'
      : node.name.startsWith('pair.') ? 'pair'
      : node.name.startsWith('cycle.') ? `cycle.${parentName ?? 'unknown'}`
      : parentName === 'cycle' ? `cycle.${node.name}`
      : node.name;
    if (SUBAGENT_ALLOWLIST.has(groupKey)) {
      const cur = acc.get(groupKey) ?? { cost: 0, durationMs: 0, count: 0 };
      cur.cost += Number.isFinite(node.costUsd) ? node.costUsd : 0;
      cur.durationMs += Number.isFinite(node.durationMs) ? node.durationMs : 0;
      cur.count += node.kind === 'LLM' ? 1 : 0;
      acc.set(groupKey, cur);
    }
    if (node.children.length > 0) {
      accumulate(
        node.children,
        acc,
        node.name.startsWith('cycle.') ? 'cycle' : node.name,
      );
    }
  }
}

async function backfillRun(
  db: ReturnType<typeof createClient>,
  run: { id: string; strategy_id: string | null; experiment_id: string | null },
  apply: boolean,
): Promise<{ written: number; skipped: number }> {
  const { data: invocations, error } = await db
    .from('evolution_agent_invocations')
    .select('agent_name, execution_detail')
    .eq('run_id', run.id);
  if (error) {
    console.error(`[run ${run.id}] error fetching invocations:`, error.message);
    return { written: 0, skipped: 1 };
  }
  if (!invocations || invocations.length === 0) {
    return { written: 0, skipped: 0 };
  }

  const sums = new Map<string, { cost: number; durationMs: number; count: number }>();
  for (const inv of invocations) {
    try {
      const tree = parseSubagentTreeByAgentName(
        (inv as { agent_name: string }).agent_name,
        (inv as { execution_detail: Record<string, unknown> | null }).execution_detail,
      );
      accumulate(tree, sums);
    } catch (err) {
      console.warn(`[run ${run.id}] parser failed for invocation, skipping:`, err);
    }
  }

  if (sums.size === 0) {
    console.log(`[run ${run.id}] no subagents extracted`);
    return { written: 0, skipped: 0 };
  }

  if (!apply) {
    console.log(`[run ${run.id}] would write ${sums.size} subagent groups:`);
    for (const [name, agg] of sums) {
      console.log(`  subagent:${name}.cost = ${agg.cost.toFixed(6)} (count=${agg.count}, ms=${agg.durationMs})`);
    }
    return { written: sums.size, skipped: 0 };
  }

  let written = 0;
  for (const [name, agg] of sums) {
    if (Number.isFinite(agg.cost) && agg.cost > 0) {
      const metricName = `subagent:${name}.cost` as MetricName;
      await writeMetricMax(db as never, 'run', run.id, metricName, agg.cost, 'at_finalization');
      if (run.strategy_id) {
        await writeMetricMax(db as never, 'strategy', run.strategy_id, metricName, agg.cost, 'at_finalization');
      }
      if (run.experiment_id) {
        await writeMetricMax(db as never, 'experiment', run.experiment_id, metricName, agg.cost, 'at_finalization');
      }
      written++;
    }
    if (Number.isFinite(agg.durationMs) && agg.durationMs > 0) {
      const metricName = `subagent:${name}.duration_ms` as MetricName;
      await writeMetricMax(db as never, 'run', run.id, metricName, agg.durationMs, 'at_finalization');
      written++;
    }
    if (agg.count > 0) {
      const metricName = `subagent:${name}.count` as MetricName;
      await writeMetricMax(db as never, 'run', run.id, metricName, agg.count, 'at_finalization');
      written++;
    }
  }
  return { written, skipped: 0 };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const runIdArg = args.find((a) => a.startsWith('--run-id='))?.slice('--run-id='.length);

  console.log(apply ? '🟢 APPLY mode: will write metric rows.' : '🔵 DRY RUN: no writes (pass --apply to actually write).');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!) as any;

  let runs: Array<{ id: string; strategy_id: string | null; experiment_id: string | null }> = [];
  if (runIdArg) {
    const { data, error } = await db
      .from('evolution_runs')
      .select('id, strategy_id, experiment_id')
      .eq('id', runIdArg);
    if (error || !data || data.length === 0) {
      console.error('Run not found:', runIdArg);
      process.exit(1);
    }
    runs = data as typeof runs;
  } else {
    const { data, error } = await db
      .from('evolution_runs')
      .select('id, strategy_id, experiment_id')
      .eq('status', 'completed')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Error fetching runs:', error.message);
      process.exit(1);
    }
    runs = (data ?? []) as typeof runs;
  }

  console.log(`Processing ${runs.length} run(s).`);
  let totalWritten = 0;
  let totalSkipped = 0;
  for (const run of runs) {
    const { written, skipped } = await backfillRun(db, run, apply);
    totalWritten += written;
    totalSkipped += skipped;
  }
  console.log(`Done. ${apply ? 'Wrote' : 'Would-write'} ${totalWritten} metric rows. Skipped ${totalSkipped} runs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
