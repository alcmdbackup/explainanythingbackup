/**
 * E2E Tests for Client Logging Infrastructure
 *
 * Tests that the client-side logging system correctly:
 * 1. Captures console logs in localStorage
 * 2. Exposes window.exportLogs() for retrieving logs
 * 3. Captures uncaught errors and unhandled rejections
 */
import { test, expect } from '../../fixtures/auth';
import type { Page } from '@playwright/test';

// Helper to wait for client logging initialization
// Uses string expression to avoid TypeScript issues with custom window properties
async function waitForLoggingInit(page: Page): Promise<void> {
  await page.waitForFunction('window.__LOGGING_INITIALIZED__ === true', {
    timeout: 10000,
  });
}

test.describe('Client Logging Infrastructure', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // Clear any existing logs before each test
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('client_logs');
      localStorage.removeItem('client_errors');
    });
  });

  test('should capture console.log messages in localStorage', async ({ authenticatedPage: page }) => {
    await page.goto('/');

    // Wait for client initializer to set up console interceptor
    await waitForLoggingInit(page);

    // Log a unique message via console
    const testMessage = `E2E-TEST-LOG-${Date.now()}`;
    await page.evaluate((msg) => {
      console.log(msg);
    }, testMessage);

    // Verify the log was captured in localStorage
    const logs = await page.evaluate(() => {
      const raw = localStorage.getItem('client_logs');
      return raw ? JSON.parse(raw) : [];
    });

    const foundLog = logs.find(
      (log: { message: string }) => log.message.includes(testMessage)
    );
    expect(foundLog).toBeTruthy();
    expect(foundLog.level).toBe('LOG');
  });

  test('should expose window.exportLogs() function', async ({ authenticatedPage: page }) => {
    await page.goto('/');

    // Wait for initialization
    await waitForLoggingInit(page);

    // Log something
    const testMessage = `EXPORT-TEST-${Date.now()}`;
    await page.evaluate((msg) => console.info(msg), testMessage);

    // Use exportLogs() to retrieve logs
    const exportedLogs = await page.evaluate(() => {
      return (window as Window & { exportLogs?: () => string }).exportLogs?.();
    });

    expect(exportedLogs).toBeTruthy();
    expect(exportedLogs).toContain(testMessage);
  });

  test('should capture console.error messages', async ({ authenticatedPage: page }) => {
    await page.goto('/');

    await waitForLoggingInit(page);

    const errorMessage = `E2E-ERROR-${Date.now()}`;
    await page.evaluate((msg) => {
      console.error(msg);
    }, errorMessage);

    const logs = await page.evaluate(() => {
      const raw = localStorage.getItem('client_logs');
      return raw ? JSON.parse(raw) : [];
    });

    const foundError = logs.find(
      (log: { message: string; level: string }) =>
        log.message.includes(errorMessage) && log.level === 'ERROR'
    );
    expect(foundError).toBeTruthy();
  });

  test('should capture console.warn messages', async ({ authenticatedPage: page }) => {
    await page.goto('/');

    await waitForLoggingInit(page);

    const warnMessage = `E2E-WARN-${Date.now()}`;
    await page.evaluate((msg) => {
      console.warn(msg);
    }, warnMessage);

    const logs = await page.evaluate(() => {
      const raw = localStorage.getItem('client_logs');
      return raw ? JSON.parse(raw) : [];
    });

    const foundWarn = logs.find(
      (log: { message: string; level: string }) =>
        log.message.includes(warnMessage) && log.level === 'WARN'
    );
    expect(foundWarn).toBeTruthy();
  });

  test('should expose window.clearLogs() function that clears all logs', async ({ authenticatedPage: page }) => {
    await page.goto('/');

    await waitForLoggingInit(page);

    // Log something first
    await page.evaluate(() => console.log('test-before-clear'));

    // Verify log exists
    let logs = await page.evaluate(() => localStorage.getItem('client_logs'));
    expect(logs).toContain('test-before-clear');

    // Clear logs
    await page.evaluate(() => {
      (window as Window & { clearLogs?: () => void }).clearLogs?.();
    });

    // Verify logs are cleared
    logs = await page.evaluate(() => localStorage.getItem('client_logs'));
    expect(logs).toBeNull();
  });

  test('should include timestamp in log entries', async ({ authenticatedPage: page }) => {
    await page.goto('/');

    await waitForLoggingInit(page);

    const beforeTime = new Date().toISOString();
    await page.evaluate(() => console.log('timestamp-test'));
    const afterTime = new Date().toISOString();

    const logs = await page.evaluate(() => {
      const raw = localStorage.getItem('client_logs');
      return raw ? JSON.parse(raw) : [];
    });

    const timestampLog = logs.find(
      (log: { message: string }) => log.message.includes('timestamp-test')
    );

    expect(timestampLog).toBeTruthy();
    expect(timestampLog.timestamp).toBeTruthy();
    // Timestamp should be between before and after
    expect(timestampLog.timestamp >= beforeTime).toBe(true);
    expect(timestampLog.timestamp <= afterTime).toBe(true);
  });
});
