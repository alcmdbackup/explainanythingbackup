/**
 * Debug test for publish bug after streaming
 *
 * Reproduces: Generate new article via streaming -> click Publish -> bug
 */
import { test, expect } from '../fixtures/auth';
import { SearchPage } from '../helpers/pages/SearchPage';
import { ResultsPage } from '../helpers/pages/ResultsPage';

test.describe('Publish Bug After Streaming', () => {
  test.setTimeout(120000);

  test('should publish draft article after streaming completes', async ({ authenticatedPage }) => {
    const searchPage = new SearchPage(authenticatedPage);
    const resultsPage = new ResultsPage(authenticatedPage);

    // Generate a new explanation
    await searchPage.navigate();

    const uniqueQuery = `publish bug test ${Date.now()}`;
    console.log('Searching for:', uniqueQuery);
    await searchPage.search(uniqueQuery);

    // Wait for navigation to results
    await authenticatedPage.waitForURL(/\/results/, { timeout: 30000 });
    console.log('Navigated to results page');

    // Wait for streaming to start
    await resultsPage.waitForStreamingStart(30000);
    console.log('Streaming started');

    // Wait for streaming to complete
    await resultsPage.waitForStreamingComplete(90000);
    console.log('Streaming completed');

    // Wait for URL to have explanation_id (page redirects after streaming)
    await authenticatedPage.waitForURL(/explanation_id=/, { timeout: 30000 });
    console.log('Page redirected with explanation_id');

    // Wait for content to load after redirect
    await resultsPage.waitForAnyContent(30000);
    console.log('Content loaded');

    // Check if publish button is visible
    const isPublishVisible = await resultsPage.isPublishButtonVisible();
    console.log('Publish button visible:', isPublishVisible);

    if (isPublishVisible) {
      // Check if it's enabled
      const isPublishEnabled = await resultsPage.isPublishButtonEnabled();
      console.log('Publish button enabled:', isPublishEnabled);

      // Try to click publish
      console.log('Clicking publish button...');

      // Listen for console errors
      authenticatedPage.on('console', msg => {
        if (msg.type() === 'error') {
          console.log('Console error:', msg.text());
        }
      });

      // Listen for page errors
      authenticatedPage.on('pageerror', error => {
        console.log('Page error:', error.message);
      });

      await resultsPage.clickPublishButton();

      // Wait for either success (URL change) or error
      try {
        await Promise.race([
          authenticatedPage.waitForURL(/explanation_id=/, { timeout: 15000 }),
          authenticatedPage.locator('[data-testid="error-message"]').waitFor({ state: 'visible', timeout: 15000 }),
        ]);
      } catch (e) {
        console.log('Timeout waiting for response after publish');
      }

      // Check for error
      const hasError = await authenticatedPage.locator('[data-testid="error-message"]').isVisible();
      if (hasError) {
        const errorText = await authenticatedPage.locator('[data-testid="error-message"]').textContent();
        console.log('ERROR:', errorText);
        expect.fail(`Publish failed with error: ${errorText}`);
      }

      console.log('Publish succeeded');
    } else {
      console.log('Publish button not visible - article may not be a draft');
    }
  });
});
