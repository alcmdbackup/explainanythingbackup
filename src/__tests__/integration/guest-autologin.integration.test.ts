/**
 * Integration Test: Guest Autologin Middleware
 *
 * Exercises src/lib/utils/supabase/middleware.ts updateSession() with a REAL
 * Supabase client (no @supabase/ssr mock). Covers the Phase 0 refactor:
 *   - failed signInWithPassword no longer sets GUEST_AUTOLOGIN_FAILED_RECENTLY cookie
 *   - autologin is skipped entirely when pathname starts with /login
 *
 * Uses an intentionally-wrong GUEST_PASSWORD to force a real Supabase auth
 * failure (no mock layer). The guest user row in dev Supabase must exist for
 * the failure assertion to be meaningful — if the row is missing, the call
 * still fails (different code path) but the cookie assertion still holds.
 */

// Force real @supabase/ssr — src/__mocks__/@supabase/ssr.ts is auto-applied
// otherwise and returns a fake user that bypasses the autologin code path.
jest.unmock('@supabase/ssr');

import { NextRequest } from 'next/server';
import { updateSession, __resetGuestLoginCacheForTests } from '@/lib/utils/supabase/middleware';

describe('Guest Autologin Middleware Integration Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    __resetGuestLoginCacheForTests();
    // Public-host trigger conditions
    process.env.GUEST_EMAIL = process.env.GUEST_EMAIL ?? 'guest@explainanything.app';
    delete process.env.E2E_TEST_MODE;
  });

  afterEach(() => {
    __resetGuestLoginCacheForTests();
  });

  function buildRequest(url: string): NextRequest {
    const parsed = new URL(url);
    return new NextRequest(url, {
      headers: { host: parsed.host },
    });
  }

  function hasFailureCookie(response: Response): boolean {
    // Real NextResponse uses Set-Cookie header(s); check across raw headers
    const setCookieHeaders: string[] = [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') setCookieHeaders.push(value);
    });
    return setCookieHeaders.some((h) => h.includes('GUEST_AUTOLOGIN_FAILED_RECENTLY'));
  }

  it('failed signInWithPassword redirects to /login WITHOUT GUEST_AUTOLOGIN_FAILED_RECENTLY cookie', async () => {
    // Intentionally-wrong password triggers a real Supabase auth failure.
    process.env.GUEST_PASSWORD = 'integration-test-known-bad-password-do-not-use-elsewhere';

    const response = await updateSession(buildRequest('http://localhost:3000/'));

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('Location')).toContain('/login');
    expect(hasFailureCookie(response)).toBe(false);
  });

  it('skips signInWithPassword entirely when pathname starts with /login', async () => {
    // Wrong password to prove autologin is SKIPPED, not just succeeding.
    // If the guard were missing, middleware would call signInWithPassword,
    // fail, and return a 3xx redirect. With the guard, no signIn → 200 passthrough.
    process.env.GUEST_PASSWORD = 'integration-test-known-bad-password-do-not-use-elsewhere';

    const response = await updateSession(buildRequest('http://localhost:3000/login'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Location')).toBeNull();
    expect(hasFailureCookie(response)).toBe(false);
  });

  it('skips signInWithPassword on /login subpaths via startsWith match', async () => {
    process.env.GUEST_PASSWORD = 'integration-test-known-bad-password-do-not-use-elsewhere';

    // /login/anything — startsWith should match
    const response = await updateSession(buildRequest('http://localhost:3000/login/oauth-callback'));

    expect(response.status).toBe(200);
    expect(hasFailureCookie(response)).toBe(false);
  });
});
