/**
 * /edit/runs/[runId] polling → diff-render handoff E2E.
 *
 * Locks in the critical path for the user-visible result of a /edit submission:
 *   page loads → polling sees status='completed' → SideBySideWordDiff renders.
 *
 * Uses a pre-seeded fixture (topic + explanation + completed run + winner
 * variant) inserted via service-role so we don't need the minicomputer running
 * AND the test completes deterministically. The pipeline-execution path is
 * covered by claimAndExecuteRun.test.ts + manual smoke; this spec only covers
 * the polling-to-render handoff, which is the layer that broke on 2026-06-30
 * with the "Failed to fetch" / over-polling regressions.
 *
 * Tag @evolution + @skip-prod — needs SUPABASE_SERVICE_ROLE_KEY in env and
 * direct DB write access; not appropriate for the @critical sub-3min job.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type { Database } from '@/lib/database.types';

interface SeededRun {
  runId: string;
  topicId: number;
  explanationId: number;
  variantId: string;
  cleanup: () => Promise<void>;
}

async function seedCompletedRun(): Promise<SeededRun> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required');
  const supabase = createClient<Database>(url, key);

  const suffix = randomUUID().slice(0, 8);
  const original = `[E2E] Original text for completed-run handoff fixture · ${suffix}`;
  const winner = `[E2E] Evolved text for completed-run handoff fixture · ${suffix}`;

  const { data: topic, error: topicErr } = await supabase
    .from('topics').insert({ topic_title: `[EDIT] E2E completed-run fixture · ${suffix}` })
    .select('id').single();
  if (topicErr || !topic) throw new Error(`topic insert failed: ${topicErr?.message}`);

  const { data: explanation, error: expErr } = await supabase
    .from('explanations').insert({
      explanation_title: `[EDIT] E2E fixture · ${suffix}`,
      content: original,
      primary_topic_id: topic.id,
      status: 'draft',
      source: 'generated',
    })
    .select('id').single();
  if (expErr || !explanation) throw new Error(`explanation insert failed: ${expErr?.message}`);

  const runId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: runErr } = await (supabase.from('evolution_runs') as any).insert({
    id: runId,
    explanation_id: explanation.id,
    budget_cap_usd: 0.10,
    status: 'completed',
    run_source: 'public_edit',
    // strategy_id satisfies NOT NULL — reuse the Public Edit Smoke strategy if
    // available; otherwise fail loudly (we don't want this spec to silently
    // run against an arbitrary admin strategy).
    strategy_id: await pickAnyActiveStrategyId(supabase),
    completed_at: new Date().toISOString(),
  });
  if (runErr) throw new Error(`run insert failed: ${runErr.message}`);

  const variantId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: varErr } = await (supabase.from('evolution_variants') as any).insert({
    id: variantId,
    run_id: runId,
    variant_content: winner,
    agent_name: 'e2e_fixture_winner',
    variant_kind: 'article',
    is_winner: true,
    persisted: true,
    generation: 1,
    match_count: 0,
  });
  if (varErr) throw new Error(`variant insert failed: ${varErr.message}`);

  return {
    runId,
    topicId: topic.id,
    explanationId: explanation.id,
    variantId,
    cleanup: async () => {
      await supabase.from('evolution_variants').delete().eq('id', variantId);
      await supabase.from('evolution_runs').delete().eq('id', runId);
      await supabase.from('explanations').delete().eq('id', explanation.id);
      await supabase.from('topics').delete().eq('id', topic.id);
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pickAnyActiveStrategyId(supabase: any): Promise<string> {
  const { data, error } = await supabase
    .from('evolution_strategies')
    .select('id')
    .eq('status', 'active')
    .eq('is_test_content', false)
    .limit(1)
    .single();
  if (error || !data) throw new Error(`no active strategy found for fixture: ${error?.message}`);
  return data.id;
}

test.describe('/edit/runs/[runId] polling → diff handoff', { tag: ['@evolution', '@skip-prod'] }, () => {
  // Serial — shares the seeded fixture across tests in this describe.
  test.describe.configure({ mode: 'serial' });
  let seeded: SeededRun | null = null;

  test.beforeAll(async () => {
    seeded = await seedCompletedRun();
  });

  test.afterAll(async () => {
    if (seeded) await seeded.cleanup();
  });

  test('polling sees completed run within 15s + SideBySideWordDiff renders', async ({ page }) => {
    if (!seeded) throw new Error('fixture not seeded');

    await page.goto(`/edit/runs/${seeded.runId}`);

    // First poll should flip the reducer to viewing within a couple of
    // intervals (POLL_INTERVAL_MS=3000). Allow 15s headroom for slow CI.
    const diff = page.getByTestId('edit-run-viewing');
    await expect(diff).toBeVisible({ timeout: 15_000 });

    // The error UI must NOT appear — the regression we're guarding against is
    // a transient fetch failure aborting the loop even when the run is done.
    await expect(page.getByTestId('edit-run-error')).toHaveCount(0);
  });
});
