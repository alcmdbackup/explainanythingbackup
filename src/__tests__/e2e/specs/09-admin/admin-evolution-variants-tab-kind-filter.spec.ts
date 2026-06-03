// E2E: the variants list Kind filter (Articles only / Paragraph snippets / Both) correctly includes /
// excludes paragraph_recombine slot rewrites. hide_paragraphs_from_run_variants_tab_evolution_20260603.
//
// Drives the standalone /admin/evolution/variants list (a stable EntityListPage). The run-detail
// Variants tab + Lineage article-only behavior is covered end-to-end against the real DB by
// src/__tests__/integration/evolution-variants-tab-article-only.integration.test.ts; the run-detail
// tab's UI is intentionally NOT driven here (its server-action load is flaky under the prod-build
// full-suite harness, orthogonal to this feature).
//
// Rigorous invariant under test: filtering agentName='paragraph_rewrite' (an agent that only ever
// produces variant_kind='paragraph') means Kind='article' MUST return zero rows, while
// Kind='paragraph'/'any' returns rows. This holds regardless of pagination / other DB content.
//
// Seeds DB rows directly via createParagraphRecombineFixture (no pipeline/LLM). Tag @evolution.

import { adminTest, expect } from '../../fixtures/admin-auth';
import {
  createParagraphRecombineFixture,
  type ParagraphRecombineFixture,
} from '../../helpers/evolution-test-data-factory';

adminTest.describe('Evolution variants list — Kind filter (article-only default)', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let fixture: ParagraphRecombineFixture;

  adminTest.beforeAll(async () => {
    fixture = await createParagraphRecombineFixture({ slotCount: 2, rewritesPerSlot: 2 });
  });

  adminTest.afterAll(async () => {
    await fixture.cleanup();
  });

  adminTest('Kind=article excludes paragraph rewrites; Kind=paragraph/Both reveal them', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/variants');
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 30000 });

    // Show seeded [TEST_EVO] content so the fixture's paragraph rewrites are reachable.
    const hideTest = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not an assertion
    if (await hideTest.isChecked()) await hideTest.uncheck();

    // Narrow to the paragraph-only agent. paragraph_rewrite NEVER produces variant_kind='article'.
    const agentFilter = adminPage.locator('[data-testid="filter-agentName"]');
    await expect(agentFilter).toBeVisible();
    await agentFilter.fill('paragraph_rewrite');

    const kindFilter = adminPage.locator('[data-testid="filter-variantKind"]');
    await expect(kindFilter).toBeVisible();

    // Default Kind='article' → paragraph_rewrite + article is necessarily empty.
    await expect(kindFilter).toHaveValue('article');
    await expect(adminPage.locator('[data-testid="entity-list-table-empty"]')).toBeVisible({ timeout: 15000 });

    // Kind='paragraph' → the seeded paragraph rewrites appear.
    await kindFilter.selectOption('paragraph');
    await expect(adminPage.locator('[data-testid="entity-list-table"]')).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('[data-testid="entity-list-table"]').getByText('paragraph_rewrite').first()).toBeVisible({ timeout: 15000 });

    // Kind='any' (Both) → still includes paragraph rewrites.
    await kindFilter.selectOption('any');
    await expect(adminPage.locator('[data-testid="entity-list-table"]').getByText('paragraph_rewrite').first()).toBeVisible({ timeout: 15000 });

    // Back to Kind='article' → paragraph rewrites are hidden again (empty for this agent).
    await kindFilter.selectOption('article');
    await expect(adminPage.locator('[data-testid="entity-list-table-empty"]')).toBeVisible({ timeout: 15000 });
  });
});
