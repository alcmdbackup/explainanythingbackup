/**
 * Debug test for publish bug after streaming
 *
 * Reproduces: Generate new article via streaming -> click Publish -> bug
 */
import { test } from '../fixtures/auth';
import { SearchPage } from '../helpers/pages/SearchPage';
import { ResultsPage } from '../helpers/pages/ResultsPage';
import { TEST_CONTENT_PREFIX, trackExplanationForCleanup } from '../helpers/test-data-factory';

test.describe('Publish Bug After Streaming', () => {
  // Extended timeout needed: streaming generation alone can take up to 90s in real scenarios.
  // This is a debug/investigation test that intentionally tests real streaming behavior
  // without mocking, so the timeout must exceed streaming duration.
  // See docs/docs_overall/testing_rules.md for timeout guidelines.
  // eslint-disable-next-line flakiness/max-test-timeout
  test.setTimeout(120000);

  test('should publish draft article after streaming completes', async ({ authenticatedPage }) => {
    const searchPage = new SearchPage(authenticatedPage);
    const resultsPage = new ResultsPage(authenticatedPage);

    // Generate a new explanation
    await searchPage.navigate();

    // Use [TEST] prefix for easier detection and cleanup
    const uniqueQuery = `${TEST_CONTENT_PREFIX} publish bug test ${Date.now()}`;
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

    // Track explanation for cleanup (defense-in-depth)
    const url = new URL(authenticatedPage.url());
    const explanationId = url.searchParams.get('explanation_id');
    if (explanationId) {
      trackExplanationForCleanup(explanationId);
      console.log('Tracked explanation for cleanup:', explanationId);
    }

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
      } catch {
        console.log('Timeout waiting for response after publish');
      }

      // Check for error
      const hasError = await authenticatedPage.locator('[data-testid="error-message"]').isVisible();
      if (hasError) {
        const errorText = await authenticatedPage.locator('[data-testid="error-message"]').textContent();
        console.log('ERROR:', errorText);
        throw new Error(`Publish failed with error: ${errorText}`);
      }

      console.log('Publish succeeded');
    } else {
      console.log('Publish button not visible - article may not be a draft');
    }
  });
});
