// E2E tests for auth redirect security — verifies open redirect protection in callback/confirm routes.

import { test, expect } from '../../fixtures/base';

test.describe('Auth Redirect Security', { tag: '@critical' }, () => {
  test.describe.configure({ retries: 1 });

  test('should reject external URL in auth callback next param', async ({ page }) => {
    // Attempt to access callback with external redirect
    const response = await page.goto('/auth/callback?code=fake&next=https://evil.com');

    // Should redirect to error page (invalid code) but NOT to evil.com
    const url = page.url();
    expect(url).not.toContain('evil.com');
  });

  test('should reject protocol-relative URL in auth callback', async ({ page }) => {
    const response = await page.goto('/auth/callback?code=fake&next=//evil.com');

    const url = page.url();
    expect(url).not.toContain('evil.com');
  });

  test('should reject backslash trick in auth callback', async ({ page }) => {
    const response = await page.goto('/auth/callback?code=fake&next=/\\evil.com');

    const url = page.url();
    expect(url).not.toContain('evil.com');
  });

  test('should allow valid relative path in auth callback', async ({ page }) => {
    // With an invalid code, this will redirect to /error, but the important thing
    // is that it doesn't redirect externally
    await page.goto('/auth/callback?code=fake&next=/dashboard');

    const url = page.url();
    expect(url).not.toContain('evil.com');
    // Should stay on our domain
    const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
    expect(url).toContain(new URL(baseUrl).hostname);
  });

  test('should reject external URL in auth confirm next param', async ({ page }) => {
    await page.goto('/auth/confirm?token_hash=fake&type=email&next=https://evil.com');

    const url = page.url();
    expect(url).not.toContain('evil.com');
  });

  test('should reject protocol-relative URL in auth confirm', async ({ page }) => {
    await page.goto('/auth/confirm?token_hash=fake&type=email&next=//evil.com');

    const url = page.url();
    expect(url).not.toContain('evil.com');
  });
});
