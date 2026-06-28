/**
 * Fast smoke for the /edit page (Phase 2 of build_website_for_evolutiOn_20260626).
 *
 * Pure SSR smoke — assert the form renders + no console errors. NO submission,
 * NO LLM call. Catches Vercel deployment breakage without burning real $.
 *
 * Tags: @critical (every PR to main; target < 3min @critical total) + @skip-prod
 * (nightly real-AI suite doesn't need this — it's a render-only check).
 */

import { test, expect } from '@playwright/test';

test.describe('/edit form smoke', { tag: ['@critical', '@skip-prod'] }, () => {
  test('renders the form scaffold without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/edit', { waitUntil: 'domcontentloaded' });

    // Page should render even if no public strategies are seeded yet —
    // we either see the form (when strategies exist) OR the empty-state notice.
    // Drop the explicit timeout so the env-scaled default applies (CI 20s,
    // prod 60s). Local dev Fast Refresh can interrupt within a 10s window.
    const form = page.getByTestId('edit-form');
    const empty = page.getByTestId('edit-form-no-strategies');
    await expect(form.or(empty)).toBeVisible();

    // No console errors during render — filter HMR/Fast-Refresh noise + the
    // expected listPublicStrategies failure when the Phase 1 migration hasn't
    // landed yet on the local dev DB (the action catches + falls back to empty
    // state so the page still renders correctly).
    const realErrors = consoleErrors.filter((e) =>
      !e.includes('Failed to load resource') &&
      !e.includes('Fast Refresh') &&
      !e.includes('[HMR]') &&
      !e.includes('publicAction:listPublicStrategies'),
    );
    expect(realErrors).toEqual([]);
  });
});
