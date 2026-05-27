// Verify the generationGuidance feature is reachable from the strategy creation form.
// The form moved from a dialog (with guidance-* testids) to the wizard at
// /admin/evolution/strategies/new; per-iteration guidance now lives in the
// TacticGuidanceEditor popover (tactic-guidance-btn-N / tactic-guidance-editor).
// Deeper TacticGuidanceEditor coverage lives in evolution-strategy-wizard-tactics.spec.ts.
import { adminTest as test, expect } from '../../fixtures/admin-auth';

test.describe('Strategy creation generationGuidance UI', () => {
  test.describe.configure({ mode: 'serial' });

  test('strategy form exposes tactic guidance editor on generate iterations', async ({ adminPage: page }) => {
    // Navigate to strategies page
    await page.goto('/admin/evolution/strategies');

    // Click "New Strategy" button — navigates to wizard
    const newBtn = page.getByRole('button', { name: /new strategy/i });
    await expect(newBtn).toBeVisible({ timeout: 10000 });
    await newBtn.click();
    await expect(page).toHaveURL(/\/strategies\/new/, { timeout: 15000 });

    // Fill Step 1 required fields
    await page.fill('input[placeholder="Strategy name"]', `[E2E] guidance-${Date.now()}`);
    const genSelect = page.locator('#generation-model');
    await genSelect.selectOption({ index: 1 });

    // Advance to Step 2 (iterations)
    await page.click('button:has-text("Next: Configure Iterations")');
    await page.waitForSelector('[data-testid="tactic-guidance-btn-0"]', { timeout: 30000 });

    // The first iteration (generate) should expose the tactic-guidance button
    await expect(page.locator('[data-testid="tactic-guidance-btn-0"]')).toBeVisible();

    // Open the popover and verify add/remove/percent equivalents exist
    await page.click('[data-testid="tactic-guidance-btn-0"]');
    const editor = page.locator('[data-testid="tactic-guidance-editor"]');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // The editor exposes preset controls — replaces the old guidance-add / guidance-total UI
    await expect(editor.locator('button:has-text("Even")')).toBeVisible();
    await expect(editor.locator('button:has-text("Clear")')).toBeVisible();
  });
});
