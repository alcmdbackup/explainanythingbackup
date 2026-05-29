// E2E: password reset full flow + entry-point UI + guest protection.
//
// Uses a dedicated per-spec test user (admin.createUser + admin.deleteUser)
// so the password mutation cannot poison other parallel-worker tests that
// rely on TEST_USER_*. Serial mode because tests share the dedicated user.
//
// CI requirements (added in this PR):
//   - GUEST_EMAIL, GUEST_PASSWORD, NEXT_PUBLIC_GUEST_EMAIL, GUEST_USER_ID
//     in the e2e-critical job env block — needed by the guest-protection test.
//   - GUEST_USER_ID also passed to the chromium-critical webServer env in
//     playwright.config.ts so the server-side /reset-password gate can fire.

import { test, expect } from '../../fixtures/base';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { randomUUID } from 'crypto';

import { LoginPage } from '../../helpers/pages/LoginPage';
import { ForgotPasswordPage } from '../../helpers/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../../helpers/pages/ResetPasswordPage';

const INITIAL_PWD = 'OldPassword1!';
const NEW_PWD = 'NewPassword1!';

let serviceClient: SupabaseClient;
let dedicatedUser: { id: string; email: string };

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createDedicatedUser(client: SupabaseClient) {
  const email = `pwreset-e2e-${Date.now()}-${randomUUID()}@example.com`;
  const { data, error } = await client.auth.admin.createUser({
    email,
    password: INITIAL_PWD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createDedicatedUser failed: ${error?.message ?? 'no user'}`);
  }
  return { id: data.user.id, email };
}

async function restoreDedicatedUserPassword(client: SupabaseClient, userId: string) {
  // Reset to INITIAL_PWD between tests so subsequent recovery links don't
  // race with the prior test's mutation.
  await client.auth.admin.updateUserById(userId, { password: INITIAL_PWD });
}

// @skip-prod: must NOT run against production. On the prod public host the guest
// auto-login session contaminates this recovery flow (the @example.com test user is
// rejected by prod GoTrue, so verifyOtp fails and the session stays the guest), so
// updateUser({ password }) clobbers the shared guest account and breaks demo
// autologin until manually reset. Confirmed clobbering the guest on 2026-05-28 and
// -29 (incident: docs/planning/autologin_broken_3rd_night_after_fix_20260529).
// Stays @critical so it still runs in PR CI (dev DB + E2E_TEST_MODE off guest auto-login).
test.describe('Password Reset', { tag: ['@critical', '@skip-prod'] }, () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    serviceClient = getServiceClient();
    dedicatedUser = await createDedicatedUser(serviceClient);
  });

  test.afterAll(async () => {
    if (dedicatedUser?.id) {
      try {
        await serviceClient.auth.admin.deleteUser(dedicatedUser.id);
      } catch (err) {
        console.warn('afterAll deleteUser failed:', err);
      }
    }
  });

  test('UI trigger: Forgot password link on /login lands on /forgot-password and submits', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    // Wait for hydration proof (rule 18)
    await page.getByTestId('login-email').waitFor({ state: 'visible' });

    await page.getByTestId('forgot-password-link').click();
    await expect(page).toHaveURL(/\/forgot-password/);

    const forgotPage = new ForgotPasswordPage(page);
    await forgotPage.emailInput.waitFor({ state: 'visible' });
    await forgotPage.submitEmail(dedicatedUser.email);
    await expect(forgotPage.successMessage).toContainText(/if an account exists/i);
  });

  test('Reset flow: recovery link → /reset-password → updateUser → /', async ({ page }) => {
    // Generate recovery link via admin API (skips email round-trip).
    const { data: linkData, error: linkErr } = await serviceClient.auth.admin.generateLink({
      type: 'recovery',
      email: dedicatedUser.email,
    });
    expect(linkErr).toBeNull();
    const tokenHash = linkData?.properties?.hashed_token;
    expect(tokenHash).toBeTruthy();

    // Navigate to /auth/confirm with the same params Supabase's email link
    // carries. Route forwards token_hash + type=recovery to /reset-password
    // (server-side verifyOtp on the recovery path would not emit
    // PASSWORD_RECOVERY on the browser client — only the client that *itself*
    // calls verifyOtp gets the event). The form's useEffect then does the
    // verify on the browser side, the event fires, and the form enables.
    // Bypassing Supabase's /auth/v1/verify also avoids a hard dependency on
    // the staging project's redirect_to allowlist.
    const resetPage = new ResetPasswordPage(page);
    await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=recovery&next=/reset-password`);
    await page.waitForURL(/\/reset-password/, { timeout: 15000 });

    await resetPage.waitForFormEnabled();
    await resetPage.submitNewPassword(NEW_PWD);

    // After successful update, app routes to /. Assert we're not still on
    // /reset-password and not on /login (which would indicate a failure).
    await expect(page).not.toHaveURL(/\/reset-password/);
    await expect(page).not.toHaveURL(/\/login/);

    // Restore for subsequent tests in this serial describe.
    await restoreDedicatedUserPassword(serviceClient, dedicatedUser.id);
  });

  test('Expired link UX: direct visit to /reset-password shows invalid + request-new CTA', async ({ page }) => {
    const resetPage = new ResetPasswordPage(page);
    await page.goto('/reset-password');
    // Form is disabled because PASSWORD_RECOVERY didn't fire.
    await expect(resetPage.invalidMessage).toBeVisible();
    await expect(resetPage.requestNewLink).toHaveAttribute('href', '/forgot-password');
    await expect(resetPage.submitButton).toHaveCount(0);
  });

  test('Guest protection: /reset-password 404s when signed in as guest', async ({ page, context }) => {
    const guestEmail = process.env.GUEST_EMAIL;
    const guestPassword = process.env.GUEST_PASSWORD;
    // eslint-disable-next-line flakiness/no-test-skip -- Infrastructure limitation: GUEST_EMAIL/GUEST_PASSWORD aren't in CI staging secrets
    test.skip(!guestEmail || !guestPassword, 'GUEST_EMAIL/GUEST_PASSWORD env vars not set (CI staging env missing); run locally to exercise this guest-protection test');

    // Manually sign in as the guest using the anon-key client and inject the
    // resulting session into Playwright's context as Supabase-SSR-formatted
    // cookies. Same pattern as fixtures/auth.ts uses for the test user.
    const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const projectRef = supabaseUrl.hostname.split('.')[0];
    const anonClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
      email: guestEmail!,
      password: guestPassword!,
    });
    expect(signInErr).toBeNull();
    expect(signInData.session).toBeTruthy();

    // Supabase SSR session cookie format: base64url-encoded JSON with `base64-` prefix.
    const sessionData = {
      access_token: signInData.session!.access_token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: signInData.session!.refresh_token,
      user: signInData.user,
    };
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- Buffer.toString('base64') is encoding, not an assertion
    const base64 = Buffer.from(JSON.stringify(sessionData)).toString('base64');
    const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const cookieValue = `base64-${base64url}`;

    // eslint-disable-next-line flakiness/no-hardcoded-base-url -- cookie needs hostname-only, derived from baseURL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
    const cookieDomain = new URL(baseUrl).hostname;
    const isSecure = baseUrl.startsWith('https');

    await context.addCookies([
      {
        name: `sb-${projectRef}-auth-token`,
        value: cookieValue,
        domain: cookieDomain,
        path: '/',
        httpOnly: false,
        secure: isSecure,
        sameSite: isSecure ? 'None' : 'Lax',
      },
    ]);

    // Now visit /reset-password — the server-side getUser() === GUEST_USER_ID
    // gate should fire and notFound() returns 404.
    const response = await page.goto('/reset-password');
    expect(response?.status()).toBe(404);
  });
});
