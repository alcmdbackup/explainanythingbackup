/**
 * Phase 6: Regeneration E2E Tests
 *
 * Tests for the Rewrite/Regeneration functionality on the results page.
 * Uses test-data-factory for isolated, reliable test data.
 */
import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  createTestExplanationInLibrary,
  type TestExplanation,
} from '../../helpers/test-data-factory';

test.describe('Regeneration Flow', () => {
  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    // Create isolated test data for this test file
    testExplanation = await createTestExplanationInLibrary({
      title: 'Regeneration Test',
      content: '<h1>Regeneration Content</h1><p>This is test content for regeneration tests.</p>',
      status: 'published',
    });
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  test.describe('Rewrite Button', () => {
    test('should show rewrite button after content loads', { tag: '@critical' }, async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // Navigate directly to test explanation
      await page.goto(`/results?explanation_id=${testExplanation.id}`);

      // Wait for content to load on results page
      await resultsPage.waitForAnyContent(30000);

      // Wait for rewrite button to appear (shows when loading is complete)
      await page.locator('[data-testid="rewrite-button"]').waitFor({ state: 'visible', timeout: 10000 });

      // Verify rewrite button is visible
      const isVisible = await resultsPage.isRewriteButtonVisible();
      expect(isVisible).toBe(true);
    });

    // Skip: The "Rewrite with tags" UI button (data-testid="rewrite-with-tags") is not
    // currently present in the results page dropdown. Re-enable when feature is implemented.
    // eslint-disable-next-line flakiness/no-test-skip -- Feature not implemented
    test.skip('should open dropdown and show rewrite options', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // Navigate directly to test explanation
      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(30000);
      await page.locator('[data-testid="rewrite-button"]').waitFor({ state: 'visible', timeout: 10000 });

      // Open dropdown
      await resultsPage.openRewriteDropdown();

      // Verify dropdown options are visible
      const isDropdownVisible = await resultsPage.isRewriteDropdownVisible();
      expect(isDropdownVisible).toBe(true);
    });

    test('should show content with title after loading from library', { tag: '@critical' }, async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // Navigate directly to test explanation
      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(30000);
      await page.locator('[data-testid="rewrite-button"]').waitFor({ state: 'visible', timeout: 10000 });

      // Verify content is displayed with a title
      const title = await resultsPage.getTitle();
      expect(title).toBeTruthy();

      const hasContent = await resultsPage.hasContent();
      expect(hasContent).toBe(true);
    });

    test('should have functional rewrite button after content loads', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // Navigate directly to test explanation
      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(30000);
      await page.locator('[data-testid="rewrite-button"]').waitFor({ state: 'visible', timeout: 10000 });

      // Verify rewrite button is visible and enabled
      const isVisible = await resultsPage.isRewriteButtonVisible();
      expect(isVisible).toBe(true);

      const isEnabled = await resultsPage.isRewriteButtonEnabled();
      expect(isEnabled).toBe(true);
    });
  });
});
