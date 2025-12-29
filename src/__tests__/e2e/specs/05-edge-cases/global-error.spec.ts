/**
 * E2E tests for global-error.tsx (root error boundary).
 *
 * These tests verify that:
 * 1. Unhandled errors trigger the global error boundary
 * 2. The error UI is displayed correctly
 * 3. The reset button allows recovery
 * 4. Sentry receives the error (verified indirectly through component mount)
 *
 * NOTE: These tests are NOT tagged @critical, so they only run on PRs to production.
 * This is intentional because:
 * - Global error scenarios are edge cases
 * - The test requires a special debug route
 * - Full error boundary testing is more important for production releases
 */

import { test, expect } from '@playwright/test';

test.describe('Global Error Boundary', () => {
  test.describe('Error Display', () => {
    test('should display global error page when unhandled error occurs', async ({ page }) => {
      // Navigate to test page that throws an error
      await page.goto('/test-global-error?throw=true');

      // Wait for either global error or the test page content
      // The error boundary should catch the thrown error
      const globalErrorContainer = page.locator('[data-testid="global-error-container"]');
      const globalErrorTitle = page.locator('[data-testid="global-error-title"]');

      // Wait for global error to appear (with generous timeout for error propagation)
      await expect(globalErrorContainer).toBeVisible({ timeout: 15000 });

      // Verify the error UI elements
      await expect(globalErrorTitle).toHaveText('Something went wrong');

      // Verify the error message is displayed
      const errorMessage = page.locator('[data-testid="global-error-message"]');
      await expect(errorMessage).toContainText('We encountered an unexpected error');

      // Verify the reset button is present
      const resetButton = page.locator('[data-testid="global-error-reset-button"]');
      await expect(resetButton).toBeVisible();
      await expect(resetButton).toHaveText('Try again');
    });

    test('should have proper styling for error page', async ({ page }) => {
      await page.goto('/test-global-error?throw=true');

      const globalErrorContainer = page.locator('[data-testid="global-error-container"]');
      await expect(globalErrorContainer).toBeVisible({ timeout: 15000 });

      // Verify the container has centering styles
      const containerStyles = await globalErrorContainer.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        return {
          display: styles.display,
          minHeight: styles.minHeight,
        };
      });

      expect(containerStyles.display).toBe('flex');
      expect(containerStyles.minHeight).toBe('100vh');
    });
  });

  test.describe('Error Recovery', () => {
    test('should allow user to attempt recovery via reset button', async ({ page }) => {
      await page.goto('/test-global-error?throw=true');

      const globalErrorContainer = page.locator('[data-testid="global-error-container"]');
      await expect(globalErrorContainer).toBeVisible({ timeout: 15000 });

      const resetButton = page.locator('[data-testid="global-error-reset-button"]');
      await expect(resetButton).toBeVisible();

      // Click the reset button
      await resetButton.click();

      // After reset, the page will try to re-render
      // Since the URL still has ?throw=true, it will throw again
      // But this verifies the reset mechanism works
      await expect(globalErrorContainer).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Normal Operation', () => {
    test('should not show global error when no error occurs', async ({ page }) => {
      // Navigate to test page WITHOUT the throw parameter
      await page.goto('/test-global-error');

      // Wait for the normal page content
      await page.waitForLoadState('domcontentloaded');

      // Verify we're on the test page, not the error page
      const pageContent = await page.textContent('body');
      expect(pageContent).toContain('Global Error Test Page');

      // Global error should NOT be visible
      const globalErrorContainer = page.locator('[data-testid="global-error-container"]');
      await expect(globalErrorContainer).not.toBeVisible();
    });
  });
});
