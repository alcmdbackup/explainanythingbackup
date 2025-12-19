import { test as base, expect, Page } from '@playwright/test';
import { LoginPage } from '../helpers/pages/LoginPage';

// Define custom fixtures for authentication
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  authenticatedPage: async ({ page }, use) => {
    // Login before the test
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.login(
      process.env.TEST_USER_EMAIL || 'abecha@gmail.com',
      process.env.TEST_USER_PASSWORD || 'password'
    );

    // Wait for redirect after login (30s to match test timeout, allows for slow CI)
    await page.waitForURL('/', { timeout: 30000 });

    // Verify session cookie exists (Supabase uses 'sb-' prefix)
    const cookies = await page.context().cookies();
    const hasAuthCookie = cookies.some((c) => c.name.includes('supabase') || c.name.startsWith('sb-'));
    expect(hasAuthCookie).toBe(true);

    // Provide the authenticated page to the test (use is Playwright fixture, not React hook)
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

export { expect };
