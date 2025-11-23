/**
 * Phase 6: Regeneration E2E Tests
 *
 * Tests for the Rewrite/Regeneration functionality on the results page.
 */
import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import { UserLibraryPage } from '../../helpers/pages/UserLibraryPage';

test.describe('Regeneration Flow', () => {
  test.describe('Rewrite Button', () => {
    test('should show rewrite button after content loads', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Navigate to library to get an existing explanation
      await libraryPage.navigate();

      // Wait for table to load and check if there are rows
      const hasRows = await libraryPage.waitForTableToLoad(30000);
      if (!hasRows) {
        test.skip();
        return;
      }

      // Click first row to view explanation
      await libraryPage.clickViewOnRow(0);

      // Wait for navigation to results page
      await page.waitForURL(/\/results/, { timeout: 15000 });

      // Wait for content to load on results page
      await resultsPage.waitForAnyContent(30000);

      // Wait for loading to complete (rewrite button only shows when not loading)
      await page.waitForTimeout(1000);

      // Verify rewrite button is visible
      const isVisible = await resultsPage.isRewriteButtonVisible();
      expect(isVisible).toBe(true);
    });

    test('should open dropdown and show rewrite options', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Get existing explanation from library
      await libraryPage.navigate();
      const hasRows = await libraryPage.waitForTableToLoad(30000);
      if (!hasRows) {
        test.skip();
        return;
      }

      await libraryPage.clickViewOnRow(0);

      // Wait for navigation to results page
      await page.waitForURL(/\/results/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(30000);
      await page.waitForTimeout(1000);

      // Open dropdown
      await resultsPage.openRewriteDropdown();

      // Verify dropdown options are visible
      const isDropdownVisible = await resultsPage.isRewriteDropdownVisible();
      expect(isDropdownVisible).toBe(true);
    });

    test('should show content with title after loading from library', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Get existing explanation from library
      await libraryPage.navigate();
      const hasRows = await libraryPage.waitForTableToLoad(30000);
      if (!hasRows) {
        test.skip();
        return;
      }

      await libraryPage.clickViewOnRow(0);

      // Wait for navigation to results page
      await page.waitForURL(/\/results/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(30000);
      await page.waitForTimeout(1000);

      // Verify content is displayed with a title
      const title = await resultsPage.getTitle();
      expect(title).toBeTruthy();

      const hasContent = await resultsPage.hasContent();
      expect(hasContent).toBe(true);
    });

    test('should have functional rewrite button after content loads', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Get existing explanation from library
      await libraryPage.navigate();
      const hasRows = await libraryPage.waitForTableToLoad(30000);
      if (!hasRows) {
        test.skip();
        return;
      }

      await libraryPage.clickViewOnRow(0);

      // Wait for navigation to results page
      await page.waitForURL(/\/results/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(30000);
      await page.waitForTimeout(1000);

      // Verify rewrite button is visible and enabled
      const isVisible = await resultsPage.isRewriteButtonVisible();
      expect(isVisible).toBe(true);

      const isEnabled = await resultsPage.isRewriteButtonEnabled();
      expect(isEnabled).toBe(true);
    });
  });
});
