import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../helpers/pages/LoginPage';

// Define custom fixtures for authentication
export const test = base.extend<{
  authenticatedPage: ReturnType<typeof base.extend>['page'];
}>({
  authenticatedPage: async ({ page }, use) => {
    // Login before the test
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.login(
      process.env.TEST_USER_EMAIL || 'abecha@gmail.com',
      process.env.TEST_USER_PASSWORD || 'password'
    );

    // Wait for redirect after login
    await page.waitForURL('/', { timeout: 10000 });

    // Verify session cookie exists
    const cookies = await page.context().cookies();
    const hasAuthCookie = cookies.some((c) => c.name.includes('supabase'));
    expect(hasAuthCookie).toBe(true);

    // Provide the authenticated page to the test
    await use(page);
  },
});

export { expect };
