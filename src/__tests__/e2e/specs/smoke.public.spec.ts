// Public-host smoke tests (explainanything.vercel.app) — runs post-deploy via post-deploy-smoke.yml @smoke-public matrix row.
// Verifies the public site's home + library routes load and the health endpoint is healthy.

import { test, expect } from '../fixtures/auth';

test.describe('Public Smoke Tests', () => {
  test(
    'home page loads and has search bar',
    { tag: ['@smoke', '@smoke-public'] },
    async ({ authenticatedPage: page }) => {
      await page.goto('/');

      await expect(page).toHaveTitle(/ExplainAnything/i);

      const searchInput = page.locator('[data-testid="home-search-input"]');
      await expect(searchInput).toBeVisible({ timeout: 10000 });

      const searchButton = page.locator('[data-testid="home-search-submit"]');
      await expect(searchButton).toBeVisible({ timeout: 10000 });
    },
  );

  test(
    'health check endpoint returns healthy',
    { tag: ['@smoke', '@smoke-public'] },
    async ({ authenticatedPage: page }) => {
      const response = await page.request.get('/api/health');

      expect(response.status()).toBe(200);

      const data = await response.json();
      expect(data.status).toBe('healthy');
      expect(data.checks.database.status).toBe('pass');
      expect(data.checks.requiredTags.status).toBe('pass');
      expect(data.checks.environment.status).toBe('pass');
    },
  );

  test(
    'user library loads',
    { tag: ['@smoke', '@smoke-public'] },
    async ({ authenticatedPage: page }) => {
      await page.goto('/userlibrary');

      // Supabase queries can take 15-30s on cold start
      await expect(page.locator('h1:has-text("My Library")')).toBeVisible({ timeout: 30000 });
    },
  );
});
