import { test as base, expect, Page } from '@playwright/test';

// Auth state is pre-loaded via storageState in playwright.config.ts
// This fixture just verifies auth and provides the page
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  authenticatedPage: async ({ page }, use) => {
    // Verify auth state was loaded correctly
    const cookies = await page.context().cookies();
    const hasAuthCookie = cookies.some(
      (c) => c.name.includes('supabase') || c.name.startsWith('sb-')
    );
    expect(hasAuthCookie).toBe(true);

    // use is Playwright fixture, not React hook
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

export { expect };
