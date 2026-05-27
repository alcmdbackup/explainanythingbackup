// Public-host smoke tests (explainanything.vercel.app) — runs post-deploy via post-deploy-smoke.yml @smoke-public matrix row.
// Verifies the public site's home + library routes load and the health endpoint is healthy.

import { test, expect } from '../fixtures/auth';
import { test as unauthTest } from '@playwright/test';

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

// Catches the prod GUEST_PASSWORD out-of-sync failure mode: middleware fails
// signInWithPassword → redirects to /login → visitor lands on the login form
// instead of being silently signed in as guest. The URL assertion below catches
// this within ~2 min via Slack (runs in both post-deploy smoke @smoke-public grep
// and nightly chromium/firefox testMatch on this file).
unauthTest.describe('Public Smoke Tests — guest auto-login', () => {
  unauthTest.use({ storageState: { cookies: [], origins: [] } });

  unauthTest(
    'unauthenticated visitor lands signed-in (guest auto-login works)',
    { tag: ['@smoke', '@smoke-public'] },
    async ({ page }) => {
      await page.goto('/');

      await expect(page).not.toHaveURL(/\/login/);

      // Hydration proof (testing_overview.md Rule 18) — also confirms we landed
      // on the home surface, not stuck on an auth-error or transitional page.
      await expect(page.locator('[data-testid="home-search-input"]')).toBeVisible({
        timeout: 15000,
      });
    },
  );
});
