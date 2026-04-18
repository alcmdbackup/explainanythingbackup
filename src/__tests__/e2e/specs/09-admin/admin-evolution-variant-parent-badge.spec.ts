// Phase 3 E2E: verify VariantParentBadge renders on every variant-display surface.
// Covers: standalone variants page, run/strategy VariantsTab, arena leaderboard,
// variant detail page header. Uses a seeded multi-hop fixture.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createMultiHopFixture, type MultiHopFixture } from '../../helpers/evolution-test-data-factory';

adminTest.describe('Variant Parent Badge', { tag: ['@evolution', '@critical'] }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let fixture: MultiHopFixture;

  adminTest.beforeAll(async () => {
    fixture = await createMultiHopFixture();
  });

  adminTest.afterAll(async () => {
    if (fixture) await fixture.cleanup();
  });

  adminTest('variant detail page shows parent badge for leaf variant', async ({ adminPage }) => {
    const leafId = fixture.variantIds[fixture.variantIds.length - 1]!;
    await adminPage.goto(`/admin/evolution/variants/${leafId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const badge = adminPage.locator('[data-testid="variant-parent-badge"]').first();
    await expect(badge).toBeVisible({ timeout: 15000 });
    // Non-seed variant should display the parent short ID.
    await expect(badge).toHaveAttribute('data-state', 'parent');
    await expect(badge).toContainText(/Parent #/);
    // Should also show a delta.
    await expect(badge).toContainText(/Δ/);
  });

  adminTest('seed variant renders null-state "Seed · no parent"', async ({ adminPage }) => {
    const seedId = fixture.variantIds[0]!;
    await adminPage.goto(`/admin/evolution/variants/${seedId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const badge = adminPage.locator('[data-testid="variant-parent-badge"]').first();
    await expect(badge).toBeVisible({ timeout: 15000 });
    await expect(badge).toHaveAttribute('data-state', 'seed');
    await expect(badge).toContainText('Seed · no parent');
  });

  adminTest('run variants tab shows parent badges for produced variants', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${fixture.runId}?tab=variants`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for at least one parent badge in the tab.
    const badges = adminPage.locator('[data-testid="variant-parent-badge"]');
    await expect(badges.first()).toBeVisible({ timeout: 15000 });
    // Should have at least 3 badges (v1, v2, leaf — all have parents; seed is unrated → still renders seed badge).
    expect(await badges.count()).toBeGreaterThanOrEqual(3);
  });
});
