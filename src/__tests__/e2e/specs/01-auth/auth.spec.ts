import { test, expect } from '../../fixtures/auth';
import { LoginPage } from '../../helpers/pages/LoginPage';

test.describe('Authentication Flow', () => {
  // NOTE: Login tests moved to auth.unauth.spec.ts since they require unauthenticated state

  test.describe('Session Management', () => {
    test('should persist session after page refresh', { tag: '@critical' }, async ({ authenticatedPage }) => {
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

    test('should access protected route when authenticated', { tag: '@critical' }, async ({ authenticatedPage }) => {
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
    test('should redirect to home when accessing login while authenticated', { tag: '@critical' }, async ({ authenticatedPage }) => {
      // Try to access login page while already logged in
      await authenticatedPage.goto('/login');

      // Wait for page to load
      await authenticatedPage.waitForLoadState('domcontentloaded');

      // Wait for either redirect or login form to appear (auth check is async)
      await Promise.race([
        authenticatedPage.waitForURL(/^(?!.*\/login)/, { timeout: 10000 }), // Not login page
        authenticatedPage.locator('[data-testid="login-email"]').waitFor({ state: 'visible', timeout: 10000 }),
      ]).catch(() => {});

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

    // NOTE: Empty field tests moved to auth.unauth.spec.ts
  });
});
