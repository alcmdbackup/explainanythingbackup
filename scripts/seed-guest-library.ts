/**
 * Seed the demo guest user's library with 10 GPU/semiconductor explanations.
 *
 * Phase 6 of fixes_explainanything_for_public_demo_20260523.
 *
 * Calls the deployed app's /api/returnExplanation endpoint as the guest user,
 * then saves each result to userLibrary via direct DB write. Operationally
 * cleaner than the alternative of running the generation pipeline from
 * outside an HTTP request context (which would require significant refactoring
 * of returnExplanationLogic since it depends on the cookie-based supabase client).
 *
 * Usage:
 *   npx tsx scripts/seed-guest-library.ts --base-url=https://explainanything.vercel.app
 *
 * Flags:
 *   --dry-run        Print queries + acceptance criteria, no calls.
 *   --force          Skip idempotency check (re-seed even if library has >= 5 entries).
 *   --base-url=URL   Required when not running against localhost. e.g.
 *                    --base-url=https://explainanything.vercel.app
 *
 * Environment required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GUEST_EMAIL, GUEST_PASSWORD, GUEST_USER_ID
 *
 * Acceptance criteria per generation (objective):
 *   - completes without ServiceError
 *   - body content >= 500 chars
 *   - at least 1 H2/H3 heading OR at least 1 inline link
 *
 * Cost: ~$1-3 in OpenAI usage for the 10 generations.
 *
 * Tip: set SEED_BYPASS_USER_CAP=true so the script bypasses the per-user
 * $10/day cap (avoids burning the day's budget pre-demo).
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import type { Database } from '../src/lib/database.types';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const BASE_URL = args.find((a) => a.startsWith('--base-url='))?.split('=')[1] ?? 'http://localhost:3000';

// Curated query set per the plan — spread across fundamentals, software,
// manufacturing, economics, and specialized topics.
const SEED_QUERIES = [
  'How does a transistor work?',
  "What's the difference between a CPU and a GPU?",
  'How does CUDA enable parallel computing?',
  'What is EUV lithography and why does it matter?',
  'Why are chip fabs so expensive to build?',
  "What is Moore's Law and is it still true?",
  'How does High Bandwidth Memory (HBM) work?',
  'How do tensor cores accelerate AI workloads?',
  'What is chiplet architecture and why is everyone moving to it?',
  'Why has Nvidia become dominant in AI hardware?',
];

const MIN_BODY_CHARS = 500;
const HEADING_RE = /^#{2,3}\s/m;
const INLINE_LINK_RE = /\[[^\]]+\]\([^)]+\)/;

function validateEnv(): void {
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GUEST_EMAIL', 'GUEST_PASSWORD', 'GUEST_USER_ID'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`✗ Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function acceptanceCheck(content: string | null | undefined): { ok: boolean; reason: string } {
  if (!content) return { ok: false, reason: 'no content' };
  if (content.length < MIN_BODY_CHARS) return { ok: false, reason: `content too short (${content.length} < ${MIN_BODY_CHARS})` };
  if (!HEADING_RE.test(content) && !INLINE_LINK_RE.test(content)) {
    return { ok: false, reason: 'no H2/H3 heading and no inline link' };
  }
  return { ok: true, reason: 'pass' };
}

async function main() {
  console.log('=== Seed Guest Library ===');
  console.log(`Base URL:  ${BASE_URL}`);
  console.log(`Dry run:   ${DRY_RUN}`);
  console.log(`Force:     ${FORCE}`);
  console.log('');

  if (DRY_RUN) {
    console.log('Would generate the following:');
    SEED_QUERIES.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
    console.log('');
    console.log(`Acceptance criteria per entry: completes, body >= ${MIN_BODY_CHARS} chars, >=1 H2/H3 OR >=1 inline link`);
    console.log('');
    console.log('Estimated cost: $1-3 (OpenAI).');
    return;
  }

  validateEnv();

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const GUEST_USER_ID = process.env.GUEST_USER_ID!;

  // Idempotency check.
  if (!FORCE) {
    const { count, error } = await supabase
      .from('userLibrary')
      .select('*', { count: 'exact', head: true })
      .eq('userid', GUEST_USER_ID);
    if (error) {
      console.error(`✗ userLibrary count failed: ${error.message}`);
      process.exit(1);
    }
    if ((count ?? 0) >= 5) {
      console.log(`✓ Guest library already has ${count} entries — skipping seed (use --force to override).`);
      return;
    }
    console.log(`Guest library currently has ${count ?? 0} entries; proceeding with seed.`);
  }

  // Sign in as guest to get an auth cookie for the /api call.
  console.log('Signing in as guest...');
  const { data: authData, error: signInErr } = await supabase.auth.signInWithPassword({
    email: process.env.GUEST_EMAIL!,
    password: process.env.GUEST_PASSWORD!,
  });
  if (signInErr || !authData.session) {
    console.error(`✗ Guest sign-in failed: ${signInErr?.message ?? 'no session'}`);
    process.exit(1);
  }
  const accessToken = authData.session.access_token;

  const results: Array<{ query: string; explanationId: number | null; ok: boolean; reason: string }> = [];

  for (const [i, query] of SEED_QUERIES.entries()) {
    console.log(`\n[${i + 1}/${SEED_QUERIES.length}] ${query}`);
    try {
      const resp = await fetch(`${BASE_URL}/api/returnExplanation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `sb-access-token=${accessToken}`,
        },
        body: JSON.stringify({
          userInput: query,
          matchMode: 'skipMatch',
          userInputType: 'query',
          __requestId: `seed-guest-library-${Date.now()}-${i}`,
        }),
      });

      if (!resp.ok) {
        console.error(`  ✗ HTTP ${resp.status}`);
        results.push({ query, explanationId: null, ok: false, reason: `HTTP ${resp.status}` });
        continue;
      }

      // The endpoint returns SSE; parse the final `complete` event payload.
      const text = await resp.text();
      const completeMatch = text.match(/event: complete[\s\S]*?data: (.+?)\n/);
      if (!completeMatch) {
        console.error('  ✗ No complete event in SSE stream');
        results.push({ query, explanationId: null, ok: false, reason: 'no complete event' });
        continue;
      }
      const completeData = JSON.parse(completeMatch[1]!);
      const explanationId: number | null = completeData.result?.explanationId ?? completeData.explanationId ?? null;
      const content: string | null = completeData.result?.data?.content ?? completeData.result?.content ?? null;

      const check = acceptanceCheck(content);
      if (!check.ok) {
        console.warn(`  ⚠ Accept fail: ${check.reason}`);
        results.push({ query, explanationId, ok: false, reason: check.reason });
        continue;
      }

      if (!explanationId) {
        console.error('  ✗ No explanationId in response');
        results.push({ query, explanationId: null, ok: false, reason: 'no id' });
        continue;
      }

      // Save to guest's library.
      const { error: saveErr } = await supabase
        .from('userLibrary')
        .insert({ explanationid: explanationId, userid: GUEST_USER_ID });

      if (saveErr && !saveErr.message.includes('duplicate')) {
        console.error(`  ✗ Save to library failed: ${saveErr.message}`);
        results.push({ query, explanationId, ok: false, reason: `library save: ${saveErr.message}` });
        continue;
      }

      console.log(`  ✓ Generated + saved (explanationId=${explanationId}, ${content!.length} chars)`);
      results.push({ query, explanationId, ok: true, reason: 'pass' });
    } catch (err) {
      console.error(`  ✗ Threw: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ query, explanationId: null, ok: false, reason: String(err) });
    }
  }

  console.log('\n=== Summary ===');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`Passed: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log('Failures:');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.query}: ${r.reason}`));
  }

  if (passed < SEED_QUERIES.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✗ seed-guest-library failed:', err);
  process.exit(1);
});
