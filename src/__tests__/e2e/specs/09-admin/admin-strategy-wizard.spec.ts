// E2E test for the 2-step strategy creation wizard: configure strategy, define iterations, submit.
// Verifies redirect to detail page and strategy appears in list.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { trackEvolutionId } from '../../helpers/evolution-test-data-factory';
import { EvolutionListPage } from '../../helpers/pages/admin/EvolutionListPage';

const TEST_PREFIX = '[TEST] Strategy Wizard';

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Strategy Creation Wizard', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let createdStrategyId: string | undefined;

  // Sweep leftover [TEST] Strategy Wizard rows from prior interrupted CI runs.
  // The per-test afterAll hooks below only clean rows created in THIS run; if a
  // previous run was force-cancelled before afterAll could run, its rows linger
  // and accumulate. The 'strategy appears in strategies list' test then sees
  // ≥2 rows whose name starts with TEST_PREFIX and fails Playwright strict mode
  // on the locator-resolved-to-N-elements rule. Sweeping before the suite
  // starts gives every run a clean baseline regardless of prior state.
  adminTest.beforeAll(async () => {
    const sb = getServiceClient();
    const { data: leftovers } = await sb
      .from('evolution_strategies')
      .select('id')
      .like('name', `${TEST_PREFIX}%`);
    if (!leftovers || leftovers.length === 0) return;
    const ids = leftovers.map((r) => r.id);
    await sb.from('evolution_metrics').delete().in('entity_id', ids);
    await sb.from('evolution_strategies').delete().in('id', ids);
  });

  adminTest.afterAll(async () => {
    if (!createdStrategyId) return;
    const sb = getServiceClient();
    // Clean up metrics and strategy
    await sb.from('evolution_metrics').delete().eq('entity_id', createdStrategyId);
    await sb.from('evolution_strategies').delete().eq('id', createdStrategyId);
  });

  adminTest('wizard page loads with step 1', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');

    // Page title
    await expect(adminPage.locator('text=New Strategy')).toBeVisible({ timeout: 15000 });

    // Step 1 fields visible
    await expect(adminPage.locator('#strategy-name')).toBeVisible();
    await expect(adminPage.locator('#generation-model')).toBeVisible();
    await expect(adminPage.locator('#judge-model')).toBeVisible();
    await expect(adminPage.locator('#budget-usd')).toBeVisible();

    // Judge Escalation picker (default option = single judge; populated from chainRegistry).
    const ensemble = adminPage.getByTestId('ensemble-config-select');
    await expect(ensemble).toBeVisible();
    await expect(ensemble.locator('option[value="gemini-tiebreak-v1"]')).toHaveCount(1);

    // Step 1 "Next" button visible
    await expect(adminPage.locator('button', { hasText: 'Next: Configure Iterations' })).toBeVisible();
  });

  adminTest('step 1 validation blocks empty name', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('#strategy-name')).toBeVisible({ timeout: 15000 });

    // Leave name empty, click Next
    await adminPage.locator('button', { hasText: 'Next: Configure Iterations' }).click();

    // Validation error should appear (use exact match on the inline error, not the alert banner)
    await expect(adminPage.getByText('Name is required', { exact: true })).toBeVisible({ timeout: 10000 });

    // Should still be on step 1 (iterations step not visible)
    await expect(adminPage.locator('#strategy-name')).toBeVisible();
  });

  adminTest('full wizard flow: create strategy with 3 iterations', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('#strategy-name')).toBeVisible({ timeout: 15000 });

    const strategyName = `${TEST_PREFIX} ${Date.now()}`;

    // ── Step 1: Fill strategy config ──────────────────────────
    await adminPage.locator('#strategy-name').fill(strategyName);

    // Select generation model (pick first available option)
    await adminPage.locator('#generation-model').selectOption({ index: 1 });

    // Judge model has a default, verify it's pre-selected
    const judgeValue = await adminPage.locator('#judge-model').inputValue();
    expect(judgeValue).toBeTruthy();

    // Set budget
    await adminPage.locator('#budget-usd').fill('1.50');

    // Click Next
    await adminPage.locator('button', { hasText: 'Next: Configure Iterations' }).click();

    // ── Step 2: Verify default iterations ─────────────────────
    // Should show iteration #1 (generate) and #2 (swiss) by default
    await expect(adminPage.locator('text=#1')).toBeVisible({ timeout: 10000 });
    await expect(adminPage.locator('text=#2')).toBeVisible();

    // Total budget reference should show $1.50 in the header
    await expect(adminPage.getByText('$1.50').first()).toBeVisible();

    // Allocation bar should show 100%
    await expect(adminPage.getByText('100%').first()).toBeVisible();

    // ── Add a third iteration ─────────────────────────────────
    await adminPage.locator('button', { hasText: '+ Add Iteration' }).click();
    await expect(adminPage.locator('text=#3')).toBeVisible();

    // The new iteration has 0% budget, so total is now 100% still but we need to adjust
    // Use "Split Evenly" to distribute budget
    await adminPage.locator('button', { hasText: 'Split Evenly' }).click();

    // After split evenly with 3 iterations: should show percentages that sum to 100%
    // (34 + 33 + 33 = 100 or similar distribution)
    await expect(adminPage.locator('text=100%')).toBeVisible();

    // ── Submit ────────────────────────────────────────────────
    const createBtn = adminPage.locator('button', { hasText: 'Create Strategy' });
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // Wait for redirect to strategy detail page
    await expect(adminPage).toHaveURL(/\/admin\/evolution\/strategies\/[0-9a-f-]+/, { timeout: 20000 });

    // Extract strategy ID from URL
    const url = adminPage.url();
    const idMatch = url.match(/strategies\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    if (idMatch) {
      createdStrategyId = idMatch[1]!;
      trackEvolutionId('strategy', createdStrategyId);
    }

    expect(createdStrategyId).toBeTruthy();

    // Strategy detail page should show header
    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });
  });

  adminTest('strategy appears in strategies list', async ({ adminPage }) => {
    expect(createdStrategyId).toBeTruthy();

    await adminPage.goto('/admin/evolution/strategies');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('main').getByRole('heading', { name: 'Strategies' })).toBeVisible({ timeout: 15000 });

    // Uncheck "Hide test content" via POM so seeded [TEST]-prefixed rows appear.
    // POM uses idempotent setChecked(false); no isChecked() race.
    const listPage = new EvolutionListPage(adminPage);
    await listPage.resetFilters();

    // The strategy name should be visible in the list
    await expect(adminPage.locator('[data-testid="entity-list-table"]').getByText(TEST_PREFIX)).toBeVisible({ timeout: 15000 });
  });

  // Bug 1 regression (20260421): setting an iteration to sourceMode='pool' without
  // touching the cutoff-mode dropdown used to drop qualityCutoff from the emitted
  // payload, triggering Zod error "qualityCutoff required when sourceMode is pool".
  // This test pins the wizard's auto-default behavior end-to-end so the specific
  // gesture that used to fail now succeeds.
  let poolModeCreatedStrategyId: string | undefined;

  adminTest.afterAll(async () => {
    if (!poolModeCreatedStrategyId) return;
    const sb = getServiceClient();
    await sb.from('evolution_metrics').delete().eq('entity_id', poolModeCreatedStrategyId);
    await sb.from('evolution_strategies').delete().eq('id', poolModeCreatedStrategyId);
  });

  adminTest('pool sourceMode auto-defaults cutoff (Bug 1)', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('#strategy-name')).toBeVisible({ timeout: 15000 });

    const strategyName = `${TEST_PREFIX} Pool Auto ${Date.now()}`;

    // Step 1
    await adminPage.locator('#strategy-name').fill(strategyName);
    await adminPage.locator('#generation-model').selectOption({ index: 1 });
    await adminPage.locator('#budget-usd').fill('1.00');
    await adminPage.locator('button', { hasText: 'Next: Configure Iterations' }).click();

    // Step 2 — add a 3rd iteration (default generate, budgetPercent=0), split evenly
    // so percentages sum to 100, then toggle its source to pool WITHOUT touching the
    // cutoff-mode dropdown.
    await expect(adminPage.locator('text=#1')).toBeVisible({ timeout: 10000 });
    await adminPage.locator('button', { hasText: '+ Add Iteration' }).click();
    await expect(adminPage.locator('text=#3')).toBeVisible();
    await adminPage.locator('button', { hasText: 'Split Evenly' }).click();

    // Switch iteration #3 (idx=2) to pool. updateIteration auto-defaults
    // qualityCutoffMode='topN' and qualityCutoffValue=5, so the form becomes valid
    // without any further interaction.
    await adminPage.locator('[data-testid="source-mode-select-2"]').selectOption('pool');

    // Sanity: the cutoff value input is auto-defaulted to 5 by updateIteration.
    const cutoffInput = adminPage.locator('[data-testid="cutoff-value-2"]');
    await expect(cutoffInput).toHaveValue('5');

    // Submit — the key assertion is that Zod does NOT throw
    // "qualityCutoff required when sourceMode is pool".
    const createBtn = adminPage.locator('button', { hasText: 'Create Strategy' });
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // Successful submit redirects to the strategy detail page.
    await expect(adminPage).toHaveURL(/\/admin\/evolution\/strategies\/[0-9a-f-]+/, { timeout: 20000 });

    const url = adminPage.url();
    const idMatch = url.match(/strategies\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    if (idMatch) {
      poolModeCreatedStrategyId = idMatch[1]!;
      trackEvolutionId('strategy', poolModeCreatedStrategyId);
    }
    expect(poolModeCreatedStrategyId).toBeTruthy();
  });

  // ─── reflect_and_generate agent type (Shape A of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430) ───
  // Verifies the wizard exposes 'reflect_and_generate' as a third top-level agentType
  // alongside 'generate' and 'swiss'. Selecting it surfaces a reflectionTopN input and
  // structurally hides tactic-guidance UI (the reflection LLM picks the tactic).

  let reflectionStrategyId: string | undefined;

  adminTest.afterAll(async () => {
    if (!reflectionStrategyId) return;
    const sb = getServiceClient();
    await sb.from('evolution_metrics').delete().eq('entity_id', reflectionStrategyId);
    await sb.from('evolution_strategies').delete().eq('id', reflectionStrategyId);
  });

  adminTest('reflect_and_generate: selecting agent type adds reflectionTopN to config', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('#strategy-name')).toBeVisible({ timeout: 15000 });

    const strategyName = `${TEST_PREFIX} Reflection ${Date.now()}`;

    // Step 1
    await adminPage.locator('#strategy-name').fill(strategyName);
    await adminPage.locator('#generation-model').selectOption({ index: 1 });
    await adminPage.locator('#budget-usd').fill('1.00');
    await adminPage.locator('button', { hasText: 'Next: Configure Iterations' }).click();

    // Step 2 — default iterations: #1 generate, #2 swiss.
    await expect(adminPage.locator('text=#1')).toBeVisible({ timeout: 10000 });

    // The reflection Top-N input should NOT be visible while iteration 0 is 'generate'.
    const topNInput = adminPage.locator('[data-testid="reflection-topn-input-0"]');
    await expect(topNInput).toHaveCount(0);

    // Switch iteration 0's agent type to reflect_and_generate.
    const agentTypeSelect = adminPage.locator('[data-testid="agent-type-select-0"]');
    await expect(agentTypeSelect).toBeVisible();
    await agentTypeSelect.selectOption('reflect_and_generate');

    // Top-N input now visible with default value 3.
    await expect(topNInput).toBeVisible();
    await expect(topNInput).toHaveValue('3');

    // Tactic-guidance button is structurally hidden (generate-only).
    await expect(adminPage.locator('[data-testid="tactic-guidance-btn-0"]')).toHaveCount(0);

    // Submit — the key assertion is that the strategy is created with agentType:'reflect_and_generate'.
    // Use Promise.all to attach the URL waiter BEFORE the click; this avoids a race
    // where the click + server redirect complete before the toHaveURL assertion attaches.
    // Server Actions POST to the page URL with a Next-Action header, so URL-change is
    // the deterministic signal — not waitForResponse.
    const createBtn = adminPage.locator('button', { hasText: 'Create Strategy' });
    await expect(createBtn).toBeEnabled();
    await Promise.all([
      adminPage.waitForURL(/\/admin\/evolution\/strategies\/[0-9a-f-]+/, { timeout: 20000 }),
      createBtn.click(),
    ]);

    await expect(adminPage).toHaveURL(/\/admin\/evolution\/strategies\/[0-9a-f-]+/, { timeout: 20000 });
    const url = adminPage.url();
    const idMatch = url.match(/strategies\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    if (idMatch) {
      reflectionStrategyId = idMatch[1]!;
      trackEvolutionId('strategy', reflectionStrategyId);
    }
    expect(reflectionStrategyId).toBeTruthy();

    // Verify the persisted config has agentType:'reflect_and_generate' + reflectionTopN on iteration 0.
    const sb = getServiceClient();
    const { data } = await sb
      .from('evolution_strategies')
      .select('config')
      .eq('id', reflectionStrategyId!)
      .single();
    expect(data).toBeTruthy();
    const config = data!.config as { iterationConfigs: Array<{ agentType: string; reflectionTopN?: number }> };
    expect(config.iterationConfigs[0]!.agentType).toBe('reflect_and_generate');
    expect(config.iterationConfigs[0]!.reflectionTopN).toBe(3);
  });

  adminTest('reflect_and_generate: switching back to generate hides reflection UI', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('#strategy-name')).toBeVisible({ timeout: 15000 });

    await adminPage.locator('#strategy-name').fill(`${TEST_PREFIX} Toggle ${Date.now()}`);
    await adminPage.locator('#generation-model').selectOption({ index: 1 });
    await adminPage.locator('button', { hasText: 'Next: Configure Iterations' }).click();
    await expect(adminPage.locator('text=#1')).toBeVisible({ timeout: 10000 });

    const agentTypeSelect = adminPage.locator('[data-testid="agent-type-select-0"]');
    const topNInput = adminPage.locator('[data-testid="reflection-topn-input-0"]');
    const tacticsButton = adminPage.locator('[data-testid="tactic-guidance-btn-0"]');

    // Initially generate: tactics button visible, no Top-N input.
    await expect(tacticsButton).toBeVisible();
    await expect(topNInput).toHaveCount(0);

    // Switch to reflect_and_generate: Top-N input appears, tactics button disappears.
    await agentTypeSelect.selectOption('reflect_and_generate');
    await expect(topNInput).toBeVisible();
    await expect(tacticsButton).toHaveCount(0);

    // Switch back to generate: tactics button reappears, Top-N input gone.
    await agentTypeSelect.selectOption('generate');
    await expect(tacticsButton).toBeVisible();
    await expect(topNInput).toHaveCount(0);
  });

  // ─── paragraph_recombine top-N pool selection (make_fixes_paragraph_recombine_20260528) ───
  // Task 1: the wizard now exposes sourceMode/qualityCutoff controls for paragraph_recombine
  // (its isVariantProducing() gate was fixed). Build [generate, paragraph_recombine], set the
  // recombine row to pool with a top-N cutoff, submit, and assert the persisted config carries
  // sourceMode:'pool' + qualityCutoff. Pre-fix the controls never rendered and the iteration
  // was silently pinned to seed.

  let paragraphRecombineStrategyId: string | undefined;

  adminTest.afterAll(async () => {
    if (!paragraphRecombineStrategyId) return;
    const sb = getServiceClient();
    await sb.from('evolution_metrics').delete().eq('entity_id', paragraphRecombineStrategyId);
    await sb.from('evolution_strategies').delete().eq('id', paragraphRecombineStrategyId);
  });

  adminTest('paragraph_recombine: pool-mode source controls persist sourceMode + qualityCutoff', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('#strategy-name')).toBeVisible({ timeout: 15000 });

    const strategyName = `${TEST_PREFIX} ParagraphRecombine ${Date.now()}`;

    // Step 1
    await adminPage.locator('#strategy-name').fill(strategyName);
    await adminPage.locator('#generation-model').selectOption({ index: 1 });
    await adminPage.locator('#budget-usd').fill('1.00');
    await adminPage.locator('button', { hasText: 'Next: Configure Iterations' }).click();

    // Step 2 — defaults: #1 generate, #2 swiss. Turn #2 (idx=1) into paragraph_recombine.
    await expect(adminPage.locator('text=#1')).toBeVisible({ timeout: 10000 });
    await expect(adminPage.locator('text=#2')).toBeVisible();

    const agentTypeSelect = adminPage.locator('[data-testid="agent-type-select-1"]');
    await expect(agentTypeSelect).toBeVisible();
    await agentTypeSelect.selectOption('paragraph_recombine');

    // The source controls now render for the recombine row (idx>0 + variant-producing).
    const sourceSelect = adminPage.locator('[data-testid="source-mode-select-1"]');
    await expect(sourceSelect).toBeVisible();
    await sourceSelect.selectOption('pool');

    // sourceMode→pool auto-defaults the top-N cutoff to 5.
    const cutoffValue = adminPage.locator('[data-testid="cutoff-value-1"]');
    await expect(cutoffValue).toHaveValue('5');

    // Submit — successful create redirects to the strategy detail page.
    const createBtn = adminPage.locator('button', { hasText: 'Create Strategy' });
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    await expect(adminPage).toHaveURL(/\/admin\/evolution\/strategies\/[0-9a-f-]+/, { timeout: 20000 });
    const url = adminPage.url();
    const idMatch = url.match(/strategies\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    if (idMatch) {
      paragraphRecombineStrategyId = idMatch[1]!;
      trackEvolutionId('strategy', paragraphRecombineStrategyId);
    }
    expect(paragraphRecombineStrategyId).toBeTruthy();

    // Verify the persisted config: iteration 1 is paragraph_recombine with pool source + cutoff.
    const sb = getServiceClient();
    const { data } = await sb
      .from('evolution_strategies')
      .select('config')
      .eq('id', paragraphRecombineStrategyId!)
      .single();
    expect(data).toBeTruthy();
    const config = data!.config as {
      iterationConfigs: Array<{ agentType: string; sourceMode?: string; qualityCutoff?: { mode: string; value: number } }>;
    };
    expect(config.iterationConfigs[1]!.agentType).toBe('paragraph_recombine');
    expect(config.iterationConfigs[1]!.sourceMode).toBe('pool');
    expect(config.iterationConfigs[1]!.qualityCutoff).toEqual({ mode: 'topN', value: 5 });
  });

  // investigate_sequential_paragraph_recombine_performance_20260615:
  // Phase 4d adds coordinator-model-select; Phase 5a-1 adds seed-selection-select.
  // Both are optional strategy-config fields that fall back to byte-identical
  // pre-Phase-4d/5 behavior when unset. This test verifies they render in the
  // wizard, accept values, and persist into evolution_strategies.config.
  let coordSeedStrategyId: string | undefined;
  adminTest.afterAll(async () => {
    if (!coordSeedStrategyId) return;
    const sb = getServiceClient();
    await sb.from('evolution_metrics').delete().eq('entity_id', coordSeedStrategyId);
    await sb.from('evolution_strategies').delete().eq('id', coordSeedStrategyId);
  });

  adminTest('Phase 4d + 5a-1: coordinator-model-select and seed-selection-select render and persist', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('#strategy-name')).toBeVisible({ timeout: 15000 });

    const strategyName = `${TEST_PREFIX} CoordSeed ${Date.now()}`;
    await adminPage.locator('#strategy-name').fill(strategyName);
    await adminPage.locator('#generation-model').selectOption({ index: 1 });
    await adminPage.locator('#budget-usd').fill('0.10');

    // Both new dropdowns visible.
    const coordSelect = adminPage.locator('[data-testid="coordinator-model-select"]');
    const seedSelect = adminPage.locator('[data-testid="seed-selection-select"]');
    await expect(coordSelect).toBeVisible();
    await expect(seedSelect).toBeVisible();

    // Default values: both empty (inherit from generation model / default highest_elo).
    await expect(coordSelect).toHaveValue('');
    await expect(seedSelect).toHaveValue('');

    // Pick the first non-default option in each — the exact model identifier
    // doesn't matter, we only verify the wizard persists what the user chose.
    // (Use evaluate to capture the chosen value AFTER the selectOption call has
    //  settled — toHaveValue() is the assertion-side helper but we also need the
    //  actual string to compare against the persisted jsonb later.)
    await coordSelect.selectOption({ index: 1 });
    await expect(coordSelect).not.toHaveValue('');
    const chosenCoordModel = await coordSelect.evaluate((el) => (el as HTMLSelectElement).value);
    expect(chosenCoordModel.length).toBeGreaterThan(0);

    await seedSelect.selectOption('random');
    await expect(seedSelect).toHaveValue('random');

    // Submit
    await adminPage.locator('button', { hasText: 'Next: Configure Iterations' }).click();
    await expect(adminPage.locator('text=#1')).toBeVisible({ timeout: 10000 });
    const createBtn = adminPage.locator('button', { hasText: 'Create Strategy' });
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    await expect(adminPage).toHaveURL(/\/admin\/evolution\/strategies\/[0-9a-f-]+/, { timeout: 20000 });
    const idMatch = adminPage.url().match(/strategies\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    expect(idMatch).toBeTruthy();
    coordSeedStrategyId = idMatch![1]!;
    trackEvolutionId('strategy', coordSeedStrategyId);

    // Verify persistence — both fields land in evolution_strategies.config jsonb.
    const sb = getServiceClient();
    const { data } = await sb.from('evolution_strategies')
      .select('config').eq('id', coordSeedStrategyId).single();
    expect(data).toBeTruthy();
    const config = data!.config as { coordinatorModel?: string; seedSelection?: string };
    expect(config.coordinatorModel).toBe(chosenCoordModel);
    expect(config.seedSelection).toBe('random');
  });
});
