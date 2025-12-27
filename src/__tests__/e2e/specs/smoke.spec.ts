import { test, expect } from '../fixtures/auth';

test.describe('Smoke Tests', () => {
  test('home page loads and has search bar', { tag: '@critical' }, async ({ authenticatedPage: page }) => {
    await page.goto('/');

    // Verify page loads
    await expect(page).toHaveTitle(/ExplainAnything/i);

    // Verify search bar is present
    const searchInput = page.locator('[data-testid="search-input"]');
    await expect(searchInput).toBeVisible();

    const searchButton = page.locator('[data-testid="search-submit"]');
    await expect(searchButton).toBeVisible();
  });
});
