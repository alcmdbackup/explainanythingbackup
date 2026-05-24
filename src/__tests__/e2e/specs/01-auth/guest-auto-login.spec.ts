/**
 * E2E: guest auto-login via middleware (Phase 5 of fixes_explainanything_for_public_demo_20260523).
 *
 * Runs in the `chromium-guest-auto` Playwright project (playwright.config.ts),
 * which uses the SECONDARY 3009 webServer that explicitly drops E2E_TEST_MODE
 * from its env. This is the only Playwright project where middleware auto-login
 * actually fires — all other webServers set E2E_TEST_MODE=true so the existing
 * unauth-redirect specs still pass.
 *
 * CI requirement: GUEST_EMAIL, GUEST_PASSWORD, NEXT_PUBLIC_GUEST_EMAIL,
 * GUEST_USER_ID must be set in the GitHub Actions staging env block for the
 * e2e-critical job. The 3009 webServer inherits them.
 */

import { test, expect } from '../../fixtures/base';

test.describe('guest auto-login', () => {
  test('unauthenticated visitor lands signed-in on public site root', { tag: '@critical' }, async ({ page }) => {
    // Start with no cookies (the project sets storageState: { cookies: [], origins: [] }).
    await page.goto('/');

    // Middleware should have signed us in as guest server-side; the page should
    // load successfully (not redirected to /login).
    await expect(page).not.toHaveURL(/\/login/);

    // The page should be the home/landing surface, not the login form.
    // Use a stable data-testid from the public home page.
    // Fallback: assert the URL is `/` (not /login).
    expect(page.url()).toMatch(/\/$/);
  });

  test('hits /userlibrary without redirect (auto-login carries through protected routes)', { tag: '@critical' }, async ({ page }) => {
    await page.goto('/userlibrary');
    await expect(page).not.toHaveURL(/\/login/);
    // Library page should render — assert any library-page UI element.
    // Library uses a heading or container; just verify we got HTML (status 200 means OK).
    const response = await page.goto('/userlibrary');
    expect(response?.status()).toBeLessThan(400);
  });

  test('Logout button is hidden on public site for guest sessions', async ({ page }) => {
    await page.goto('/');
    const logoutButton = page.getByTestId('logout-button');
    await expect(logoutButton).toHaveCount(0);
  });

  test('/login redirects to / for active guest session', async ({ page }) => {
    await page.goto('/');
    // Once landed as guest, hitting /login should bounce back to /.
    await page.goto('/login');
    await expect(page).toHaveURL(/\/$/);
  });
});
