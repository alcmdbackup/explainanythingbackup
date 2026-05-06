/**
 * One-shot verification script for the llmCallTracking audit-gap fix.
 *
 * Reproduces the CLI-runner code path (no Next.js context), invokes the modified
 * saveLlmCallTracking with an injected staging Supabase client, queries for the
 * inserted row, and cleans up. Exits non-zero on any failure.
 *
 * Usage:
 *   npx tsx evolution/scripts/verifyLlmCallTrackingFix.ts            # dry-run (default — no writes)
 *   npx tsx evolution/scripts/verifyLlmCallTrackingFix.ts --apply    # actually write + verify + delete
 *
 * The test row uses call_source='[TEST] tracking-fix-verify-<timestamp>' so it's
 * trivially identifiable and gets deleted at the end of the script. If the script
 * crashes mid-run, the row can be cleaned up manually:
 *   DELETE FROM "llmCallTracking" WHERE call_source LIKE '[TEST] tracking-fix-verify-%';
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { saveLlmCallTracking } from '../../src/lib/services/llms';

const APPLY = process.argv.includes('--apply');
const TEST_USERID = '00000000-0000-4000-8000-000000000001';
const TEST_INVOCATION_ID = '00000000-0000-4000-8000-000000000999';
const TEST_CALL_SOURCE = `[TEST] tracking-fix-verify-${Date.now()}`;

function log(level: 'info' | 'warn' | 'error', message: string, ctx: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  const extra = Object.keys(ctx).length > 0 ? ` ${JSON.stringify(ctx)}` : '';
  console.log(`[${ts}] [${level.toUpperCase()}] ${message}${extra}`);
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

async function main() {
  log('info', 'Verification script starting', { apply: APPLY });

  // 1. Load staging credentials WITHOUT polluting process.env.SUPABASE_SERVICE_ROLE_KEY.
  // This proves the fix works even when the createSupabaseServiceClient fallback
  // would succeed — i.e., it's the injected path being exercised, not coincidence.
  const { url, key } = loadStagingCreds();
  log('info', 'Loaded staging credentials');

  // 2. Build a Next-free client (mirrors processRunQueue.ts:69).
  const stagingClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  log('info', 'Created Next-free Supabase client (mirrors batch runner)');

  // 3. Connectivity smoke test.
  const probe = await stagingClient.from('evolution_runs').select('id').limit(1);
  if (probe.error) {
    throw new Error(`Staging unreachable: ${probe.error.message}`);
  }
  log('info', 'Staging reachable');

  // 4. Build the test row.
  const testRow = {
    userid: TEST_USERID,
    prompt: '[VERIFY] tracking-fix prompt',
    content: '[VERIFY] tracking-fix response',
    call_source: TEST_CALL_SOURCE,
    raw_api_response: JSON.stringify({ verify: true }),
    model: 'gpt-4.1-mini',
    prompt_tokens: 1,
    completion_tokens: 1,
    total_tokens: 2,
    finish_reason: 'stop',
    estimated_cost_usd: 0.000001,
    evolution_invocation_id: TEST_INVOCATION_ID,
  };

  if (!APPLY) {
    log('info', 'Dry-run: would insert test row, query, and delete', {
      call_source: TEST_CALL_SOURCE,
      preview: testRow,
    });
    log('info', 'Re-run with --apply to actually write to staging');
    return;
  }

  // 5. PRE-FIX BEHAVIOR CHECK — show the audit gap is real.
  // Without injecting the client, the call goes through createSupabaseServiceClient,
  // which is broken in CLI context. We delete SUPABASE_SERVICE_ROLE_KEY from process.env
  // so the failure surfaces cleanly (not a coincidence of fallback success).
  // EVOLUTION_TRACKING_STRICT=true makes the failure throw so we can assert on it.
  log('info', '--- Step 1: confirm pre-fix path fails noisily without injection ---');
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.EVOLUTION_TRACKING_STRICT = 'true';

  let preFixThrew = false;
  try {
    await saveLlmCallTracking(testRow);
  } catch (err) {
    preFixThrew = true;
    log('info', '[PASS] strict-mode pre-fix call threw as expected', {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
  if (!preFixThrew) {
    throw new Error('[FAIL] strict-mode pre-fix call did NOT throw — noisy-failure regression');
  }

  // Restore env for the post-fix path.
  if (savedKey) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  delete process.env.EVOLUTION_TRACKING_STRICT;

  // 6. POST-FIX PATH — inject the staging client, expect success.
  log('info', '--- Step 2: confirm post-fix path succeeds with injected client ---');
  await saveLlmCallTracking(testRow, stagingClient);
  log('info', '[PASS] saveLlmCallTracking with injected client returned cleanly');

  // 7. Query staging to confirm the row exists.
  log('info', '--- Step 3: query staging to verify row landed in DB ---');
  const verify = await stagingClient
    .from('llmCallTracking')
    .select('id, call_source, model, evolution_invocation_id, prompt_tokens, completion_tokens, estimated_cost_usd')
    .eq('call_source', TEST_CALL_SOURCE);

  if (verify.error) {
    throw new Error(`[FAIL] verify query errored: ${verify.error.message}`);
  }
  if (!verify.data || verify.data.length === 0) {
    throw new Error('[FAIL] no row found for test call_source — write silently dropped');
  }
  if (verify.data.length > 1) {
    throw new Error(`[FAIL] expected 1 row, got ${verify.data.length}`);
  }

  const row = verify.data[0];
  if (!row) throw new Error('[FAIL] verify.data[0] unexpectedly undefined');
  log('info', '[PASS] row landed in staging.llmCallTracking', { row });

  // Field-level assertions.
  if (row.call_source !== TEST_CALL_SOURCE) throw new Error(`[FAIL] call_source mismatch: ${row.call_source}`);
  if (row.model !== 'gpt-4.1-mini') throw new Error(`[FAIL] model mismatch: ${row.model}`);
  if (row.evolution_invocation_id !== TEST_INVOCATION_ID) {
    throw new Error(`[FAIL] evolution_invocation_id not threaded: got ${row.evolution_invocation_id}`);
  }
  log('info', '[PASS] all field assertions passed (incl. evolution_invocation_id linkage)');

  // 8. Cleanup.
  log('info', '--- Step 4: clean up test row ---');
  const del = await stagingClient
    .from('llmCallTracking')
    .delete()
    .eq('call_source', TEST_CALL_SOURCE);
  if (del.error) {
    log('warn', '[WARN] cleanup delete errored — manual cleanup may be needed', {
      call_source: TEST_CALL_SOURCE,
      error: del.error.message,
    });
  } else {
    log('info', '[PASS] test row cleaned up');
  }

  log('info', '✅ ALL CHECKS PASSED — fix verified end-to-end against staging');
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
