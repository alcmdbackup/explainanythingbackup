// E2E: Verify tactic guidance popover and dispatch preview in the strategy creation wizard.

import { test, expect } from '../../fixtures/auth';

test.describe('Strategy Wizard — Tactic Guidance', { tag: '@evolution' }, () => {
  test('tactic guidance button appears on generate iterations only', async ({ authenticatedPage: page }) => {
    await page.goto('/admin/evolution/strategies/new');

    // Fill required fields to advance to Step 2
    await page.fill('input[placeholder="Strategy name"]', 'E2E Test Tactics');
    const genSelect = page.locator('#generation-model');
    await genSelect.selectOption({ index: 1 });
    await page.click('button:has-text("Next: Configure Iterations")');

    // Wait for iterations step
    await page.waitForSelector('[data-testid="tactic-guidance-btn-0"]', { timeout: 10000 });

    // Generate iteration #1 should have tactic button
    await expect(page.locator('[data-testid="tactic-guidance-btn-0"]')).toBeVisible();

    // Swiss iteration #2 should NOT have tactic button
    await expect(page.locator('[data-testid="tactic-guidance-btn-1"]')).toHaveCount(0);
  });

  test('tactic guidance editor opens and shows categories', async ({ authenticatedPage: page }) => {
    await page.goto('/admin/evolution/strategies/new');
    await page.fill('input[placeholder="Strategy name"]', 'E2E Test Tactics Editor');
    // Select first valid generation model
    const genSelect = page.locator('#generation-model');
    await genSelect.selectOption({ index: 1 });
    await page.click('button:has-text("Next: Configure Iterations")');
    await page.waitForSelector('[data-testid="tactic-guidance-btn-0"]', { timeout: 15000 });

    await page.click('[data-testid="tactic-guidance-btn-0"]');
    await page.waitForSelector('[data-testid="tactic-guidance-editor"]', { timeout: 5000 });

    // Should show category headers within the editor
    const editor = page.locator('[data-testid="tactic-guidance-editor"]');
    await expect(editor.locator('text=CORE').first()).toBeVisible();
    await expect(editor.locator('text=EXTENDED').first()).toBeVisible();

    // Should show tactic names
    await expect(page.locator('text=structural_transform')).toBeVisible();
    await expect(page.locator('text=lexical_simplify')).toBeVisible();

    // Should show preset buttons within the editor
    await expect(editor.locator('button:has-text("Even")')).toBeVisible();
    await expect(editor.locator('button:has-text("Core only")')).toBeVisible();
    await expect(editor.locator('button:has-text("Clear")')).toBeVisible();
  });

  test('dispatch preview shows agent count estimate', async ({ authenticatedPage: page }) => {
    await page.goto('/admin/evolution/strategies/new');
    await page.fill('input[placeholder="Strategy name"]', 'E2E Dispatch Preview');
    const genSelect = page.locator('#generation-model');
    await genSelect.selectOption({ index: 1 });
    await page.click('button:has-text("Next: Configure Iterations")');

    // Phase 6: dispatch preview now lives in the shared DispatchPlanView component,
    // which renders a per-iteration row with a data-testid of `dispatch-plan-row-{iterIdx}`.
    // The old per-iteration inline `dispatch-preview-{idx}` span was removed.
    await page.waitForSelector('[data-testid="dispatch-plan-row-0"]', { timeout: 10000 });
    const planRow = page.locator('[data-testid="dispatch-plan-row-0"]');
    await expect(planRow).toBeVisible();
    // The row should contain a dispatch count and an effective-cap badge.
    const text = await planRow.textContent();
    expect(text).toMatch(/\d+/);
  });
});
