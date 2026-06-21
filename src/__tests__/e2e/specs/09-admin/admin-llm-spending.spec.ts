// E2E: LLM spending dashboard (/admin/costs) — tabbed layout, granularity toggle, and the
// include-test toggle (UI wiring). Assertions target stable structural elements rather than
// data-dependent content, because this runs against the shared staging DB whose contents vary.
// The RPC-level correctness of the granularity + is_test filtering is covered deterministically
// by src/__tests__/integration/evolution-llm-cost-attribution.integration.test.ts.

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe('LLM spending dashboard', { tag: '@evolution' }, () => {
  // Reset the controls to defaults after navigation (admin reset-filters convention).
  async function resetFilters(page: import('@playwright/test').Page) {
    await page.getByTestId('admin-costs-granularity').selectOption('day');
    // setChecked is auto-waiting + idempotent — safe regardless of current state.
    await page.getByTestId('admin-costs-include-test').setChecked(true);
  }

  adminTest('renders all four tabs', async ({ adminPage }) => {
    await adminPage.goto('/admin/costs');
    // Tab bar is always present once the page hydrates (it sits above the loading branch).
    await expect(adminPage.getByTestId('admin-costs-tab-overview')).toBeVisible();
    await resetFilters(adminPage);

    // Overview: the chart CARD heading always renders regardless of whether there is data.
    await expect(adminPage.getByText(/Spend over time/)).toBeVisible();

    await adminPage.getByTestId('admin-costs-tab-entity').click();
    await expect(adminPage.getByTestId('admin-costs-entity-table')).toBeVisible();

    await adminPage.getByTestId('admin-costs-tab-model').click();
    await expect(adminPage.getByText('Model Details')).toBeVisible();

    await adminPage.getByTestId('admin-costs-tab-controls').click();
    await expect(adminPage.getByTestId('admin-costs-controls')).toBeVisible();
  });

  adminTest('granularity toggle re-renders the overview', async ({ adminPage }) => {
    await adminPage.goto('/admin/costs');
    await expect(adminPage.getByTestId('admin-costs-tab-overview')).toBeVisible();
    await resetFilters(adminPage);
    for (const g of ['hour', 'week', 'day'] as const) {
      await adminPage.getByTestId('admin-costs-granularity').selectOption(g);
      // The chart heading reflects the selected granularity — a stable, data-independent proof
      // that the toggle re-rendered the overview.
      await expect(adminPage.getByText(new RegExp(`Spend over time \\(${g}\\)`))).toBeVisible();
    }
  });

  adminTest('include-test toggle is interactive and re-renders the entity tab', async ({ adminPage }) => {
    await adminPage.goto('/admin/costs');
    await expect(adminPage.getByTestId('admin-costs-tab-overview')).toBeVisible();
    await resetFilters(adminPage);
    await adminPage.getByTestId('admin-costs-tab-entity').click();
    await expect(adminPage.getByTestId('admin-costs-entity-table')).toBeVisible();

    // Toggle test rows off then on → the entity table re-renders without error each time.
    // (The is_test filter's data correctness is asserted at the RPC level by the integration test.)
    const includeTest = adminPage.getByTestId('admin-costs-include-test');
    await includeTest.setChecked(false);
    await expect(includeTest).not.toBeChecked();
    await expect(adminPage.getByTestId('admin-costs-entity-table')).toBeVisible();

    await includeTest.setChecked(true);
    await expect(includeTest).toBeChecked();
    await expect(adminPage.getByTestId('admin-costs-entity-table')).toBeVisible();
  });
});
