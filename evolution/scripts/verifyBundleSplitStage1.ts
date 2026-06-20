#!/usr/bin/env npx tsx
// Phase 6 Stage 1 verifier for meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616.
// Runs the 6 SQL-verifiable acceptance checks against the bundle-split experiment.
// Exits 0 if all pass; non-zero on any failure with a diagnostic per check.
//
// Usage:
//   npx tsx evolution/scripts/verifyBundleSplitStage1.ts \
//     --experiment-id <expId> \
//     --control-strategy <ctlId> \
//     --treatment-strategy <trtId> \
//     --target staging
//
// The 6 checks (full prose in the planning doc Stage 1 section):
//   1. no_failures              — no failed runs in the experiment
//   2. cost_under_ceiling       — total cost (via get_run_total_cost RPC) < $0.50
//   3. treatment_bypass_active  — at least one treatment cycle has ≥15 raw groups
//   4. control_cap_fired        — every control cycle has ≤10 groups (K=10 cap)
//   5. treatment_mostly_singletons — mean atomics/group <1.5 AND total groups >10
//   6. arena_sync_both_arms     — at least 1 synced variant per arm

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseStringArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

export function validateUuidArgs(argsIn: { flag: string; value: string | undefined }[]): void {
  for (const { flag, value } of argsIn) {
    if (!value || !UUID_RE.test(value)) {
      throw new Error(`Invalid UUID for --${flag}: ${value}`);
    }
  }
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface SqlCheck {
  name: string;
  // Returns true if the check passes; populates `detail` either way.
  run: (db: SupabaseClient, ctx: { expId: string; ctlId: string; trtId: string }) => Promise<{ passed: boolean; detail: string }>;
}

// ─── The 6 SQL checks ───────────────────────────────────────────

export const STAGE_1_CHECKS: SqlCheck[] = [
  {
    name: 'no_failures',
    async run(db, { expId }) {
      const { count, error } = await db
        .from('evolution_runs')
        .select('*', { count: 'exact', head: true })
        .eq('experiment_id', expId)
        .eq('status', 'failed');
      if (error) return { passed: false, detail: `SQL error: ${error.message}` };
      return { passed: (count ?? 0) === 0, detail: `failed_runs=${count ?? 0}` };
    },
  },
  {
    name: 'cost_under_ceiling',
    async run(db, { expId }) {
      // get_run_total_cost(uuid) RPC sums evolution_agent_invocations.cost_usd
      // (migration 20260322000007). Sum across all experiment runs via .rpc per run.
      const { data: runs, error } = await db
        .from('evolution_runs')
        .select('id')
        .eq('experiment_id', expId);
      if (error) return { passed: false, detail: `SQL error: ${error.message}` };
      let total = 0;
      for (const r of runs ?? []) {
        const { data: cost, error: rpcErr } = await db.rpc('get_run_total_cost', { p_run_id: r.id });
        if (rpcErr) return { passed: false, detail: `RPC error: ${rpcErr.message}` };
        total += Number(cost ?? 0);
      }
      return { passed: total < 0.50, detail: `total_cost_usd=${total.toFixed(4)}` };
    },
  },
  {
    name: 'treatment_bypass_active',
    async run(db, { expId, trtId }) {
      const { data, error } = await db.rpc('phase6_stage1_check_3a', {
        p_experiment_id: expId,
        p_treatment_strategy_id: trtId,
      });
      if (error) {
        // RPC not present; fall back to client-side aggregation.
        const { data: invs, error: e2 } = await db
          .from('evolution_agent_invocations')
          .select('execution_detail, evolution_runs!inner(experiment_id, strategy_id)')
          .eq('evolution_runs.experiment_id', expId)
          .eq('evolution_runs.strategy_id', trtId);
        if (e2) return { passed: false, detail: `SQL error: ${e2.message}` };
        let maxRawGroups = 0;
        for (const inv of (invs ?? []) as unknown as { execution_detail?: { cycles?: { proposedGroupsRaw?: unknown[] }[] } }[]) {
          for (const c of inv.execution_detail?.cycles ?? []) {
            maxRawGroups = Math.max(maxRawGroups, c.proposedGroupsRaw?.length ?? 0);
          }
        }
        return { passed: maxRawGroups >= 15, detail: `max_raw_groups=${maxRawGroups}` };
      }
      const max = Number(data ?? 0);
      return { passed: max >= 15, detail: `max_raw_groups=${max}` };
    },
  },
  {
    name: 'control_cap_fired',
    async run(db, { expId, ctlId }) {
      const { data: invs, error } = await db
        .from('evolution_agent_invocations')
        .select('execution_detail, evolution_runs!inner(experiment_id, strategy_id)')
        .eq('evolution_runs.experiment_id', expId)
        .eq('evolution_runs.strategy_id', ctlId);
      if (error) return { passed: false, detail: `SQL error: ${error.message}` };
      let maxGroups = 0;
      for (const inv of (invs ?? []) as unknown as { execution_detail?: { cycles?: { proposedGroupsRaw?: unknown[] }[] } }[]) {
        for (const c of inv.execution_detail?.cycles ?? []) {
          maxGroups = Math.max(maxGroups, c.proposedGroupsRaw?.length ?? 0);
        }
      }
      return { passed: maxGroups <= 10, detail: `max_control_groups=${maxGroups}` };
    },
  },
  {
    name: 'treatment_mostly_singletons',
    async run(db, { expId, trtId }) {
      const { data: invs, error } = await db
        .from('evolution_agent_invocations')
        .select('execution_detail, evolution_runs!inner(experiment_id, strategy_id)')
        .eq('evolution_runs.experiment_id', expId)
        .eq('evolution_runs.strategy_id', trtId);
      if (error) return { passed: false, detail: `SQL error: ${error.message}` };
      let totalGroups = 0;
      let totalAtomics = 0;
      for (const inv of (invs ?? []) as unknown as { execution_detail?: { cycles?: { proposedGroupsRaw?: { atomicEdits?: unknown[] }[] }[] } }[]) {
        for (const c of inv.execution_detail?.cycles ?? []) {
          for (const g of c.proposedGroupsRaw ?? []) {
            totalGroups += 1;
            totalAtomics += g.atomicEdits?.length ?? 0;
          }
        }
      }
      const meanAtomics = totalGroups === 0 ? 1 : totalAtomics / totalGroups;
      return {
        passed: meanAtomics < 1.5 && totalGroups > 10,
        detail: `total_groups=${totalGroups} mean_atomics_per_group=${meanAtomics.toFixed(2)}`,
      };
    },
  },
  {
    name: 'arena_sync_both_arms',
    async run(db, { expId, ctlId, trtId }) {
      const armSynced = async (sid: string): Promise<number> => {
        const { count } = await db
          .from('evolution_variants')
          .select('id, evolution_runs!inner(experiment_id, strategy_id)', { count: 'exact', head: true })
          .eq('evolution_runs.experiment_id', expId)
          .eq('evolution_runs.strategy_id', sid)
          .eq('synced_to_arena', true);
        return count ?? 0;
      };
      const ctlSynced = await armSynced(ctlId);
      const trtSynced = await armSynced(trtId);
      return {
        passed: ctlSynced >= 1 && trtSynced >= 1,
        detail: `control_synced=${ctlSynced} treatment_synced=${trtSynced}`,
      };
    },
  },
];

// ─── DB ─────────────────────────────────────────────────────────

function buildDb(target: 'staging' | 'prod'): SupabaseClient {
  const envFile = target === 'staging' ? '.env.local' : '.env.evolution-prod';
  const envPath = path.resolve(process.cwd(), envFile);
  const result = dotenv.config({ path: envPath, override: true });
  if (result.error) {
    throw new Error(`[FATAL] Failed to load env from ${envPath}: ${result.error.message}`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('[FATAL] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key);
}

// ─── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const expId = parseStringArg('--experiment-id');
  const ctlId = parseStringArg('--control-strategy');
  const trtId = parseStringArg('--treatment-strategy');
  const target = (parseStringArg('--target') ?? 'staging') as 'staging' | 'prod';

  validateUuidArgs([
    { flag: 'experiment-id', value: expId },
    { flag: 'control-strategy', value: ctlId },
    { flag: 'treatment-strategy', value: trtId },
  ]);

  const db = buildDb(target);
  const ctx = { expId: expId!, ctlId: ctlId!, trtId: trtId! };

  const results: CheckResult[] = [];
  for (const check of STAGE_1_CHECKS) {
    const { passed, detail } = await check.run(db, ctx);
    results.push({ name: check.name, passed, detail });
    const tag = passed ? '✓' : '✗';
    console.log(`[verify] ${tag} ${check.name}: ${detail}`);
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.error(`\n[verify] FAILED: ${failed.length}/6 checks. Stage 2 is blocked.`);
    process.exit(1);
  }
  console.log('\n[verify] All 6 SQL checks passed. Now run the 2 manual UI checks (#4, #5).');
}

const isDirectExecution = require.main === module
  || process.argv[1]?.endsWith('verifyBundleSplitStage1.ts');
if (isDirectExecution) {
  main().catch((err) => {
    console.error('[FATAL]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
