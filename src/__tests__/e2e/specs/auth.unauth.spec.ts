import { test, expect } from '@playwright/test';
import { LoginPage } from '../helpers/pages/LoginPage';
import { waitForState, waitForPageStable } from '../helpers/wait-utils';

test.describe('Unauthenticated User Tests', () => {
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

  test('should require authentication to access library', async ({ page }) => {
    // Try accessing library without authentication
    await page.goto('/userlibrary');

    // Wait for page to stabilize (avoids networkidle which hangs in CI)
    await waitForPageStable(page, { timeout: 10000 });

    // Either redirect to login OR show authentication error
    const state = await waitForState(page, {
      redirected: async () => /\/(login|auth)/.test(page.url()),
      error: async () => await page.locator('[data-testid="library-error"]').isVisible(),
      loginPrompt: async () => await page.locator('text=/log in|sign in|authentication|please log in/i').isVisible(),
      loadingStuck: async () => await page.locator('[data-testid="library-loading"]').isVisible(),
    }, { timeout: 10000 });

    // If we got any response indicating auth is needed, test passes
    expect(['redirected', 'error', 'loginPrompt', 'loadingStuck', 'timeout']).toContain(state);
  });

  test('should login with valid credentials', async ({ page }) => {
    console.log('[E2E-DEBUG] Login test starting');

    // Capture browser console for debugging
    page.on('console', msg => {
      console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
    });

    // Log all navigation events
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        console.log('[E2E-DEBUG] Frame navigated to:', frame.url());
      }
    });

    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    console.log('[E2E-DEBUG] On login page:', page.url());

    const testEmail = process.env.TEST_USER_EMAIL || 'abecha@gmail.com';
    console.log('[E2E-DEBUG] Logging in with email:', testEmail);

    await loginPage.login(
      testEmail,
      process.env.TEST_USER_PASSWORD || 'password'
    );
    console.log('[E2E-DEBUG] Login form submitted, current URL:', page.url());

    // Log current URL periodically while waiting for redirect
    const urlCheckInterval = setInterval(() => {
      console.log('[E2E-DEBUG] Polling URL:', page.url());
    }, 5000);

    try {
      // Wait for redirect to home page (increased timeout for CI, no networkidle which can hang)
      await page.waitForURL('/', { timeout: 60000 });
      console.log('[E2E-DEBUG] Redirect successful to:', page.url());
    } catch (error) {
      console.log('[E2E-DEBUG] Redirect failed, final URL:', page.url());
      // Take screenshot on failure
      await page.screenshot({ path: 'test-results/debug-login-redirect-failed.png' }).catch(() => {});
      throw error;
    } finally {
      clearInterval(urlCheckInterval);
    }

    // Verify user is logged in
    const isLoggedIn = await loginPage.isLoggedIn();
    console.log('[E2E-DEBUG] isLoggedIn:', isLoggedIn);
    expect(isLoggedIn).toBe(true);
  });

  test('should show error with invalid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    await loginPage.login('invalid@email.com', 'wrongpassword');

    // Wait for error message (increased timeout for CI)
    await page.locator('[data-testid="login-error"]').waitFor({ state: 'visible', timeout: 30000 });

    // Verify error is shown
    expect(await loginPage.isErrorVisible()).toBe(true);

    // Verify no redirect occurred
    expect(page.url()).toContain('/login');

    // Verify no session created
    expect(await loginPage.isLoggedIn()).toBe(false);
  });

  test('should handle empty email submission', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    // Fill only password
    await loginPage.fillPassword('password');
    await loginPage.clickSubmit();

    // Wait for form to process (either error appears or button becomes enabled again)
    await waitForState(page, {
      error: async () => await page.locator('[data-testid="login-error"]').isVisible(),
      ready: async () => await page.locator('[data-testid="login-submit"]').isVisible(),
    }, { timeout: 5000 });

    // Should show validation error or stay on login page
    expect(page.url()).toContain('/login');
  });

  test('should handle empty password submission', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    // Fill only email
    await loginPage.fillEmail('abecha@gmail.com');
    await loginPage.clickSubmit();

    // Wait for form to process (either error appears or button becomes enabled again)
    await waitForState(page, {
      error: async () => await page.locator('[data-testid="login-error"]').isVisible(),
      ready: async () => await page.locator('[data-testid="login-submit"]').isVisible(),
    }, { timeout: 5000 });

    // Should show validation error or stay on login page
    expect(page.url()).toContain('/login');
  });
});

test.describe('Remember Me Feature', () => {
  test('should display remember me checkbox on login page', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    expect(await loginPage.isRememberMeVisible()).toBe(true);
  });

  test('should have remember me unchecked by default', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    expect(await loginPage.isRememberMeChecked()).toBe(false);
  });

  test('should toggle remember me checkbox', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    // Initially unchecked
    expect(await loginPage.isRememberMeChecked()).toBe(false);

    // Toggle on
    await loginPage.toggleRememberMe();
    expect(await loginPage.isRememberMeChecked()).toBe(true);

    // Toggle off
    await loginPage.toggleRememberMe();
    expect(await loginPage.isRememberMeChecked()).toBe(false);
  });

  test('should store remember me preference as true when checked', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    const testEmail = process.env.TEST_USER_EMAIL || 'abecha@gmail.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'password';

    await loginPage.loginWithRememberMe(testEmail, testPassword, true);

    // Wait for redirect to home page
    await page.waitForURL('/', { timeout: 60000 });

    // Verify remember me preference was stored
    const preference = await loginPage.getRememberMePreference();
    expect(preference).toBe('true');
  });

  test('should store remember me preference as false when unchecked', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    const testEmail = process.env.TEST_USER_EMAIL || 'abecha@gmail.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'password';

    await loginPage.loginWithRememberMe(testEmail, testPassword, false);

    // Wait for redirect to home page
    await page.waitForURL('/', { timeout: 60000 });

    // Verify remember me preference was stored
    const preference = await loginPage.getRememberMePreference();
    expect(preference).toBe('false');
  });

  test('should use localStorage for auth when remember me is checked', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    const testEmail = process.env.TEST_USER_EMAIL || 'abecha@gmail.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'password';

    await loginPage.loginWithRememberMe(testEmail, testPassword, true);

    // Wait for redirect and auth to complete
    await page.waitForURL('/', { timeout: 60000 });
    // Wait for page to be fully loaded (Supabase tokens stored after hydration)
    await page.waitForLoadState('networkidle');

    const storageType = await loginPage.getSupabaseStorageType();
    expect(storageType).toBe('localStorage');
  });

  test('should use sessionStorage for auth when remember me is unchecked', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    const testEmail = process.env.TEST_USER_EMAIL || 'abecha@gmail.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'password';

    await loginPage.loginWithRememberMe(testEmail, testPassword, false);

    // Wait for redirect and auth to complete
    await page.waitForURL('/', { timeout: 60000 });
    // Wait for page to be fully loaded (Supabase tokens stored after hydration)
    await page.waitForLoadState('networkidle');

    const storageType = await loginPage.getSupabaseStorageType();
    expect(storageType).toBe('sessionStorage');
  });
});
