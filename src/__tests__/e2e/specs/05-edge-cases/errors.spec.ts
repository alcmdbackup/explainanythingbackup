/**
 * Phase 6: Error Handling E2E Tests
 *
 * Tests error scenarios and edge cases for the results page.
 * Note: The app handles errors via SSE stream 'error' events, not HTTP status codes.
 */
import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  mockReturnExplanationAPIError,
  mockReturnExplanationStreamError,
  mockReturnExplanationAPI,
  defaultMockExplanation,
} from '../../helpers/api-mocks';
import { waitForState, waitForRouteReady } from '../../helpers/wait-utils';

test.describe('Error Handling', () => {
  test.describe('API Errors', () => {
    test('should not display content when API returns 500', { tag: '@critical' }, async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // Mock API to return 500 error
      await mockReturnExplanationAPIError(page, 'Internal server error');

      // Navigate to results with a query
      await resultsPage.navigate('test query');

      // Wait for either error or content to appear (or neither)
      const state = await waitForState(page, {
        error: async () => await page.locator('[data-testid="error-message"]').isVisible(),
        content: async () => await resultsPage.hasContent(),
      });

      // Verify no content is displayed (app doesn't show error banner for HTTP errors)
      const hasContent = state === 'content';
      expect(hasContent).toBe(false);
    });

    test('should display error message for stream errors', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // --- E2E DEBUG LOGGING START ---
      console.log('[E2E-DEBUG] Test starting: stream error test');

      // Capture ALL browser console messages for debugging
      page.on('console', msg => {
        console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
      });

      // Log network requests to returnExplanation API
      page.on('request', req => {
        if (req.url().includes('returnExplanation')) {
          console.log('[E2E-DEBUG] Request to returnExplanation:', req.method(), req.url());
        }
      });

      page.on('response', res => {
        if (res.url().includes('returnExplanation')) {
          console.log('[E2E-DEBUG] Response from returnExplanation:', res.status(), res.headers()['content-type']);
        }
      });
      // --- E2E DEBUG LOGGING END ---

      // Mock API to return error during streaming (proper SSE error event)
      // Set up mock BEFORE any navigation
      await mockReturnExplanationStreamError(page, 'Stream interrupted');
      console.log('[E2E-DEBUG] Mock registered for stream error');

      // Ensure route is fully registered before navigation
      await waitForRouteReady(page);

      await resultsPage.navigate('test query');
      console.log('[E2E-DEBUG] Navigated to results page, URL:', page.url());

      // Take screenshot before waiting for error (for CI debugging)
      await page.screenshot({ path: 'test-results/debug-stream-error-before-wait.png' }).catch(() => {});

      // Wait for error to appear (increased timeout for CI)
      console.log('[E2E-DEBUG] Waiting for error element to appear...');
      await resultsPage.waitForError(30000);
      console.log('[E2E-DEBUG] Error element appeared');

      // Verify error is displayed and contains expected message
      // Use toPass for resilience against timing issues (HMR, state resets)
      await expect(async () => {
        const isErrorVisible = await resultsPage.isErrorVisible();
        console.log('[E2E-DEBUG] isErrorVisible:', isErrorVisible);
        expect(isErrorVisible).toBe(true);

        const errorMessage = await resultsPage.getErrorMessage();
        console.log('[E2E-DEBUG] errorMessage:', errorMessage);
        expect(errorMessage).not.toBeNull();
        expect(errorMessage).toContain('Stream interrupted');
      }).toPass({ timeout: 5000 });
    });
  });

  test.describe('Invalid URL Parameters', () => {
    test('should handle invalid explanation_id in URL gracefully', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // Navigate with an invalid explanation_id
      await page.goto('/results?explanation_id=invalid-uuid-12345');

      // Wait for error or content to appear
      const state = await waitForState(page, {
        error: async () => await page.locator('[data-testid="error-message"]').isVisible(),
        content: async () => await resultsPage.hasContent(),
      });

      // Page should either show error or empty state (not crash)
      const hasError = state === 'error';
      const hasContent = state === 'content';

      // Either error is shown or no content - but page shouldn't crash
      expect(hasError || !hasContent).toBe(true);
    });

    test('should handle missing query parameter', async ({ authenticatedPage: page }) => {
      // Navigate without query or explanation_id
      await page.goto('/results');

      // Wait for page to be loaded
      await page.waitForLoadState('domcontentloaded');

      // Page should not crash - verify we're still on results page
      const url = page.url();
      expect(url).toContain('/results');
    });
  });

  test.describe('Error Recovery', () => {
    test('should recover from error state on new query', { tag: '@critical' }, async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // First, trigger a stream error
      await mockReturnExplanationStreamError(page, 'First request failed');

      // Ensure route is fully registered before navigation
      await waitForRouteReady(page);

      await resultsPage.navigate('failing query');
      await resultsPage.waitForError(30000);

      // Verify error is displayed
      expect(await resultsPage.isErrorVisible()).toBe(true);

      // Clear route and set up success mock
      await page.unrouteAll({ behavior: 'wait' });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      // Wait for input to become enabled (error state should re-enable it)
      await page.locator('[data-testid="search-input"]:not([disabled])').waitFor({ state: 'visible', timeout: 10000 });

      // Submit new query using the search bar (nav variant uses Enter key, no submit button)
      await page.fill('[data-testid="search-input"]', 'successful query');
      await page.locator('[data-testid="search-input"]').press('Enter');

      // Wait for content to load
      await resultsPage.waitForAnyContent(30000);

      // Verify error is gone and content is displayed
      const hasContent = await resultsPage.hasContent();
      expect(hasContent).toBe(true);
    });
  });
});
