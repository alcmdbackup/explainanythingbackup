// Wraps Playwright page.goto with a single retry on Firefox's NS_BINDING_ABORTED.
// Background: chained `goto -> click -> goto` on Next.js 15 RSC pages can abort the
// second goto when the prior detail page's in-flight useEffect fetches haven't settled.
// See docs/planning/nightly_e2e_still_failing_20260530/ for the full diagnosis.

import type { Page, Response } from '@playwright/test';

type GotoOpts = Parameters<Page['goto']>[1];

export async function safeGoto(
  page: Pick<Page, 'goto' | 'waitForLoadState'>,
  url: string,
  opts?: GotoOpts,
): Promise<Response | null> {
  try {
    return await page.goto(url, opts);
  } catch (err) {
    if (!/NS_BINDING_ABORTED/.test(String(err))) {
      throw err;
    }
    // Let the in-flight RSC nav settle, then retry once. waitForLoadState may itself
    // reject if the page is mid-navigation; ignore that and proceed to the retry.
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    console.warn(`[safeGoto] NS_BINDING_ABORTED retry on ${url}`);
    return await page.goto(url, opts);
  }
}
