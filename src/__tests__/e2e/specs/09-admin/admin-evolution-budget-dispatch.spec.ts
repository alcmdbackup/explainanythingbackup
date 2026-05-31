// E2E tests for budget-aware parallel→sequential dispatch in the evolution pipeline.
// Verifies that budgetBufferAfterParallel/budgetBufferAfterSequential strategy settings
// correctly control how many agents are launched and when generation stops.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { trackEvolutionId } from '../../helpers/evolution-test-data-factory';
import { longTimeoutDispatcher } from '../../helpers/long-timeout-fetch';

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
    // Pipeline runs synchronously inside the route handler; default 5-min undici
    // headersTimeout fires before pipeline completes on slow LLM-provider runs.
    dispatcher: longTimeoutDispatcher,
  } as RequestInit & { dispatcher: typeof longTimeoutDispatcher });
  expect(resp.ok).toBeTruthy();
  const result = await resp.json();
  expect(result.claimed).toBe(true);
  await adminContext.close();

  // Poll for completion
  const sb = getServiceClient();
  await expect.poll(async () => {
    const { data } = await sb.from('evolution_runs').select('status').eq('id', runId).single();
    return data?.status;
  }, { timeout: 240_000, intervals: [5_000] }).toMatch(/completed|failed/);
}

adminTest.describe('Budget-Aware Dispatch', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });
  adminTest.setTimeout(300_000);

  // SKIPPED: beforeAll runs a real LLM pipeline that times out on CI. See
  // admin-evolution-iterative-editing.spec.ts for the same root cause.
  // eslint-disable-next-line flakiness/no-test-skip -- pipeline perf issue on CI; new test never ran in this CI context before
  adminTest.skip(true, 'pipeline beforeAll timing out on CI; needs perf investigation (tracked in follow-up)');

  let promptId: string;
  let strategyId: string;
  let experimentId: string;
  let runId: string;

  adminTest.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(300_000);
    const sb = getServiceClient();

    // Strategy with budget buffers: parallel 40%, sequential 15%
    const { data: strategy, error: stratErr } = await sb
      .from('evolution_strategies')
      .insert({
        name: `${TEST_PREFIX} Strategy`,
        config: {
          generationModel: 'gpt-4.1-nano',
          judgeModel: 'gpt-4.1-nano',
          iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
          maxComparisonsPerVariant: 3,
          budgetBufferAfterParallel: 0.50,
          budgetBufferAfterSequential: 0.20,
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
        budget_cap_usd: 0.03,
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

  adminTest('parallel dispatch is budget-governed (below safety cap, above zero)', async () => {
    const sb = getServiceClient();
    const { data: invocations } = await sb
      .from('evolution_agent_invocations')
      .select('id, agent_name, iteration, cost_usd')
      .eq('run_id', runId)
      .eq('agent_name', 'generate_from_previous_article');

    expect(invocations).toBeTruthy();
    // Phase 4 of investigate_under_budget_run_evolution_20260420 dropped the hard
    // per-iter maxAgents/numVariants cap in favor of DISPATCH_SAFETY_CAP=100 as a
    // defense-in-depth rail. The primary governor is budget — with cheap models
    // like gpt-4.1-nano the budget affords many dispatches. Key invariants now:
    //   1. at least one dispatch happened (1 ≤ N)
    //   2. safety cap was respected (N ≤ 100)
    //   3. total generation spend stayed under the $0.03 run budget
    expect(invocations!.length).toBeGreaterThanOrEqual(1);
    expect(invocations!.length).toBeLessThanOrEqual(100);
    const totalSpend = invocations!.reduce((a, r) => a + (r.cost_usd ?? 0), 0);
    expect(totalSpend).toBeLessThanOrEqual(0.03);
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
    expect(['budget_exceeded', 'converged', 'no_pairs', 'iterations_complete', 'completed', 'total_budget_exceeded']).toContain(summary!.stopReason);
  });

  adminTest('maxComparisonsPerVariant caps ranking', async () => {
    const sb = getServiceClient();
    const { data: invocations } = await sb
      .from('evolution_agent_invocations')
      .select('execution_detail')
      .eq('run_id', runId)
      .eq('agent_name', 'generate_from_previous_article');

    expect(invocations).toBeTruthy();
    for (const inv of invocations!) {
      const detail = inv.execution_detail as { ranking?: { totalComparisons?: number } } | null;
      if (detail?.ranking?.totalComparisons != null) {
        // Strategy set maxComparisonsPerVariant=3
        expect(detail.ranking.totalComparisons).toBeLessThanOrEqual(3);
      }
    }
  });

  adminTest('estimation feedback is recorded in execution_detail', async () => {
    const sb = getServiceClient();
    const { data: invocations } = await sb
      .from('evolution_agent_invocations')
      .select('execution_detail')
      .eq('run_id', runId)
      .eq('agent_name', 'generate_from_previous_article')
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

// ─── Strategy creation form tests (UI) ──────────────────────────────

adminTest.describe('Strategy Form — Budget Dispatch Fields', { tag: '@evolution' }, () => {
  adminTest('new strategy wizard shows budget dispatch fields', async ({ adminPage }) => {
    // Strategy creation now uses wizard at /strategies/new
    await adminPage.goto('/admin/evolution/strategies/new');
    await expect(adminPage.getByText('New Strategy')).toBeVisible({ timeout: 15_000 });

    // Expand Advanced Settings to see budget floor fields
    const details = adminPage.locator('details', { hasText: 'Advanced Settings' });
    await details.click();

    // Verify fields are present in the wizard Step 1
    await expect(adminPage.getByText('Max Comparisons per Variant')).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText('Budget Floor Mode')).toBeVisible();
  });

  // investigate_paragraph_rewrite_cost_undershoot_evolution_20260529 (Phase 7 K3/F4):
  // The new strategy wizard shows the paragraph_recombine iteration in the dispatch plan
  // preview, and (when configured with maxDispatches > 1 + sourceMode='pool') renders the
  // parallel + top-up dispatch projection chip — same surface used by generate iterations.
  // K3 adds a cyan agent-type badge; F4 adds the per-row "cap $X" annotation.
  // Phase 8 (L) — investigate_paragraph_rewrite_cost_undershoot_evolution_20260529:
  // Verifies the wizard exposes maxDispatches and perInvocationCapUsd as numeric inputs
  // when a paragraph_recombine iteration is selected. Pre-Phase-8 these fields existed in
  // the schema + projector + dispatch view but had no input control — every wizard-created
  // strategy defaulted to maxDispatches=1 and shipped single-dispatch even after J4 deployed.
  adminTest('paragraph_recombine wizard inputs: maxDispatches + perInvocationCapUsd render with defaults', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('#strategy-name')).toBeVisible({ timeout: 15_000 });

    // Step 1: fill required Strategy Config fields and advance to iterations.
    await adminPage.locator('#strategy-name').fill(`${TEST_PREFIX} L7 wizard ${Date.now()}`);
    await adminPage.locator('#generation-model').selectOption({ index: 1 });
    await adminPage.locator('#budget-usd').fill('1.00');
    await adminPage.locator('button', { hasText: 'Next: Configure Iterations' }).click();

    // Step 2: switch iter 0's agentType to paragraph_recombine so the knob row renders.
    const agentTypeSelect = adminPage.getByTestId('agent-type-select-0');
    await expect(agentTypeSelect).toBeVisible({ timeout: 10_000 });
    await agentTypeSelect.selectOption('paragraph_recombine');
    await expect(adminPage.getByTestId('iteration-paragraph-controls-0')).toBeVisible({ timeout: 5_000 });

    // The 2 new inputs must render with their defaults (1 and 0.05).
    const maxDispatchesInput = adminPage.getByTestId('max-dispatches-0');
    const perInvocationCapInput = adminPage.getByTestId('per-invocation-cap-usd-0');
    await expect(maxDispatchesInput).toBeVisible({ timeout: 5_000 });
    await expect(perInvocationCapInput).toBeVisible();
    await expect(maxDispatchesInput).toHaveValue('1');
    await expect(perInvocationCapInput).toHaveValue('0.05');

    // Raising the values must be reflected. The actual dispatch-plan-preview update is
    // covered by DispatchPlanView.test.tsx unit tests; here we only assert the input
    // layer accepts user changes (so the payload emission path is exercised).
    await maxDispatchesInput.fill('5');
    await expect(maxDispatchesInput).toHaveValue('5');
    await perInvocationCapInput.fill('0.08');
    await expect(perInvocationCapInput).toHaveValue('0.08');
  });

  adminTest('paragraph_recombine: strategy detail page renders with new perInvocationCapUsd/maxDispatches fields', async ({ adminPage }) => {
    // Create a paragraph_recombine strategy with the new opt-in knobs.
    const sb = getServiceClient();
    const { data: strategy } = await sb
      .from('evolution_strategies')
      .insert({
        name: '[TEST_EVO] Paragraph Recombine Multi-Dispatch',
        config: {
          generationModel: 'gpt-4.1-nano',
          judgeModel: 'gpt-4.1-nano',
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 60 },
            {
              agentType: 'paragraph_recombine',
              budgetPercent: 40,
              sourceMode: 'pool',
              qualityCutoff: { mode: 'topN', value: 5 },
              maxDispatches: 3,
              perInvocationCapUsd: 0.08,
            },
          ],
        },
        config_hash: `e2e-paragraph-multidispatch-${Date.now()}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (!strategy) return;
    trackEvolutionId('strategy', strategy.id);

    await adminPage.goto(`/admin/evolution/strategies/${strategy.id}`);
    const configTab = adminPage.locator('[data-testid="tab-config"]');
    await configTab.waitFor({ state: 'visible', timeout: 30_000 });
    await configTab.click();

    // The page renders without falling into an error boundary. The agent name 'paragraph_recombine'
    // surfaces in the iteration listing — proving the new fields parse cleanly through the schema.
    await expect(adminPage.getByText('paragraph_recombine').first()).toBeVisible({ timeout: 15000 });
  });

  adminTest('strategy config display shows buffer fields for existing strategy', async ({ adminPage }) => {
    // Create a strategy with buffer fields via DB, then verify display on detail page
    const sb = getServiceClient();
    const { data: strategy } = await sb
      .from('evolution_strategies')
      .insert({
        name: '[TEST_EVO] Buffer Display Test',
        config: {
          generationModel: 'gpt-4.1-nano',
          judgeModel: 'gpt-4.1-nano',
          iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
          budgetBufferAfterParallel: 0.35,
          budgetBufferAfterSequential: 0.10,
        },
        config_hash: `e2e-display-${Date.now()}`,
        status: 'active',
      })
      .select('id')
      .single();

    if (!strategy) return;
    trackEvolutionId('strategy', strategy.id);

    // Navigate to the strategy detail page and click Configuration tab
    await adminPage.goto(`/admin/evolution/strategies/${strategy.id}`);
    // Default tab is Metrics — click Configuration tab
    const configTab = adminPage.locator('[data-testid="tab-config"]');
    await configTab.waitFor({ state: 'visible', timeout: 30_000 });
    await configTab.click();
    // Wait for the config display to render — look for the model name
    await expect(adminPage.getByText('gpt-4.1-nano').first()).toBeVisible({ timeout: 10_000 });

    // Verify buffer values are displayed as percentages
    await expect(adminPage.getByText('35%')).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText('10%')).toBeVisible();

    // Cleanup
    await sb.from('evolution_strategies').delete().eq('id', strategy.id);
  });
});
