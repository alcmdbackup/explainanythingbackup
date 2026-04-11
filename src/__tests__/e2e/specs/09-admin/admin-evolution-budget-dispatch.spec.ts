// E2E tests for budget-aware parallel→sequential dispatch in the evolution pipeline.
// Verifies that budgetBufferAfterParallel/budgetBufferAfterSequential strategy settings
// correctly control how many agents are launched and when generation stops.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { trackEvolutionId } from '../../helpers/evolution-test-data-factory';

const TEST_PREFIX = '[TEST_EVO] BudgetDispatch';

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Trigger a pipeline run via the admin API and poll for completion. */
async function triggerAndWaitForRun(
  browser: { newContext: () => Promise<import('@playwright/test').BrowserContext> },
  runId: string,
): Promise<void> {
  const adminContext = await browser.newContext();
  const { createClient: createAnonClient } = await import('@supabase/supabase-js');
  const anonClient = createAnonClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: authData, error: authErr } = await anonClient.auth.signInWithPassword({
    email: process.env.TEST_USER_EMAIL!,
    password: process.env.TEST_USER_PASSWORD!,
  });
  if (authErr || !authData.session) throw new Error(`Auth failed: ${authErr?.message}`);

  const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const projectRef = supabaseUrl.hostname.split('.')[0];
  // eslint-disable-next-line flakiness/no-hardcoded-base-url -- cookie domain needs full URL
  const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
  const cookieDomain = new URL(baseUrl).hostname;
  const isSecure = baseUrl.startsWith('https');
  const cookieName = `sb-${projectRef}-auth-token`;

  const sessionData = {
    access_token: authData.session.access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: authData.session.refresh_token,
    user: authData.user,
  };
  // eslint-disable-next-line flakiness/no-point-in-time-checks -- Buffer.toString
  const base64 = Buffer.from(JSON.stringify(sessionData)).toString('base64');
  const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const cookieValue = `base64-${base64url}`;

  await adminContext.addCookies([{
    name: cookieName, value: cookieValue, domain: cookieDomain,
    path: '/', httpOnly: false, secure: isSecure,
    sameSite: isSecure ? 'None' : 'Lax',
  }]);

  const resp = await fetch(`${baseUrl}/api/evolution/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': `${cookieName}=${cookieValue}` },
    body: JSON.stringify({ targetRunId: runId }),
  });
  expect(resp.ok).toBeTruthy();
  const result = await resp.json();
  expect(result.claimed).toBe(true);
  await adminContext.close();

  // Poll for completion
  const sb = getServiceClient();
  await expect.poll(async () => {
    const { data } = await sb.from('evolution_runs').select('status').eq('id', runId).single();
    return data?.status;
  }, { timeout: 120_000, intervals: [3_000] }).toMatch(/completed|failed/);
}

adminTest.describe('Budget-Aware Dispatch', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });
  adminTest.setTimeout(180_000);

  let promptId: string;
  let strategyId: string;
  let experimentId: string;
  let runId: string;

  adminTest.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(180_000);
    const sb = getServiceClient();

    // Strategy with budget buffers: parallel 40%, sequential 15%
    const { data: strategy, error: stratErr } = await sb
      .from('evolution_strategies')
      .insert({
        name: `${TEST_PREFIX} Strategy`,
        config: {
          generationModel: 'gpt-4.1-nano',
          judgeModel: 'gpt-oss-20b',
          iterations: 1,
          maxVariantsToGenerateFromSeedArticle: 9,
          maxComparisonsPerVariant: 5,
          budgetBufferAfterParallel: 0.40,
          budgetBufferAfterSequential: 0.15,
        },
        config_hash: `e2e-budget-${Date.now()}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (stratErr) throw new Error(`Seed strategy: ${stratErr.message}`);
    strategyId = strategy.id;
    trackEvolutionId('strategy', strategyId);

    const { data: prompt, error: promptErr } = await sb
      .from('evolution_prompts')
      .insert({
        prompt: `Write about solar energy basics ${Date.now()}`,
        name: `${TEST_PREFIX} Prompt`,
        status: 'active',
      })
      .select('id')
      .single();
    if (promptErr) throw new Error(`Seed prompt: ${promptErr.message}`);
    promptId = prompt.id;
    trackEvolutionId('prompt', promptId);

    const { data: experiment, error: expErr } = await sb
      .from('evolution_experiments')
      .insert({ name: `${TEST_PREFIX} Experiment`, prompt_id: promptId, status: 'running' })
      .select('id')
      .single();
    if (expErr) throw new Error(`Seed experiment: ${expErr.message}`);
    experimentId = experiment.id;
    trackEvolutionId('experiment', experimentId);

    const { data: run, error: runErr } = await sb
      .from('evolution_runs')
      .insert({
        strategy_id: strategyId,
        prompt_id: promptId,
        experiment_id: experimentId,
        budget_cap_usd: 0.10,
        status: 'pending',
      })
      .select('id')
      .single();
    if (runErr) throw new Error(`Seed run: ${runErr.message}`);
    runId = run.id;
    trackEvolutionId('run', runId);

    await triggerAndWaitForRun(browser, runId);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
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

  adminTest('parallel dispatch is budget-limited (fewer than maxVariants)', async () => {
    const sb = getServiceClient();
    const { data: invocations } = await sb
      .from('evolution_agent_invocations')
      .select('id, agent_name, iteration')
      .eq('run_id', runId)
      .eq('agent_name', 'generate_from_seed_article');

    expect(invocations).toBeTruthy();
    // With $0.10 budget and 40% parallel buffer, only ~$0.06 available for parallel.
    // Each agent costs ~$0.01-0.04 depending on model. Should be fewer than 9.
    expect(invocations!.length).toBeLessThan(9);
    expect(invocations!.length).toBeGreaterThanOrEqual(1);
  });

  adminTest('run completed without getting stuck', async () => {
    const sb = getServiceClient();
    const { data: run } = await sb
      .from('evolution_runs')
      .select('status, run_summary')
      .eq('id', runId)
      .single();

    expect(run).toBeTruthy();
    expect(run!.status).toBe('completed');
    const summary = run!.run_summary as { stopReason: string } | null;
    expect(summary).toBeTruthy();
    // Should stop due to budget or convergence, not timeout
    expect(['budget_exceeded', 'converged', 'no_pairs', 'iterations_complete']).toContain(summary!.stopReason);
  });

  adminTest('maxComparisonsPerVariant caps ranking', async () => {
    const sb = getServiceClient();
    const { data: invocations } = await sb
      .from('evolution_agent_invocations')
      .select('execution_detail')
      .eq('run_id', runId)
      .eq('agent_name', 'generate_from_seed_article');

    expect(invocations).toBeTruthy();
    for (const inv of invocations!) {
      const detail = inv.execution_detail as { ranking?: { totalComparisons?: number } } | null;
      if (detail?.ranking?.totalComparisons != null) {
        // Strategy set maxComparisonsPerVariant=5
        expect(detail.ranking.totalComparisons).toBeLessThanOrEqual(5);
      }
    }
  });

  adminTest('estimation feedback is recorded in execution_detail', async () => {
    const sb = getServiceClient();
    const { data: invocations } = await sb
      .from('evolution_agent_invocations')
      .select('execution_detail')
      .eq('run_id', runId)
      .eq('agent_name', 'generate_from_seed_article')
      .eq('success', true);

    expect(invocations).toBeTruthy();
    // At least one successful invocation should have estimation feedback
    const withEstimates = invocations!.filter((inv) => {
      const detail = inv.execution_detail as {
        estimatedTotalCost?: number;
        estimationErrorPct?: number;
        generation?: { estimatedCost?: number };
      } | null;
      return detail?.estimatedTotalCost != null && detail?.estimationErrorPct != null;
    });

    expect(withEstimates.length).toBeGreaterThanOrEqual(1);
  });
});
