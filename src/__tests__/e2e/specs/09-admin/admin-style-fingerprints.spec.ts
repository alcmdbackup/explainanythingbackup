/**
 * @evolution
 * Admin Style Fingerprints registry E2E
 * (generate_enforce_style_fingerprint_evolution_20260620).
 *
 * Seeds a fingerprint (+ one article) via the evolution test-data-factory, then exercises the
 * read/display paths: nav entry → list (with Hide-test reset) → detail (Overview + Articles tabs).
 * Avoids UI article-add (which triggers a real extraction LLM call). Cleanup is FK-safe via the
 * factory (junction cascades on fingerprint delete; no runs reference the seeded fingerprint).
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createTestStyleFingerprint, type TestStyleFingerprint } from '../../helpers/evolution-test-data-factory';

adminTest.describe('Style Fingerprints Registry', () => {
  // beforeAll seeds shared state → serial mode (testing_overview.md Rule 13).
  adminTest.describe.configure({ mode: 'serial' });

  let fingerprint: TestStyleFingerprint;

  adminTest.beforeAll(async () => {
    fingerprint = await createTestStyleFingerprint({ description: 'E2E seeded fingerprint' });
    await fingerprint.addArticle('A short, declarative paragraph in a terse voice. It was good.');
  });

  adminTest.afterAll(async () => {
    await fingerprint.cleanup();
  });

  adminTest('nav → list → detail read paths', { tag: '@evolution' }, async ({ adminPage }) => {
    // Nav entry is present in the Entities group.
    await adminPage.goto('/admin/evolution/style-fingerprints', { timeout: 30000 });
    await expect(
      adminPage.locator('main').getByRole('heading', { name: 'Style Fingerprints' }),
    ).toBeVisible({ timeout: 15000 });

    // Reset the default-on "Hide test content" filter so the TESTEVO-named seed is visible.
    const hideTest = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    if (await hideTest.count()) await hideTest.setChecked(false);

    // The seeded fingerprint appears; click through to its detail page.
    const link = adminPage.getByText(fingerprint.name, { exact: false }).first();
    await expect(link).toBeVisible({ timeout: 15000 });
    await link.click();

    // Detail page: Overview + Articles tabs render; the seeded article is listed.
    await expect(adminPage.getByRole('heading', { name: fingerprint.name })).toBeVisible({ timeout: 15000 });
    await adminPage.getByRole('tab', { name: 'Articles' }).click();
    await expect(adminPage.locator('[data-testid="articles-tab"]')).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('[data-testid="article-row"]').first()).toBeVisible();
  });
});
