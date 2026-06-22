// E2E: the /admin/costs dashboard cost section loads WITHOUT the error banner.
// Regression guard for the cost-section error — getSpendingSummaryAction used to throw to the
// page's bare catch (withServerLogging re-throws), surfacing a generic "Failed to load cost data"
// banner. Phase 3 of debug_llm_spending_data_issues_stage_20260621 makes that action return a
// failure() ActionResult and makes the page surface every action's failure specifically.
//
// No DB seeding: this asserts the page renders and the error banner is absent, independent of how
// much (or little) cost data exists in the dev DB.

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe('Admin costs dashboard', { tag: '@evolution' }, () => {
  adminTest('cost section renders with no error banner', async ({ adminPage }) => {
    await adminPage.goto('/admin/costs', { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    // Hydration proof: the pinned granularity control renders once the client component mounts.
    await expect(adminPage.locator('[data-testid="admin-costs-granularity"]')).toBeVisible({ timeout: 30000 });
    // The tabs render.
    await expect(adminPage.locator('[data-testid="admin-costs-tab-overview"]')).toBeVisible();

    // The cost-section error banner must NOT be present after data loads.
    await expect(adminPage.locator('[data-testid="admin-costs-error"]')).toHaveCount(0);
  });
});
