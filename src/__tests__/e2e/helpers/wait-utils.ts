import { Page } from '@playwright/test';

interface WaitOptions {
  timeout?: number;
  pollInterval?: number;
}

/**
 * Wait for one of multiple possible states
 * Returns which state was reached - replaces Promise.race with silent catches
 */
export async function waitForState<T extends string>(
  page: Page,
  states: Record<T, () => Promise<boolean>>,
  options: WaitOptions = {}
): Promise<T | 'timeout'> {
  const { timeout = 10000, pollInterval = 100 } = options;
  const startTime = Date.now();
  const stateNames = Object.keys(states) as T[];

  while (Date.now() - startTime < timeout) {
    for (const stateName of stateNames) {
      try {
        if (await states[stateName]()) return stateName;
      } catch {
        // State check failed, continue polling
      }
    }
    await page.waitForTimeout(pollInterval);
  }
  return 'timeout';
}

/**
 * Wait for route to be registered before navigation
 * Replaces waitForTimeout(100) after mock setup
 */
export async function waitForRouteReady(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
}

/**
 * Wait for page to stabilize without networkidle
 * Replaces networkidle which can hang in CI
 */
export async function waitForPageStable(page: Page, options: WaitOptions = {}): Promise<void> {
  const { timeout = 10000 } = options;
  await page.waitForLoadState('domcontentloaded');

  const loadingIndicators = [
    '[data-testid="loading-indicator"]',
    '[data-testid="library-loading"]',
    '.animate-spin',
    '[aria-busy="true"]',
  ];

  for (const indicator of loadingIndicators) {
    const locator = page.locator(indicator);
    if (await locator.isVisible({ timeout: 100 }).catch(() => false)) {
      await locator.waitFor({ state: 'hidden', timeout }).catch(() => {});
    }
  }
}
