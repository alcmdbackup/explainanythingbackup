// E2E: the "Diff vs parent" tab renders a side-by-side word diff for article and paragraph
// variants, isolates the parent paragraph for slot rewrites (incl. legacy empty-lineage via
// the prompt_id fallback), and shows explicit empty states for parentless variants.
// enable_side_by_side_variant_comparisons_vs_parent_20260531.

import { adminTest, expect } from '../../fixtures/admin-auth';
import {
  createMultiHopFixture,
  createParagraphRecombineFixture,
  type MultiHopFixture,
  type ParagraphRecombineFixture,
} from '../../helpers/evolution-test-data-factory';

adminTest.describe('Variant Diff vs Parent Tab', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let multi: MultiHopFixture;
  let para: ParagraphRecombineFixture;
  let legacyPara: ParagraphRecombineFixture;

  adminTest.beforeAll(async () => {
    multi = await createMultiHopFixture();
    para = await createParagraphRecombineFixture({ slotCount: 2, rewritesPerSlot: 2 });
    legacyPara = await createParagraphRecombineFixture({ slotCount: 1, rewritesPerSlot: 1, legacyEmptyLineage: true });
  });

  adminTest.afterAll(async () => {
    if (multi) await multi.cleanup();
    if (para) await para.cleanup();
    if (legacyPara) await legacyPara.cleanup();
  });

  adminTest('article variant → side-by-side diff vs parent (Parent left / Variant right)', async ({ adminPage }) => {
    const leafId = multi.variantIds[multi.variantIds.length - 1]!;
    await adminPage.goto(`/admin/evolution/variants/${leafId}?tab=diff`);
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('[data-testid="sxs-diff"]')).toBeVisible({ timeout: 20000 });
    await expect(adminPage.locator('[data-testid="sxs-parent"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="sxs-variant"]')).toBeVisible();
  });

  adminTest('paragraph rewrite → isolated paragraph diff + "Paragraph N" header', async ({ adminPage }) => {
    const rewriteId = para.slotVariantIds[0]!;
    await adminPage.goto(`/admin/evolution/variants/${rewriteId}?tab=diff`);
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('[data-testid="sxs-diff"]')).toBeVisible({ timeout: 20000 });
    await expect(adminPage.locator('[data-testid="variant-parent-diff-slot"]')).toContainText('Paragraph');
  });

  adminTest('legacy paragraph rewrite (empty lineage) → diff still renders via prompt_id fallback', async ({ adminPage }) => {
    const rewriteId = legacyPara.slotVariantIds[0]!;
    await adminPage.goto(`/admin/evolution/variants/${rewriteId}?tab=diff`);
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('[data-testid="sxs-diff"]')).toBeVisible({ timeout: 20000 });
  });

  adminTest('original-slot paragraph → "Original paragraph" empty state, no diff', async ({ adminPage }) => {
    const originalId = para.originalSlotVariantIds[0]!;
    await adminPage.goto(`/admin/evolution/variants/${originalId}?tab=diff`);
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('[data-testid="variant-parent-diff-empty"]'))
      .toContainText('Original paragraph', { timeout: 20000 });
    await expect(adminPage.locator('[data-testid="sxs-diff"]')).toHaveCount(0);
  });

  adminTest('seed article (parentless) → "Seed · no parent" empty state', async ({ adminPage }) => {
    const seedId = multi.variantIds[0]!;
    await adminPage.goto(`/admin/evolution/variants/${seedId}?tab=diff`);
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('[data-testid="variant-parent-diff-empty"]'))
      .toContainText('Seed', { timeout: 20000 });
  });
});
