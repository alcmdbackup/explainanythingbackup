// E2E tests for auth redirect security — verifies open redirect protection in callback/confirm routes.

import { test, expect } from '../../fixtures/base';

test.describe('Auth Redirect Security', () => {
  test.describe.configure({ retries: 1 });

  test('should reject external URL in auth callback next param', async ({ page }) => {
    await page.goto('/auth/callback?code=fake&next=https://evil.com');
    const url = page.url();
    expect(url).not.toContain('evil.com');
  });

  test('should reject protocol-relative URL in auth callback', async ({ page }) => {
    await page.goto('/auth/callback?code=fake&next=//evil.com');
    const url = page.url();
    expect(url).not.toContain('evil.com');
  });

  test('should reject backslash trick in auth callback', async ({ page }) => {
    await page.goto('/auth/callback?code=fake&next=/\\evil.com');
    const url = page.url();
    expect(url).not.toContain('evil.com');
  });

  test('should allow valid relative path in auth callback', async ({ page }) => {
    await page.goto('/auth/callback?code=fake&next=/dashboard');
    const url = page.url();
    expect(url).not.toContain('evil.com');
    // Verify we stayed on the same origin (localhost or configured base)
    expect(url).toContain('localhost');
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
