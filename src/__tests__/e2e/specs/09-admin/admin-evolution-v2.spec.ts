// Smoke tests for evolution V2 admin UI pages. Verifies each page loads without errors.
// Does not seed data; checks that pages render their key structural elements.

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe('Evolution V2 Admin UI Smoke Tests', { tag: '@evolution' }, () => {
  adminTest('dashboard page loads without error', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution-dashboard');
    await adminPage.waitForLoadState('domcontentloaded');

    // Dashboard content container renders (not the error state)
    const content = adminPage.locator('[data-testid="dashboard-content"]');
    const errorMsg = adminPage.locator('text=Failed to load');

    // Either dashboard content loads or we see a "No data available" message — both are valid
    const loaded = await Promise.race([
      content.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'content'),
      adminPage.locator('text=No data available').waitFor({ state: 'visible', timeout: 15000 }).then(() => 'empty'),
    ]);
    expect(['content', 'empty']).toContain(loaded);

    // Error state should not be showing
    await expect(errorMsg).not.toBeVisible();
  });

  adminTest('runs list page loads', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/runs');
    await adminPage.waitForLoadState('domcontentloaded');

    // Page heading
    await expect(adminPage.locator('main h1').first()).toContainText('Evolution Runs');

    // Filters bar renders
    await expect(adminPage.locator('[data-testid="runs-filters"]')).toBeVisible();

    // Table or empty state renders (table may be empty if no runs exist)
    const table = adminPage.locator('[data-testid="runs-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });
  });

  adminTest('strategies page loads', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies');
    await adminPage.waitForLoadState('domcontentloaded');

    // RegistryPage wraps EntityListPage — verify the entity list container renders
    const entityList = adminPage.locator('[data-testid="entity-list-page"]');
    await expect(entityList).toBeVisible({ timeout: 15000 });

    // Page should have a heading with "Strategies" text
    await expect(adminPage.locator('main h1').first()).toContainText('Strateg');
  });

  adminTest('arena page loads', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/arena');
    await adminPage.waitForLoadState('domcontentloaded');

    // EntityListPage container renders
    const entityList = adminPage.locator('[data-testid="entity-list-page"]');
    await expect(entityList).toBeVisible({ timeout: 15000 });

    // Filter bar should be present
    await expect(adminPage.locator('[data-testid="filter-bar"]')).toBeVisible();
  });
});
