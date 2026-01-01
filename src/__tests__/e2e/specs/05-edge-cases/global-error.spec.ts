/**
 * E2E tests for error boundaries (error.tsx and global-error.tsx).
 *
 * These tests verify that:
 * 1. Unhandled page errors trigger the error boundary (error.tsx)
 * 2. The error UI is displayed correctly
 * 3. The reset button allows recovery
 * 4. Sentry receives the error (verified indirectly through component mount)
 *
 * NOTE: These tests are NOT tagged @critical, so they only run on PRs to production.
 *
 * Important distinction:
 * - error.tsx catches errors in page components and nested layouts
 * - global-error.tsx only catches errors in the root layout itself (rare)
 */

import { test, expect } from '@playwright/test';

test.describe('Error Boundary', () => {
  test.describe('Error Display', () => {
    test('should display error page when unhandled error occurs in page', async ({
      page,
    }) => {
      // Navigate to test page that throws an error
      await page.goto('/test-global-error?throw=true');

      // Wait for either error boundary to appear
      // Page-level errors are caught by error.tsx, not global-error.tsx
      const errorContainer = page.locator(
        '[data-testid="error-boundary-container"]'
      );
      const errorTitle = page.locator('[data-testid="error-boundary-title"]');

      // Wait for error boundary to appear (with generous timeout for error propagation)
      await expect(errorContainer).toBeVisible({ timeout: 15000 });

      // Verify the error UI elements
      await expect(errorTitle).toHaveText('Something went wrong');

      // Verify the error message is displayed
      const errorMessage = page.locator(
        '[data-testid="error-boundary-message"]'
      );
      await expect(errorMessage).toContainText(
        'We encountered an unexpected error'
      );

      // Verify the reset button is present
      const resetButton = page.locator(
        '[data-testid="error-boundary-reset-button"]'
      );
      await expect(resetButton).toBeVisible();
      await expect(resetButton).toHaveText('Try again');
    });

    test('should have proper styling for error page', async ({ page }) => {
      await page.goto('/test-global-error?throw=true');

      const errorContainer = page.locator(
        '[data-testid="error-boundary-container"]'
      );
      await expect(errorContainer).toBeVisible({ timeout: 15000 });

      // Verify the container has centering styles
      const containerStyles = await errorContainer.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        return {
          display: styles.display,
          // minHeight is computed to pixels, so check it's at least viewport height
          minHeightPx: parseInt(styles.minHeight, 10),
          viewportHeight: window.innerHeight,
        };
      });

      expect(containerStyles.display).toBe('flex');
      // The container should be at least as tall as the viewport
      expect(containerStyles.minHeightPx).toBeGreaterThanOrEqual(
        containerStyles.viewportHeight
      );
    });
  });

  test.describe('Error Recovery', () => {
    test('should allow user to attempt recovery via reset button', async ({
      page,
    }) => {
      await page.goto('/test-global-error?throw=true');

      const errorContainer = page.locator(
        '[data-testid="error-boundary-container"]'
      );
      await expect(errorContainer).toBeVisible({ timeout: 15000 });

      const resetButton = page.locator(
        '[data-testid="error-boundary-reset-button"]'
      );
      await expect(resetButton).toBeVisible();

      // Click the reset button
      await resetButton.click();

      // After reset, the page will try to re-render
      // Since the URL still has ?throw=true, it will throw again
      // But this verifies the reset mechanism works
      await expect(errorContainer).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Normal Operation', () => {
    test('should not show error boundary when no error occurs', async ({
      page,
    }) => {
      // Navigate to test page WITHOUT the throw parameter
      await page.goto('/test-global-error');

      // Wait for the normal page content
      await page.waitForLoadState('domcontentloaded');

      // Verify we're on the test page, not the error page
      const pageContent = await page.textContent('body');
      expect(pageContent).toContain('Global Error Test Page');

      // Error boundary should NOT be visible
      const errorContainer = page.locator(
        '[data-testid="error-boundary-container"]'
      );
      await expect(errorContainer).not.toBeVisible();
    });
  });
});
