// Phase 6 E2E: invocation detail page for generate_from_previous_article shows the
// parent context block + collapsed Raw-LLM section (joined from llmCallTracking) +
// link to the full lineage tab.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createMultiHopFixture, type MultiHopFixture } from '../../helpers/evolution-test-data-factory';

adminTest.describe('Invocation Detail — generate_from_previous_article', { tag: ['@evolution', '@critical'] }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let fixture: MultiHopFixture;

  adminTest.beforeAll(async () => {
    fixture = await createMultiHopFixture({ seedLlmCallTracking: true });
  });

  adminTest.afterAll(async () => {
    if (fixture) await fixture.cleanup();
  });

  adminTest('renders parent block, Raw-LLM section, and lineage link', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${fixture.leafInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Parent-context block visible.
    await expect(adminPage.locator('[data-testid="invocation-parent-block"]')).toBeVisible({ timeout: 20000 });

    // "View full lineage" link present.
    await expect(adminPage.locator('[data-testid="view-full-lineage-link"]')).toBeVisible();

    // Raw-LLM collapsed section present (details element).
    const rawSection = adminPage.locator('[data-testid="invocation-raw-llm-section"]');
    await expect(rawSection).toBeVisible();
  });
});
