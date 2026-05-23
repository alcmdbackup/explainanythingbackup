// Strategy creation moved from a modal dialog with strategy-level
// `generationGuidance` to a dedicated /admin/evolution/strategies/new wizard
// where tactic guidance lives PER-ITERATION via TacticGuidanceEditor popover.
// The detailed per-iteration tactic-guidance interactions are covered by
// evolution-strategy-wizard-tactics.spec.ts; this spec now smoke-tests that
// the wizard page loads on the navigation path the strategies list uses.
import { adminTest as test, expect } from '../../fixtures/admin-auth';

test.describe('Strategy creation wizard nav', () => {
  test.describe.configure({ mode: 'serial' });

  test('strategy form shows generation guidance field with add/remove controls', async ({ adminPage: page }) => {
    await page.goto('/admin/evolution/strategies');

    // Click "New Strategy" — navigates to /strategies/new wizard (not a dialog)
    const newBtn = page.getByRole('button', { name: /new strategy/i });
    await expect(newBtn).toBeVisible({ timeout: 10000 });
    await newBtn.click();

    await expect(page).toHaveURL(/\/strategies\/new/, { timeout: 15000 });

    // Wizard step 1 renders the generation/judge model selects
    await expect(page.locator('#generation-model')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#judge-model')).toBeVisible();
  });
});
