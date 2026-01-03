/**
 * Base fixture that provides bypass cookie injection without authentication.
 * Overrides the default `page` fixture to inject bypass cookies for unauth tests.
 */
import { test as base } from '@playwright/test';
import { needsBypassCookie, loadBypassCookieState } from '../setup/vercel-bypass';

// Override `page` fixture to inject bypass cookie before creating page
// This avoids needing to update all unauth tests - they can keep using { page }
export const test = base.extend({
  page: async ({ context }, use) => {
    // Inject bypass cookie BEFORE creating page
    if (needsBypassCookie()) {
      const bypassState = loadBypassCookieState();
      if (bypassState?.cookie) {
        await context.addCookies([bypassState.cookie]);
      }
    }

    const page = await context.newPage();
    // use is Playwright fixture, not React hook
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
