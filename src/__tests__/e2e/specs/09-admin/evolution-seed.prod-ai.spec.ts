// Real evolution-seed smoke (reduce_e2e_openai_test_costs_20260607).
// Runs ONLY in the `prod-ai` Playwright project against the port-3010 server, which runs
// WITHOUT E2E_TEST_MODE — so `generateSeedArticle` takes the REAL path (no [TEST_EVO] mock) and
// generates the seed via a live LLM. This is the nightly safety-net for the seed-gen path that
// PR-CI now mocks (Phase 1). The strategy pins generationModel/judgeModel to google/gemini-2.5-flash
// (the evolution seed path does NOT route through callLLM, so TEST_LLM_MODEL does not reach it —
// the model must be set via the strategy config). Cheap model + tiny budget keep it inexpensive.
//
// adminTest authenticates inline per-worker (no setup-project dependency), so it runs in the
// prod-ai project unchanged. Assertions are structural (run completed + a seed variant exists),
// not exact-text, so real-LLM non-determinism + the project's retries don't false-red.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

const TEST_PREFIX = '[TEST_EVO] ProdAI Seed';
const CHEAP_MODEL = 'google/gemini-2.5-flash';

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution seed (prod-ai real-AI smoke)', { tag: '@prod-ai' }, () => {
  adminTest.describe.configure({ mode: 'serial' });
  adminTest.setTimeout(300_000);

  let strategyId: string;
  let promptId: string;
  let experimentId: string;
  let runId: string;

  adminTest.beforeAll(async ({ adminPage }, testInfo) => {
    testInfo.setTimeout(300_000);
    const sb = getServiceClient();

    // 1. Strategy pinned to the cheap real model (seed gen reads generationModel from here).
    const { data: strategy, error: stratErr } = await sb
      .from('evolution_strategies')
      .insert({
        name: `${TEST_PREFIX} Strategy`,
        config: {
          generationModel: CHEAP_MODEL,
          judgeModel: CHEAP_MODEL,
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 60 },
            { agentType: 'swiss', budgetPercent: 40 },
          ],
          budgetUsd: 0.05,
        },
        config_hash: `prod-ai-seed-${Date.now()}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (stratErr) throw new Error(`Seed strategy failed: ${stratErr.message}`);
    strategyId = strategy.id;

    // 2. Prompt
    const { data: prompt, error: promptErr } = await sb
      .from('evolution_prompts')
      .insert({
        prompt: `Write a short article about the water cycle ${Date.now()}`,
        name: `${TEST_PREFIX} Prompt`,
        status: 'active',
      })
      .select('id')
      .single();
    if (promptErr) throw new Error(`Seed prompt failed: ${promptErr.message}`);
    promptId = prompt.id;

    // 3. Experiment (running → enables auto-completion RPC)
    const { data: experiment, error: expErr } = await sb
      .from('evolution_experiments')
      .insert({ name: `${TEST_PREFIX} Experiment`, prompt_id: promptId, status: 'running' })
      .select('id')
      .single();
    if (expErr) throw new Error(`Seed experiment failed: ${expErr.message}`);
    experimentId = experiment.id;

    // 4. Pending run
    const { data: run, error: runErr } = await sb
      .from('evolution_runs')
      .insert({
        strategy_id: strategyId,
        prompt_id: promptId,
        experiment_id: experimentId,
        budget_cap_usd: 0.05,
        status: 'pending',
      })
      .select('id')
      .single();
    if (runErr) throw new Error(`Seed run failed: ${runErr.message}`);
    runId = run.id;

    // 5. Trigger via the admin API. adminPage already carries the admin session, and
    //    page.request resolves against the project baseURL (localhost:3010). The route runs
    //    the pipeline synchronously, so allow a long per-request timeout.
    const resp = await adminPage.request.post('/api/evolution/run', {
      data: { targetRunId: runId },
      timeout: 280_000,
    });
    expect(resp.ok()).toBeTruthy();
    const result = await resp.json();
    expect(result.claimed).toBe(true);
    expect(result.runId).toBe(runId);

    // 6. Poll for completion.
    await expect.poll(async () => {
      const { data } = await sb.from('evolution_runs').select('status').eq('id', runId).single();
      return data?.status;
    }, { timeout: 120_000, intervals: [3_000] }).toBe('completed');
  });

  adminTest.afterAll(async () => {
    if (!runId) return;
    const sb = getServiceClient();
    // FK-safe cleanup order (mirrors admin-evolution-run-pipeline.spec.ts).
    await sb.from('evolution_arena_comparisons').delete().eq('prompt_id', promptId);
    await sb.from('evolution_agent_invocations').delete().eq('run_id', runId);
    await sb.from('evolution_logs').delete().eq('run_id', runId);
    await sb.from('evolution_metrics').delete().in('entity_id', [runId, strategyId, experimentId]);
    await sb.from('evolution_variants').delete().eq('run_id', runId);
    await sb.from('evolution_variants').delete().eq('prompt_id', promptId).eq('synced_to_arena', true);
    await sb.from('evolution_explanations').delete().eq('prompt_id', promptId);
    await sb.from('evolution_runs').delete().eq('id', runId);
    await sb.from('evolution_experiments').delete().eq('id', experimentId);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('real seed generation produced a completed run with variants', async () => {
    const sb = getServiceClient();

    const { data: run } = await sb
      .from('evolution_runs')
      .select('status, completed_at')
      .eq('id', runId)
      .single();
    expect(run!.status).toBe('completed');           // real seed + pipeline ran end-to-end
    expect(run!.completed_at).toBeTruthy();

    // A seed variant (generation 0) with real content proves generateSeedArticle ran for real
    // (not the [TEST_EVO] E2E mock, which is disabled on port 3010).
    const { data: variants } = await sb
      .from('evolution_variants')
      .select('id, variant_content')
      .eq('run_id', runId);
    expect(variants!.length).toBeGreaterThanOrEqual(1);
    expect((variants![0]!.variant_content ?? '').length).toBeGreaterThan(0);
  });
});
