// Pre-flight budget check for the cheap real-AI smoke (reduce_e2e_openai_test_costs_20260607).
// Read-only: sums today's llmCallTracking spend and, if it already exceeds the daily cap, writes
// `skipped=true` to $GITHUB_OUTPUT so the workflow SKIPS the @prod-ai run (instead of letting an
// exhausted OpenAI/OpenRouter account surface as an opaque mid-run 429). Never throws on a query
// error — a check failure must not red the pipeline; it logs and reports skipped=false (fail-open).

import { createClient } from '@supabase/supabase-js';
import { appendFileSync } from 'fs';
import type { Database } from '../src/lib/database.types';

const DEFAULT_CAP_USD = 50;

function emit(skipped: boolean, reason: string): void {
  console.log(`[budget-check] skipped=${skipped} — ${reason}`);
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `skipped=${skipped}\n`);
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const capUsd = Number(process.env.LLM_DAILY_CAP_USD ?? DEFAULT_CAP_USD);

  if (!url || !key) {
    emit(false, 'Supabase creds missing — failing open (run proceeds)');
    return;
  }

  try {
    const supabase = createClient<Database>(url, key);
    const startOfDayUtc = new Date();
    startOfDayUtc.setUTCHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('llmCallTracking')
      .select('estimated_cost_usd')
      .gte('created_at', startOfDayUtc.toISOString());

    if (error) {
      emit(false, `query error (${error.message}) — failing open`);
      return;
    }

    const spent = (data ?? []).reduce((sum, row) => sum + (row.estimated_cost_usd ?? 0), 0);
    if (spent >= capUsd) {
      emit(true, `today's spend $${spent.toFixed(2)} >= cap $${capUsd.toFixed(2)} — skipping @prod-ai run`);
    } else {
      emit(false, `today's spend $${spent.toFixed(2)} < cap $${capUsd.toFixed(2)} — proceeding`);
    }
  } catch (e) {
    emit(false, `unexpected error (${e instanceof Error ? e.message : String(e)}) — failing open`);
  }
}

void main();
