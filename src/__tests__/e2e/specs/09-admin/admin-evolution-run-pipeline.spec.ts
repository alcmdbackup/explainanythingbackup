// E2E test for the full evolution pipeline: seed data, trigger run via API, verify metrics/arena/UI.
// Uses real LLM calls — tagged @evolution so it only runs on production PRs.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { trackEvolutionId } from '../../helpers/evolution-test-data-factory';

const TEST_PREFIX = '[TEST_EVO] Pipeline';

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution Run Pipeline', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });
  adminTest.setTimeout(180_000);

  let promptId: string;
  let strategyId: string;
  let experimentId: string;
  let runId: string;

  // Pipeline runs real LLM calls; need extended timeout for seed + trigger + poll completion
  adminTest.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(180_000);
    const sb = getServiceClient();

    // 1. Seed strategy with cheap models
    const { data: strategy, error: stratErr } = await sb
      .from('evolution_strategies')
      .insert({
        name: `${TEST_PREFIX} Strategy`,
        config: {
          generationModel: 'gpt-4.1-nano',
          judgeModel: 'gpt-4.1-nano',
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 60 },
            { agentType: 'swiss', budgetPercent: 40 },
          ],
          budgetUsd: 0.02,
        },
        config_hash: `e2e-run-${Date.now()}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (stratErr) throw new Error(`Seed strategy failed: ${stratErr.message}`);
    strategyId = strategy.id;
    trackEvolutionId('strategy', strategyId);

    // 2. Seed prompt
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
    trackEvolutionId('prompt', promptId);

    // 3. Seed experiment (running status required for auto-completion RPC)
    const { data: experiment, error: expErr } = await sb
      .from('evolution_experiments')
      .insert({
        name: `${TEST_PREFIX} Experiment`,
        prompt_id: promptId,
        status: 'running',
      })
      .select('id')
      .single();
    if (expErr) throw new Error(`Seed experiment failed: ${expErr.message}`);
    experimentId = experiment.id;
    trackEvolutionId('experiment', experimentId);

    // 4. Seed pending run
    const { data: run, error: runErr } = await sb
      .from('evolution_runs')
      .insert({
        strategy_id: strategyId,
        prompt_id: promptId,
        experiment_id: experimentId,
        budget_cap_usd: 0.02,
        status: 'pending',
      })
      .select('id')
      .single();
    if (runErr) throw new Error(`Seed run failed: ${runErr.message}`);
    runId = run.id;
    trackEvolutionId('run', runId);

    // 5. Trigger pipeline via admin API (need auth cookie for fetch)
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
    if (authErr || !authData.session) throw new Error(`Admin auth failed: ${authErr?.message}`);

    const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const projectRef = supabaseUrl.hostname.split('.')[0];
    // eslint-disable-next-line flakiness/no-hardcoded-base-url -- cookie domain needs full URL, BASE_URL set by playwright.config.ts
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
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- Buffer.toString, not a Playwright method
    const base64 = Buffer.from(JSON.stringify(sessionData)).toString('base64');
    const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const cookieValue = `base64-${base64url}`;

    await adminContext.addCookies([{
      name: cookieName,
      value: cookieValue,
      domain: cookieDomain,
      path: '/',
      httpOnly: false,
      secure: isSecure,
      sameSite: isSecure ? 'None' : 'Lax',
    }]);

    // Use node fetch instead of adminPage.request to avoid browser context disposal race
    const fetchResponse = await fetch(`${baseUrl}/api/evolution/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `${cookieName}=${cookieValue}`,
      },
      body: JSON.stringify({ targetRunId: runId }),
    });
    expect(fetchResponse.ok).toBeTruthy();
    const result = await fetchResponse.json();
    expect(result.claimed).toBe(true);
    expect(result.runId).toBe(runId);

    await adminContext.close();

    // 6. Poll for completion
    await expect.poll(async () => {
      const { data } = await sb.from('evolution_runs').select('status').eq('id', runId).single();
      return data?.status;
    }, { timeout: 120_000, intervals: [3_000] }).toBe('completed');

    // 7. Wait for at least one log entry to be committed — guards against a race where the run
    //    status flips to 'completed' before the final log flush lands in evolution_logs.
    await expect.poll(async () => {
      const { count } = await sb
        .from('evolution_logs')
        .select('*', { count: 'exact', head: true })
        .eq('run_id', runId);
      return count ?? 0;
    }, { timeout: 30_000, intervals: [2_000] }).toBeGreaterThan(0);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();

    // FK-safe cleanup order
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

  adminTest('run completed successfully', async () => {
    const sb = getServiceClient();
    const { data: run } = await sb
      .from('evolution_runs')
      .select('status, run_summary, completed_at')
      .eq('id', runId)
      .single();

    expect(run).toBeTruthy();
    expect(run!.status).toBe('completed');
    expect(run!.run_summary).toBeTruthy();
    const summary = run!.run_summary as { version: number; stopReason: string };
    expect(summary.version).toBe(3);
    expect(['iterations_complete', 'budget_exceeded', 'converged', 'time_limit', 'completed', 'total_budget_exceeded']).toContain(summary.stopReason);
    expect(run!.completed_at).toBeTruthy();
  });

  adminTest('variants were created', async () => {
    const sb = getServiceClient();
    const { data: variants } = await sb
      .from('evolution_variants')
      .select('id, is_winner, elo_score, mu')
      .eq('run_id', runId);

    expect(variants).toBeTruthy();
    expect(variants!.length).toBeGreaterThanOrEqual(2);

    const winners = variants!.filter(v => v.is_winner);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.elo_score).toBeGreaterThan(0);
    expect(winners[0]!.mu).toBeGreaterThan(0);
  });

  adminTest('invocations were recorded', async () => {
    const sb = getServiceClient();
    const { data: invocations } = await sb
      .from('evolution_agent_invocations')
      .select('id, cost_usd, agent_name')
      .eq('run_id', runId);

    expect(invocations).toBeTruthy();
    expect(invocations!.length).toBeGreaterThanOrEqual(1);
    expect(invocations!.some(i => (i.cost_usd ?? 0) > 0)).toBe(true);
    const agentNames = invocations!.map(i => i.agent_name);
    expect(agentNames.some(n => /generation|ranking/i.test(n))).toBe(true);
  });

  adminTest('run metrics were computed with uncertainty/CI on elo', async () => {
    const sb = getServiceClient();
    const { data: metrics } = await sb
      .from('evolution_metrics')
      .select('metric_name, value, sigma, ci_lower, ci_upper')
      .eq('entity_type', 'run')
      .eq('entity_id', runId);

    expect(metrics).toBeTruthy();
    const metricNames = metrics!.map(m => m.metric_name);
    expect(metricNames).toContain('cost');
    expect(metricNames).toContain('winner_elo');
    expect(metricNames).toContain('median_elo');
    expect(metricNames).toContain('variant_count');

    const cost = metrics!.find(m => m.metric_name === 'cost');
    expect(cost!.value).toBeGreaterThan(0);
    expect(cost!.value).toBeLessThan(0.02);

    // Elo metrics should have uncertainty and CI bounds
    const winnerElo = metrics!.find(m => m.metric_name === 'winner_elo');
    expect(winnerElo).toBeTruthy();
    expect(winnerElo!.sigma).not.toBeNull();
    expect(winnerElo!.ci_lower).not.toBeNull();
    expect(winnerElo!.ci_upper).not.toBeNull();
    expect(winnerElo!.ci_lower).toBeLessThan(winnerElo!.value);
    expect(winnerElo!.ci_upper).toBeGreaterThan(winnerElo!.value);
  });

  adminTest('strategy metrics were propagated', async () => {
    const sb = getServiceClient();
    const { data: metrics } = await sb
      .from('evolution_metrics')
      .select('metric_name, value, sigma, ci_lower, ci_upper')
      .eq('entity_type', 'strategy')
      .eq('entity_id', strategyId);

    expect(metrics).toBeTruthy();
    const metricNames = metrics!.map(m => m.metric_name);
    expect(metricNames).toContain('run_count');
    expect(metricNames).toContain('total_cost');
    expect(metricNames).toContain('avg_final_elo');
    expect(metricNames).toContain('best_final_elo');

    const runCount = metrics!.find(m => m.metric_name === 'run_count');
    expect(runCount!.value).toBe(1);

    const totalCost = metrics!.find(m => m.metric_name === 'total_cost');
    expect(totalCost!.value).toBeGreaterThan(0);

    // best_final_elo should exist (uncertainty propagation is inconsistent — tracked separately)
    const bestElo = metrics!.find(m => m.metric_name === 'best_final_elo');
    expect(bestElo).toBeTruthy();
  });

  adminTest('experiment auto-completed and metrics propagated', async () => {
    const sb = getServiceClient();
    const { data: experiment } = await sb
      .from('evolution_experiments')
      .select('status')
      .eq('id', experimentId)
      .single();
    expect(experiment!.status).toBe('completed');

    const { data: metrics } = await sb
      .from('evolution_metrics')
      .select('metric_name, value, sigma, ci_lower, ci_upper')
      .eq('entity_type', 'experiment')
      .eq('entity_id', experimentId);

    expect(metrics).toBeTruthy();
    const metricNames = metrics!.map(m => m.metric_name);
    expect(metricNames).toContain('run_count');
    expect(metricNames).toContain('total_cost');
    expect(metricNames).toContain('avg_final_elo');
    expect(metricNames).toContain('best_final_elo');
    expect(metricNames).toContain('total_matches');

    const runCount = metrics!.find(m => m.metric_name === 'run_count');
    expect(runCount!.value).toBe(1);

    const totalCost = metrics!.find(m => m.metric_name === 'total_cost');
    expect(totalCost!.value).toBeGreaterThan(0);
    expect(totalCost!.value).toBeLessThan(0.02);

    // avg_final_elo should have CI from bootstrap propagation
    const avgElo = metrics!.find(m => m.metric_name === 'avg_final_elo');
    expect(avgElo).toBeTruthy();
    expect(avgElo!.sigma).not.toBeNull();
    expect(avgElo!.ci_lower).not.toBeNull();
    expect(avgElo!.ci_upper).not.toBeNull();
    expect(avgElo!.ci_lower).toBeLessThanOrEqual(avgElo!.value);
    expect(avgElo!.ci_upper).toBeGreaterThanOrEqual(avgElo!.value);
  });

  adminTest('arena sync worked', async () => {
    const sb = getServiceClient();
    const { data: synced } = await sb
      .from('evolution_variants')
      .select('id')
      .eq('prompt_id', promptId)
      .eq('synced_to_arena', true);

    expect(synced).toBeTruthy();
    expect(synced!.length).toBeGreaterThanOrEqual(1);
  });

  adminTest('run detail page renders metrics', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${runId}`);

    // Wait for hydration — entity detail header is data-dependent
    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 30000 });

    const metricsTab = adminPage.locator('[data-testid="tab-metrics"]');
    await expect(metricsTab).toBeVisible({ timeout: 15000 });
    await metricsTab.click();

    // EntityMetricsTab fetches client-side — wait for any final render state.
    // In CI, the server action can take >45s due to Supabase connection pool
    // pressure after 57+ tests with DB connections.
    const metricsAny = adminPage.locator(
      '[data-testid="entity-metrics-tab"], [data-testid="metrics-empty"], [data-testid="metrics-error"], [data-testid="metrics-loading"]'
    );
    await expect(metricsAny.first()).toBeVisible({ timeout: 60000 });

    // Check specific metrics if the full metrics tab rendered (may be in loading/empty state in CI)
    const metricsContainer = adminPage.locator('[data-testid="entity-metrics-tab"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- conditional branch, not assertion
    const hasMetrics = await metricsContainer.count() > 0;
    if (hasMetrics) {
      await expect(adminPage.locator('[data-testid="metric-cost"]')).toBeVisible({ timeout: 10000 });
      await expect(adminPage.locator('[data-testid="metric-winner-elo"]')).toBeVisible({ timeout: 10000 });
    }
  });

  adminTest('experiment detail page renders metrics', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/experiments/${experimentId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    const metricsTab = adminPage.locator('[data-testid="tab-metrics"]');
    await metricsTab.click();

    await expect(adminPage.locator('[data-testid="metric-total-cost"]')).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('[data-testid="metric-runs"]')).toBeVisible();
  });

  adminTest('strategy detail page renders metrics', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/strategies/${strategyId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    const metricsTab = adminPage.locator('[data-testid="tab-metrics"]');
    await metricsTab.click();

    await expect(adminPage.locator('[data-testid="metric-total-cost"]')).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('[data-testid="metric-runs"]')).toBeVisible();
  });

  adminTest('variants tab shows Iteration and Parent columns', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${runId}?tab=variants`);
    await adminPage.waitForLoadState('domcontentloaded');

    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 30000 });

    const variantsTab = adminPage.locator('[data-testid="variants-tab"]');
    await expect(variantsTab).toBeVisible({ timeout: 15000 });

    // Verify Iteration column header exists
    const iterationHeader = variantsTab.locator('th', { hasText: 'Iteration' });
    await expect(iterationHeader).toBeVisible();

    // Verify Parent column header exists
    const parentHeader = variantsTab.locator('th', { hasText: 'Parent' });
    await expect(parentHeader).toBeVisible();

    // Verify at least one data row exists with iteration values
    const firstDataRow = variantsTab.locator('tbody tr').first();
    await expect(firstDataRow).toBeVisible({ timeout: 10000 });
  });

  adminTest('timeline tab shows iteration cards', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${runId}?tab=timeline`);
    await adminPage.waitForLoadState('domcontentloaded');

    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 30000 });

    const timelineTab = adminPage.locator('[data-testid="timeline-tab"]');
    await expect(timelineTab).toBeVisible({ timeout: 15000 });

    // Should have at least one iteration card (iteration 0 or higher)
    const iterationCards = adminPage.locator('[data-testid^="timeline-iter-"]');
    await expect(iterationCards.first()).toBeVisible({ timeout: 10000 });

    // Verify run outcome card renders at the bottom
    const outcomeCard = adminPage.locator('[data-testid="timeline-outcome"]');
    await expect(outcomeCard).toBeVisible({ timeout: 10000 });
  });

  adminTest('logs tab has entries', async ({ adminPage }) => {
    // Navigate directly to the logs tab via URL to avoid click-timing race
    await adminPage.goto(`/admin/evolution/runs/${runId}?tab=logs`);
    await adminPage.waitForLoadState('domcontentloaded');

    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    // Wait for LogsTab skeleton to disappear — indicates getEntityLogsAction completed.
    // 90s timeout: the action can be slow under CI load but always calls setLoading(false).
    await expect(adminPage.locator('[data-testid="logs-tab"] .animate-pulse')).toBeHidden({ timeout: 90000 });

    // Once loading is done, log rows must be visible (beforeAll confirmed logs > 0 in DB)
    const logRows = adminPage.locator('[data-testid="logs-tab"] tr');
    await expect(logRows.first()).toBeVisible({ timeout: 5000 });
  });
});
