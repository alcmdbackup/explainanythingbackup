// Backfills llmCallTracking.is_test for historical rows by replaying the SAME heuristic
// used at insert time (isTestLlmCall — DRY, one tested classifier). Flags integration-test /
// mock pollution so the spending dashboard separates real spend from test data.
//
// Usage:
//   npx tsx scripts/backfillLlmIsTest.ts             # dry-run (counts only, no writes)
//   npx tsx scripts/backfillLlmIsTest.ts --apply     # write is_test=true for matched rows
//
// Env: .env.local — NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// Note: only flips false→true. Deterministic insert-time signals (test userids / env) are the
// source of truth; the content fingerprint is best-effort (see isTestLlmCall).

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { isTestLlmCall } from '@/lib/services/llmCostAttribution';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const PAGE = 1000;

async function main(): Promise<void> {
  const db = createClient(SUPABASE_URL!, SERVICE_KEY!);
  let from = 0;
  let scanned = 0;
  let matched = 0;
  let updated = 0;

  for (;;) {
    // Only rows not already flagged — we only ever flip false→true.
    const { data, error } = await db
      .from('llmCallTracking')
      .select('id, userid, call_source, content')
      .eq('is_test', false)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('Query failed:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    scanned += data.length;
    const toFlip = data.filter((r) =>
      isTestLlmCall({ userid: r.userid, callSource: r.call_source, content: r.content }),
    );
    matched += toFlip.length;

    if (apply && toFlip.length > 0) {
      const ids = toFlip.map((r) => r.id);
      const { error: upErr } = await db
        .from('llmCallTracking')
        .update({ is_test: true })
        .in('id', ids);
      if (upErr) {
        console.error('Update failed:', upErr.message);
        process.exit(1);
      }
      updated += ids.length;
    }

    console.log(`scanned=${scanned} matched=${matched}${apply ? ` updated=${updated}` : ''}`);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(
    `\nDone. scanned=${scanned} matched=${matched} ${apply ? `updated=${updated}` : '(dry-run — re-run with --apply to write)'}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
