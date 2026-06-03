// E2E: the run-detail Variants tab hides paragraph_recombine slot rewrites (variant_kind='paragraph')
// by default, and the Kind dropdown reveals them on demand. Also spot-checks the Lineage tab is
// article-only. hide_paragraphs_from_run_variants_tab_evolution_20260603.
//
// Seeds DB rows directly via createParagraphRecombineFixture (no pipeline/LLM needed) — it seeds an
// article parent + paragraph rewrites with run_id + variant_kind='paragraph' and full cleanup.
// Navigate by fixture.runId (NOT invocationId). Tag @evolution (production-only E2E job).

import { adminTest, expect } from '../../fixtures/admin-auth';
import {
  createParagraphRecombineFixture,
  type ParagraphRecombineFixture,
} from '../../helpers/evolution-test-data-factory';

adminTest.describe('Evolution run Variants tab — Kind filter (article-only default)', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let fixture: ParagraphRecombineFixture;
  // 6-char prefix matches VariantsTab's `persisted-${id.substring(0,6)}` row testid.
  let paraCellTestId: string;

  adminTest.beforeAll(async () => {
    fixture = await createParagraphRecombineFixture({ slotCount: 2, rewritesPerSlot: 2 });
    paraCellTestId = `persisted-${fixture.slotVariantIds[0]!.substring(0, 6)}`;
  });

  adminTest.afterAll(async () => {
    await fixture.cleanup();
  });

  adminTest('hides paragraph rewrites by default; Kind=Both reveals them', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${fixture.runId}`);

    // Open the Variants tab and wait for hydration proof (the filter bar's Kind <select>).
    await adminPage.getByTestId('tab-variants').click();
    const kindFilter = adminPage.getByTestId('variant-kind-filter');
    await expect(kindFilter).toBeVisible({ timeout: 30000 });
    await expect(adminPage.getByTestId('variants-tab')).toBeVisible();

    // Default is article-only → the paragraph rewrite row is absent.
    await expect(kindFilter).toHaveValue('article');
    await expect(adminPage.getByTestId(paraCellTestId)).toHaveCount(0);

    // Switching the Kind filter to "Both" opts paragraph snippets back in.
    await kindFilter.selectOption('any');
    await expect(adminPage.getByTestId(paraCellTestId)).toBeVisible({ timeout: 15000 });

    // Back to "Articles only" hides it again.
    await kindFilter.selectOption('article');
    await expect(adminPage.getByTestId(paraCellTestId)).toHaveCount(0);
  });

  adminTest('Lineage graph is article-only (no paragraph rewrite nodes)', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${fixture.runId}`);
    await adminPage.getByTestId('tab-lineage').click();

    const lineage = adminPage.getByTestId('lineage-tab');
    const empty = adminPage.getByTestId('lineage-tab-empty');
    // Either the graph renders (article nodes) or an empty state; in neither case should the
    // paragraph rewrite's 8-char short id appear as a node label.
    await expect(lineage.or(empty)).toBeVisible({ timeout: 30000 });
    const paraShortId = fixture.slotVariantIds[0]!.substring(0, 8);
    await expect(adminPage.getByText(paraShortId, { exact: false })).toHaveCount(0);
  });
});
