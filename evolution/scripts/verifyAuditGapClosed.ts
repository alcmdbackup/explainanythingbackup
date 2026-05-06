/**
 * One-shot verification script: confirm the llmCallTracking audit gap is closed
 * after the fix from feat/debug_evolution_run_cost_20260426 is deployed.
 *
 * Read-only — runs only SELECT queries, no DB writes.
 *
 * Usage:
 *   npx tsx evolution/scripts/verifyAuditGapClosed.ts --since=2026-04-30T20:00:00Z
 *   npx tsx evolution/scripts/verifyAuditGapClosed.ts                    # defaults to now - 24h
 *
 * Exit codes:
 *   0 = all checks PASS
 *   1 = one or more checks FAIL (the fix is not working as expected)
 *   2 = WARN (no post-deploy data yet — wait for a run to occur and re-run)
 *   3 = script error (couldn't reach DB, missing env, etc.)
 *
 * SCOPE BOUNDARY (Phase 5d, debug_evolution_run_cost_20260426):
 *   This script verifies PRODUCTION DATA SHAPE — does the table contain rows post-deploy,
 *   are FK columns populated, do per-run linkages exist? It does NOT exercise the agent →
 *   client → bridge → callLLM call chain that produces those rows.
 *
 *   Chain integrity is verified by the unit test at:
 *     evolution/src/lib/core/Agent.test.ts → describe('run() - threads invocationId into ctx')
 *       → it('binds invocationId on the scoped EvolutionLLMClient — rawProvider receives
 *           it as options.invocationId on every complete() call')
 *
 *   That test runs in CI on every PR. If THAT test is missing or skipped, this script's
 *   PASS verdict could be falsely-green: the rows might land for an unrelated reason
 *   while the chain-of-call has regressed. The audit gap original miss was exactly this
 *   "tested the leaves, not the chain" failure mode (see research doc § 9).
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const sinceArg = args.find((a) => a.startsWith('--since='))?.split('=')[1];

const DEPLOY_TS_ISO = sinceArg ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
// Last evolution_* row pre-gap was 2026-02-22T17:20:50Z; first day fully in the gap is 2026-02-23.
const AUDIT_GAP_START_ISO = '2026-02-23T00:00:00Z';

type Verdict = 'PASS' | 'FAIL' | 'WARN';

interface CheckResult {
  name: string;
  verdict: Verdict;
  detail: string;
  data?: unknown;
}

function loadStagingCreds(): { url: string; key: string } {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error(`.env.local not found at ${envPath} — needed for staging credentials`);
  }
  const env = dotenv.parse(fs.readFileSync(envPath));
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error('.env.local missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return { url, key };
}

function fmtVerdict(v: Verdict): string {
  if (v === 'PASS') return '[32m✓ PASS[0m';
  if (v === 'FAIL') return '[31m✗ FAIL[0m';
  return '[33m⚠ WARN[0m';
}

async function main() {
  console.log(`\n=== llmCallTracking audit-gap verification ===`);
  console.log(`Deploy timestamp (--since): ${DEPLOY_TS_ISO}`);
  console.log(`Audit-gap start:            ${AUDIT_GAP_START_ISO}\n`);

  const { url, key } = loadStagingCreds();
  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const probe = await db.from('evolution_runs').select('id').limit(1);
  if (probe.error) {
    console.error(`[FATAL] Staging unreachable: ${probe.error.message}`);
    process.exit(3);
  }

  const results: CheckResult[] = [];

  // ── Negative control: confirm the historical gap is real ─────────────────
  {
    const { count, error } = await db
      .from('llmCallTracking')
      .select('*', { count: 'exact', head: true })
      .like('call_source', 'evolution_%')
      .gte('created_at', AUDIT_GAP_START_ISO)
      .lt('created_at', DEPLOY_TS_ISO);
    if (error) {
      results.push({ name: 'Negative control: historic gap', verdict: 'FAIL', detail: error.message });
    } else {
      const n = count ?? 0;
      results.push({
        name: 'Negative control: historic gap',
        verdict: n === 0 ? 'PASS' : 'WARN',
        detail: n === 0
          ? `0 evolution_* rows between ${AUDIT_GAP_START_ISO} and deploy — confirms the audit gap was real.`
          : `${n} rows in the supposed gap window — gap may have partially closed earlier than expected, OR your --since timestamp predates the fix deploy.`,
        data: { rows_in_gap: n },
      });
    }
  }

  // ── Check A: post-deploy rows exist at all ───────────────────────────────
  {
    const { count, error } = await db
      .from('llmCallTracking')
      .select('*', { count: 'exact', head: true })
      .like('call_source', 'evolution_%')
      .gte('created_at', DEPLOY_TS_ISO);
    if (error) {
      results.push({ name: 'Check A: post-deploy rows exist', verdict: 'FAIL', detail: error.message });
    } else {
      const n = count ?? 0;
      results.push({
        name: 'Check A: post-deploy rows exist',
        verdict: n > 0 ? 'PASS' : 'WARN',
        detail: n > 0
          ? `${n} evolution_* rows written since deploy — fix is producing data.`
          : `Zero evolution_* rows since ${DEPLOY_TS_ISO}. Either no runs have occurred yet (re-run after a run completes), or the fix isn't deployed yet.`,
        data: { post_deploy_rows: n },
      });
    }
  }

  // ── Check B: evolution_invocation_id is populated ────────────────────────
  {
    const totalRes = await db
      .from('llmCallTracking')
      .select('*', { count: 'exact', head: true })
      .like('call_source', 'evolution_%')
      .gte('created_at', DEPLOY_TS_ISO);
    const nullRes = await db
      .from('llmCallTracking')
      .select('*', { count: 'exact', head: true })
      .like('call_source', 'evolution_%')
      .gte('created_at', DEPLOY_TS_ISO)
      .is('evolution_invocation_id', null);

    if (totalRes.error || nullRes.error) {
      results.push({
        name: 'Check B: invocation_id linkage',
        verdict: 'FAIL',
        detail: totalRes.error?.message ?? nullRes.error?.message ?? 'unknown error',
      });
    } else {
      const total = totalRes.count ?? 0;
      const nulls = nullRes.count ?? 0;
      const populated = total - nulls;
      const nullRate = total > 0 ? nulls / total : 0;

      let verdict: Verdict;
      let detail: string;
      if (total === 0) {
        verdict = 'WARN';
        detail = 'No post-deploy rows to evaluate — Check A also surfaced this.';
      } else if (nullRate === 0) {
        verdict = 'PASS';
        detail = `${populated}/${total} rows have evolution_invocation_id populated (0% NULL).`;
      } else if (nullRate < 0.1) {
        verdict = 'PASS';
        detail = `${populated}/${total} rows linked, ${nulls} NULLs (${(nullRate * 100).toFixed(1)}% — within 10% threshold, possibly in-flight or non-evolution-pipeline calls).`;
      } else {
        verdict = 'FAIL';
        detail = `${nulls}/${total} rows have NULL evolution_invocation_id (${(nullRate * 100).toFixed(1)}%) — the secondary FK linkage isn't working. Check Agent.run() / createEvolutionLLMClient.ts threading.`;
      }

      results.push({
        name: 'Check B: invocation_id linkage',
        verdict,
        detail,
        data: { total, populated, nulls, null_rate_pct: Number((nullRate * 100).toFixed(2)) },
      });
    }
  }

  // ── Check C: per-run linkage spot check ──────────────────────────────────
  {
    const { data: recentRuns, error } = await db
      .from('evolution_runs')
      .select('id, created_at')
      .eq('status', 'completed')
      .gte('created_at', DEPLOY_TS_ISO)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      results.push({ name: 'Check C: per-run spot check', verdict: 'FAIL', detail: error.message });
    } else if (!recentRuns || recentRuns.length === 0) {
      results.push({
        name: 'Check C: per-run spot check',
        verdict: 'WARN',
        detail: 'No completed runs since deploy timestamp — kick off a small experiment and re-run.',
      });
    } else {
      const runDetails: Array<{ run_id: string; invocations: number; tracking_rows: number; ratio: number }> = [];
      let allLinked = true;

      for (const run of recentRuns) {
        const invRes = await db
          .from('evolution_agent_invocations')
          .select('id')
          .eq('run_id', run.id);
        const invIds = (invRes.data ?? []).map((i) => i.id as string);

        let tracking = 0;
        if (invIds.length > 0) {
          // Chunk to stay under PostgREST URL limits.
          for (let i = 0; i < invIds.length; i += 100) {
            const chunk = invIds.slice(i, i + 100);
            const { count } = await db
              .from('llmCallTracking')
              .select('*', { count: 'exact', head: true })
              .in('evolution_invocation_id', chunk);
            tracking += count ?? 0;
          }
        }

        const ratio = invIds.length > 0 ? tracking / invIds.length : 0;
        runDetails.push({
          run_id: run.id,
          invocations: invIds.length,
          tracking_rows: tracking,
          ratio: Number(ratio.toFixed(2)),
        });
        if (invIds.length > 0 && tracking === 0) allLinked = false;
      }

      const verdict: Verdict = allLinked ? 'PASS' : 'FAIL';
      const detail = allLinked
        ? `All ${recentRuns.length} recent runs have llmCallTracking rows linked (mean ratio ${(
            runDetails.reduce((s, r) => s + r.ratio, 0) / runDetails.length
          ).toFixed(2)} rows/invocation).`
        : `Some runs have invocations but ZERO linked tracking rows — fix isn't working end-to-end.`;

      results.push({
        name: 'Check C: per-run spot check',
        verdict,
        detail,
        data: { runs: runDetails },
      });
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────
  console.log('Results');
  console.log('───────────────────────────────────────────────────────────');
  for (const r of results) {
    console.log(`${fmtVerdict(r.verdict)}  ${r.name}`);
    console.log(`        ${r.detail}`);
    if (r.data) console.log(`        data: ${JSON.stringify(r.data)}`);
    console.log('');
  }

  const failed = results.filter((r) => r.verdict === 'FAIL').length;
  const warned = results.filter((r) => r.verdict === 'WARN').length;

  console.log('───────────────────────────────────────────────────────────');
  if (failed > 0) {
    console.log(`Verdict: ${fmtVerdict('FAIL')} — ${failed} check(s) failed`);
    console.log('The fix is NOT working as expected. Investigate the failed checks above.');
    process.exit(1);
  }
  if (warned > 0) {
    console.log(`Verdict: ${fmtVerdict('WARN')} — ${warned} check(s) inconclusive`);
    console.log('Most likely cause: no evolution runs have completed since the deploy timestamp.');
    console.log('Trigger a small experiment via /admin/evolution/start-experiment, then re-run this script.');
    process.exit(2);
  }
  console.log(`Verdict: ${fmtVerdict('PASS')} — fix is working in staging.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(3);
});
