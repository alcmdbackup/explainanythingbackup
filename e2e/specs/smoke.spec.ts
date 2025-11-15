import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('home page loads and has search bar', async ({ page }) => {
    await page.goto('/');

    // Verify page loads
    await expect(page).toHaveTitle(/ExplainAnything/i);

    // Verify search bar is present
    const searchInput = page.locator('[data-testid="search-input"]');
    await expect(searchInput).toBeVisible();

    const searchButton = page.locator('[data-testid="search-submit"]');
    await expect(searchButton).toBeVisible();
  });

  test('login page loads', async ({ page }) => {
    await page.goto('/login');

    // Verify email input is present
    const emailInput = page.locator('[data-testid="login-email"]');
    await expect(emailInput).toBeVisible();

    // Verify password input is present
    const passwordInput = page.locator('[data-testid="login-password"]');
    await expect(passwordInput).toBeVisible();

    // Verify submit button is present
    const submitButton = page.locator('[data-testid="login-submit"]');
    await expect(submitButton).toBeVisible();
  });

  test('unauthenticated user redirected from protected route', async ({ page }) => {
    // Navigate to protected route without auth
    await page.goto('/userlibrary');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });
});
