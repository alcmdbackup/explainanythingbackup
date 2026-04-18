// Phase 4 E2E: lineage tab renders the full chain with consecutive-pair diffs
// and the arbitrary-pair From/To picker.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createMultiHopFixture, type MultiHopFixture } from '../../helpers/evolution-test-data-factory';

adminTest.describe('Variant Lineage Tab', { tag: ['@evolution', '@critical'] }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let fixture: MultiHopFixture;

  adminTest.beforeAll(async () => {
    fixture = await createMultiHopFixture();
  });

  adminTest.afterAll(async () => {
    if (fixture) await fixture.cleanup();
  });

  adminTest('renders full chain + pair picker for a multi-hop variant', async ({ adminPage }) => {
    const leafId = fixture.variantIds[fixture.variantIds.length - 1]!;
    await adminPage.goto(`/admin/evolution/variants/${leafId}?tab=lineage`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Full chain container present.
    await expect(adminPage.locator('[data-testid="lineage-full-chain"]')).toBeVisible({ timeout: 20000 });
    // Should render hop-delta text for each non-seed node (3 hops for a 4-node chain).
    const hopDeltas = adminPage.locator('[data-testid="chain-hop-delta"]');
    expect(await hopDeltas.count()).toBeGreaterThanOrEqual(3);

    // Pair picker visible with From + To dropdowns.
    const picker = adminPage.locator('[data-testid="lineage-pair-picker"]');
    await expect(picker).toBeVisible();
    await expect(adminPage.locator('[data-testid="pair-picker-from"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="pair-picker-to"]')).toBeVisible();
  });
});
