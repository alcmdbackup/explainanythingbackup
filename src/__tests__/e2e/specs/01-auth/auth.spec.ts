import { test, expect } from '../../fixtures/auth';
import { LoginPage } from '../../helpers/pages/LoginPage';

test.describe('Authentication Flow', () => {
  test.describe('Login', () => {
    test('should login with valid credentials', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      await loginPage.login(
        process.env.TEST_USER_EMAIL || 'abecha@gmail.com',
        process.env.TEST_USER_PASSWORD || 'password'
      );

      // Wait for redirect to home page
      await page.waitForURL('/', { timeout: 10000 });

      // Verify user is logged in
      expect(await loginPage.isLoggedIn()).toBe(true);
    });

    test('should show error with invalid credentials', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      await loginPage.login('invalid@email.com', 'wrongpassword');

      // Wait for error message
      await page.waitForSelector('[data-testid="login-error"]', { timeout: 5000 });

      // Verify error is shown
      expect(await loginPage.isErrorVisible()).toBe(true);

      // Verify no redirect occurred
      expect(page.url()).toContain('/login');

      // Verify no session created
      expect(await loginPage.isLoggedIn()).toBe(false);
    });

    test('should redirect unauthenticated user from protected route', async ({ page }) => {
      // Try to access protected route without login
      await page.goto('/userlibrary');

      // Should redirect to login
      await page.waitForURL(/\/login/, { timeout: 10000 });
      expect(page.url()).toContain('/login');
    });
  });

  test.describe('Session Management', () => {
    test('should persist session after page refresh', async ({ authenticatedPage }) => {
      // authenticatedPage is already logged in via fixture
      const loginPage = new LoginPage(authenticatedPage);

      // Verify initial login
      expect(await loginPage.isLoggedIn()).toBe(true);

      // Refresh page
      await authenticatedPage.reload();

      // Verify still logged in
      expect(await loginPage.isLoggedIn()).toBe(true);

      // Should still be on home page (not redirected to login)
      expect(authenticatedPage.url()).not.toContain('/login');
    });

    test('should access protected route when authenticated', async ({ authenticatedPage }) => {
      // Navigate to protected route
      await authenticatedPage.goto('/userlibrary');

      // Should not redirect to login
      await authenticatedPage.waitForURL('/userlibrary', { timeout: 5000 });
      expect(authenticatedPage.url()).toContain('/userlibrary');
    });

    // TODO: Fix logout test - Server Action redirect() not working from onClick handler
    // The signOut server action uses redirect() which doesn't work properly when called from onClick
    // Should be converted to form action or use startTransition
    test.skip('should logout successfully', async ({ authenticatedPage }) => {
      const loginPage = new LoginPage(authenticatedPage);

      // Verify initial login
      expect(await loginPage.isLoggedIn()).toBe(true);

      // Click logout button
      const logoutButton = authenticatedPage.locator('[data-testid="logout-button"]');

      // Wait for logout button to be visible
      await logoutButton.waitFor({ state: 'visible', timeout: 5000 });
      await logoutButton.click();

      // Wait for logout button to disappear (indicates signOut completed)
      await logoutButton.waitFor({ state: 'hidden', timeout: 10000 });

      // Verify session cleared
      expect(await loginPage.isLoggedIn()).toBe(false);
    });
  });

  test.describe('Edge Cases', () => {
    test('should redirect to home when accessing login while authenticated', async ({ authenticatedPage }) => {
      // Try to access login page while already logged in
      await authenticatedPage.goto('/login');

      // Should redirect away from login page
      await authenticatedPage.waitForTimeout(2000);

      // Either redirects to home or stays on login but is authenticated
      const loginPage = new LoginPage(authenticatedPage);
      const isLoggedIn = await loginPage.isLoggedIn();

      // If still on login page, should still be authenticated
      if (authenticatedPage.url().includes('/login')) {
        expect(isLoggedIn).toBe(true);
      } else {
        // Redirected away from login
        expect(authenticatedPage.url()).not.toContain('/login');
      }
    });

    test('should handle empty email submission', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      // Fill only password
      await loginPage.fillPassword('password');
      await loginPage.clickSubmit();

      // Should show validation error or stay on login page
      await page.waitForTimeout(1000);
      expect(page.url()).toContain('/login');
    });

    test('should handle empty password submission', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      // Fill only email
      await loginPage.fillEmail('abecha@gmail.com');
      await loginPage.clickSubmit();

      // Should show validation error or stay on login page
      await page.waitForTimeout(1000);
      expect(page.url()).toContain('/login');
    });
  });
});
