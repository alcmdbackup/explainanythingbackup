// E2E test for the 2-step strategy creation wizard: configure strategy, define iterations, submit.
// Verifies redirect to detail page and strategy appears in list.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { trackEvolutionId } from '../../helpers/evolution-test-data-factory';

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

    // Uncheck "Hide test content" to see [TEST] prefixed strategies
    const hideTestCheckbox = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await hideTestCheckbox.isChecked()) {
      await hideTestCheckbox.click();
    }

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
});
