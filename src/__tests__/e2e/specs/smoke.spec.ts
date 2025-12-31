import { test, expect } from '../fixtures/auth';

/**
 * Smoke Tests
 *
 * These tests are designed to run against production after deployment.
 * They verify critical functionality and required data exists.
 * Tag with @smoke to include in post-deployment smoke test runs.
 */
test.describe('Smoke Tests', () => {
  test('home page loads and has search bar', { tag: ['@critical', '@smoke'] }, async ({ authenticatedPage: page }) => {
    await page.goto('/');

    // Verify page loads
    await expect(page).toHaveTitle(/ExplainAnything/i);

    // Verify search bar is present
    const searchInput = page.locator('[data-testid="search-input"]');
    await expect(searchInput).toBeVisible();

    const searchButton = page.locator('[data-testid="search-submit"]');
    await expect(searchButton).toBeVisible();
  });

  test('health check endpoint returns healthy', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    // This test validates that all required data and connections are working
    const response = await page.request.get('/api/health');

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.checks.database.status).toBe('pass');
    expect(data.checks.requiredTags.status).toBe('pass');
    expect(data.checks.environment.status).toBe('pass');
  });

  test('user library loads', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await page.goto('/userlibrary');

    // Should show library page (with or without explanations)
    await expect(page.locator('text=Saved')).toBeVisible({ timeout: 10000 });
  });
});
