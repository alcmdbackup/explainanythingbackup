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

        // Validate cookie was actually added
        const cookies = await context.cookies();
        const bypassCookie = cookies.find((c) => c.name === bypassState.cookie.name);
        if (!bypassCookie) {
          console.error(
            `❌ Failed to inject bypass cookie "${bypassState.cookie.name}" - ` +
              `domain mismatch? Cookie domain: ${bypassState.cookie.domain || '(none)'}`
          );
        }
      } else {
        // Bypass is needed but cookie file is missing/invalid
        console.error(
          '❌ Bypass cookie required but not available. ' +
            'Ensure global-setup ran successfully and VERCEL_AUTOMATION_BYPASS_SECRET is set.'
        );
      }
    }

    const page = await context.newPage();
    // use is Playwright fixture, not React hook
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
    // B108: bound `unrouteAll({ behavior: 'wait' })` in its own short timeout. If a test
    // fails mid-route handler the 'wait' path can block the whole teardown until the
    // default 30s Playwright-level timeout fires, inflating the test run. Fall back to
    // 'ignore' so handler cleanup proceeds even if some handlers never settle.
    const UNROUTE_TIMEOUT_MS = 5_000;
    const unrouteWait = page.unrouteAll({ behavior: 'wait' });
    const timeoutResult: 'timeout' = await new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), UNROUTE_TIMEOUT_MS);
    });
    const raced = await Promise.race([
      unrouteWait.then(() => 'ok' as const).catch(() => 'err' as const),
      Promise.resolve(timeoutResult),
    ]);
    if (raced === 'timeout') {
      // `ignoreErrors` is the Playwright-approved fallback for forced cleanup: teardown
      // continues even if a handler is mid-flight.
      // eslint-disable-next-line flakiness/no-silent-catch -- forced teardown fallback; ignoreErrors already swallows most, catch covers the rare throw paths
      await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
    }
    await page.close();
  },
});

export { expect } from '@playwright/test';
