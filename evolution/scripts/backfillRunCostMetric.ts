#!/usr/bin/env npx tsx
// Backfill missing evolution_metrics rows where metric_name='cost' for completed
// runs. Some legacy completed runs only have per-phase cost metric rows
// (generation_cost / ranking_cost / seed_cost) and never got a rollup `cost`
// row. The dashboard + runs list helper getRunCostsWithFallback handles this
// at read time, but operators may want to materialize the rollup so the
// `cost` metric is queryable directly (charts, ad-hoc SQL).
//
// Usage:
//   npx tsx evolution/scripts/backfillRunCostMetric.ts                  # dry-run, all completed runs
//   npx tsx evolution/scripts/backfillRunCostMetric.ts --apply          # actually write
//   npx tsx evolution/scripts/backfillRunCostMetric.ts --run-id UUID    # single-run mode
//
// Guards:
//   - Default mode is --dry-run (prints planned writes, doesn't touch DB).
//   - Targets only `evolution_runs.status='completed'` runs missing a `cost` metric row.
//   - Uses writeMetricMax (Postgres GREATEST upsert) so concurrent live writes
//     are never overwritten with smaller values.
//   - Writes a per-run audit-trail report to evolution/scripts/backfill-reports/
//     BEFORE the corresponding writeMetricMax call. If the script crashes
//     mid-run, the report is a superset of writes that landed and the operator
//     can rollback safely.
//
// Rollback:
//   REPORT=evolution/scripts/backfill-reports/cost-backfill-<UTC>.json
//   IDS=$(jq -r '.runIds | map("'"'"'" + . + "'"'"'") | join(",")' "$REPORT")
//   npm run query:prod -- "DELETE FROM evolution_metrics WHERE metric_name='cost' AND entity_id IN ($IDS) RETURNING entity_id;"
//
//   DO NOT use a broad WHERE clause (metric_name='cost' alone) — that would
//   delete legitimately pre-existing cost rows.
//
// Env: .env.local — NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as dns from 'dns';
import { findRunsMissingCostMetric, computeCostsForRuns } from './backfillRunCostMetricHelpers';

dns.setDefaultResultOrder('ipv4first');
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ─── Args ────────────────────────────────────────────────────────
const apply = process.argv.includes('--apply');
// B013-S4: support BOTH `--run-id=UUID` (equals form) AND `--run-id UUID` (space form,
// which the docstring shows). Previously only equals form was parsed → space-form
// silently fell through to "all completed runs" mode.
function parseRunIdArg(): string | undefined {
  const equalsForm = process.argv.find((a) => a.startsWith('--run-id='))?.split('=')[1];
  if (equalsForm) return equalsForm;
  const spaceIdx = process.argv.indexOf('--run-id');
  if (spaceIdx >= 0 && spaceIdx + 1 < process.argv.length) {
    return process.argv[spaceIdx + 1];
  }
  return undefined;
}
const runIdArg = parseRunIdArg();
const REPORT_DIR = path.resolve(process.cwd(), 'evolution/scripts/backfill-reports');
const REPORT_PATH = path.join(REPORT_DIR, `cost-backfill-${new Date().toISOString().replace(/:/g, '-')}.json`);

// ─── Main ────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const db = createClient(SUPABASE_URL!, SERVICE_KEY!);

  console.error(`[cost-backfill] mode=${apply ? 'APPLY' : 'DRY-RUN'}; targeting ${runIdArg ? `run=${runIdArg}` : 'all completed runs missing a cost metric'}`);

  // 1. Find completed runs that are MISSING a `cost` metric row.
  const targetRunIds = await findRunsMissingCostMetric(db, runIdArg);
  console.error(`[cost-backfill] candidates: ${targetRunIds.length}`);

  if (targetRunIds.length === 0) {
    console.error('[cost-backfill] no candidates; exiting');
    return;
  }

  // 2. For each candidate, compute the per-run cost from evolution_run_costs view.
  //    (Or fall back to summing gen+rank+seed metrics if the view returns null.)
  const costsToWrite = await computeCostsForRuns(db, targetRunIds);

  console.error(`[cost-backfill] computable: ${costsToWrite.length} of ${targetRunIds.length}`);

  // 3. Open the report file BEFORE any writes — the file is the audit trail
  //    rollback uses. Each successfully-attempted runId is appended to it.
  const written: string[] = [];
  if (apply) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify({ writtenAt: new Date().toISOString(), runIds: written }, null, 2));
    console.error(`[cost-backfill] report at ${REPORT_PATH}`);
  }

  let dryRunOnly = 0; let wrote = 0; let errored = 0;
  for (const { runId, cost } of costsToWrite) {
    if (!apply) {
      console.log(`[DRY-RUN] would write cost=${cost.toFixed(6)} for run=${runId}`);
      dryRunOnly += 1;
      continue;
    }
    try {
      // Append runId to the report BEFORE the metric write so a crash
      // mid-write still leaves a rollback-safe list.
      written.push(runId);
      fs.writeFileSync(REPORT_PATH, JSON.stringify({ writtenAt: new Date().toISOString(), runIds: written }, null, 2));

      // upsert_metric_max signature: (p_entity_type, p_entity_id, p_metric_name, p_value, p_source).
      const { error: rpcErr } = await db.rpc('upsert_metric_max', {
        p_entity_type: 'run',
        p_entity_id: runId,
        p_metric_name: 'cost',
        p_value: cost,
        p_source: 'backfill',
      });
      if (rpcErr) throw rpcErr;
      wrote += 1;
    } catch (e) {
      errored += 1;
      console.error(`[cost-backfill] error writing run=${runId}: ${(e as Error).message ?? e}`);
    }
  }

  if (apply) {
    console.error(`[cost-backfill] done (APPLY): wrote=${wrote} errored=${errored} of ${costsToWrite.length} computable`);
    console.error(`[cost-backfill] audit-trail JSON: ${REPORT_PATH}`);
  } else {
    console.error(`[cost-backfill] done (DRY-RUN): would-write=${dryRunOnly} of ${costsToWrite.length} computable. Re-run with --apply to write.`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[cost-backfill] fatal:', e);
  process.exit(1);
});
