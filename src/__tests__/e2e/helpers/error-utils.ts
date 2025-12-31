/**
 * E2E Test Error Handling Utilities
 *
 * Provides standardized error handling helpers for E2E tests that log errors
 * instead of silently swallowing them. Use these instead of bare .catch(() => {}).
 */

import { Page, Locator } from '@playwright/test';

/**
 * Safe wait wrapper that logs timeouts instead of silently swallowing them.
 * Use this instead of .catch(() => {}) for wait operations.
 *
 * @param locator - Playwright locator to wait for
 * @param state - The state to wait for
 * @param context - Context string for logging (e.g., 'waitForPageStable')
 * @param timeout - Timeout in milliseconds (default: 10000)
 * @returns true if wait succeeded, false if timed out
 */
export async function safeWaitFor(
  locator: Locator,
  state: 'visible' | 'hidden' | 'attached' | 'detached',
  context: string,
  timeout: number = 10000
): Promise<boolean> {
  try {
    await locator.waitFor({ state, timeout });
    return true;
  } catch (err) {
    console.warn(
      `[${context}] waitFor ${state} timed out after ${timeout}ms:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Safe visibility check that logs errors instead of returning false silently.
 *
 * @param locator - Playwright locator to check
 * @param context - Context string for logging
 * @param timeout - Timeout in milliseconds (default: 100)
 * @returns true if visible, false otherwise (with logging on error)
 */
export async function safeIsVisible(
  locator: Locator,
  context: string,
  timeout: number = 100
): Promise<boolean> {
  try {
    return await locator.isVisible({ timeout });
  } catch (err) {
    console.warn(
      `[${context}] isVisible check failed:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Safe text content extraction that logs errors.
 *
 * @param locator - Playwright locator to extract text from
 * @param context - Context string for logging
 * @returns The text content, or null on error (with logging)
 */
export async function safeTextContent(
  locator: Locator,
  context: string
): Promise<string | null> {
  try {
    return await locator.textContent();
  } catch (err) {
    console.warn(
      `[${context}] textContent failed:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Safe screenshot that logs failures (useful for debugging).
 *
 * @param page - Playwright page to screenshot
 * @param path - File path to save screenshot
 * @param context - Context string for logging
 * @returns true if screenshot succeeded, false on failure (with logging)
 */
export async function safeScreenshot(
  page: Page,
  path: string,
  context: string
): Promise<boolean> {
  try {
    await page.screenshot({ path });
    return true;
  } catch (err) {
    console.warn(
      `[${context}] Screenshot failed at ${path}:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Safe Promise.race wrapper that logs which promise won or if all failed.
 * Use this instead of Promise.race with .catch(() => {}).
 *
 * @param promises - Array of named promises to race
 * @param context - Context string for logging
 * @returns The result of the winning promise, or null if all failed
 */
export async function safeRace<T>(
  promises: Array<{ name: string; promise: Promise<T> }>,
  context: string
): Promise<{ winner: string; result: T } | null> {
  try {
    const racers = promises.map(({ name, promise }) =>
      promise.then((result) => ({ winner: name, result }))
    );
    return await Promise.race(racers);
  } catch (err) {
    console.warn(
      `[${context}] Promise.race failed:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
