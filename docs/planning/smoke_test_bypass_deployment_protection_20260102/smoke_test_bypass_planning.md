# Smoke Test Bypass Deployment Protection - Planning

## Status: ✅ READY FOR EXECUTION

**Critique completed**: 2 rounds with 5 agents, all 11 critical issues addressed.

| Metric | Score |
|--------|-------|
| Vercel API Accuracy | 75/100 → Fixed |
| Playwright Integration | 90/100 → Fixed |
| GitHub Actions | 85/100 → Fixed |
| Architecture Review | 8.8/10 |

## 1. Background

Vercel's Deployment Protection blocks automated access to deployments, requiring authentication. This affects our smoke tests which run against production deployments after each deploy. The protection applies to all auto-generated domains including `explainanything.vercel.app`. Vercel provides a bypass mechanism using a secret token, but it requires specific handling to work with browser-based tests.

## 2. Problem

Previous bypass attempts failed because they didn't account for how Vercel's bypass actually works. The bypass cookie is cryptographically signed by Vercel's edge - you cannot forge it by manually injecting a cookie. You must make a request with the bypass headers and let Vercel set the cookie via a redirect response. Additionally, Playwright's `extraHTTPHeaders` only applies to `page.request.*` API calls, not `page.goto()` browser navigation.

## 3. Options Considered

### Option A: Priming Request + Cookie Injection (SELECTED)
- Make a fetch request with bypass headers and `redirect: 'manual'`
- Parse the Set-Cookie header from Vercel's response
- Inject the cookie into Playwright browser contexts
- **Pros**: Works with both browser navigation and API calls, handles redirects properly
- **Cons**: Requires parsing Set-Cookie header, adds complexity to global-setup

### Option B: Disable Deployment Protection
- Turn off protection in Vercel project settings
- **Pros**: Simple, no code changes
- **Cons**: Reduces security for preview deployments, not recommended

### Option C: Use Custom Domain
- Add a custom domain which is exempt from Standard Protection
- **Pros**: No bypass code needed
- **Cons**: Requires domain setup, doesn't work for preview deployments

## 4. Files Modified

| File | Action | Purpose |
|------|--------|---------|
| `src/__tests__/e2e/setup/vercel-bypass.ts` | CREATE | Bypass utility module with retry logic and secure file handling |
| `src/__tests__/e2e/setup/global-setup.ts` | MODIFY | Call bypass setup first |
| `src/__tests__/e2e/fixtures/auth.ts` | MODIFY | Dynamic domain + bypass cookie injection |
| `src/__tests__/e2e/fixtures/base.ts` | CREATE | Base fixture for bypass-only cookie injection (unauth tests) |
| `src/__tests__/e2e/setup/global-teardown.ts` | MODIFY | Cleanup bypass cookie file |
| `.github/workflows/post-deploy-smoke.yml` | MODIFY | Add bypass header + Supabase env vars |
| `playwright.config.ts` | MODIFY | Use base fixture for chromium-unauth project |
| `.gitignore` | MODIFY | Add bypass cookie file pattern |
| `src/__tests__/integration/vercel-bypass.integration.test.ts` | CREATE | Integration tests for bypass utility |

## 5. Phased Execution Plan

### Phase 1: Create vercel-bypass.ts Utility
**Files**: `src/__tests__/e2e/setup/vercel-bypass.ts` (NEW)

Create utility module with:
- `needsBypassCookie()` - Check if bypass needed (external URL + secret present)
- `obtainBypassCookie(baseUrl)` - Make priming request, parse Set-Cookie
- `saveBypassCookieState()` / `loadBypassCookieState()` - File-based cross-worker sharing
- `cleanupBypassCookieFile()` - Teardown cleanup

```typescript
/**
 * Vercel Deployment Protection bypass utility for E2E tests.
 * Obtains cryptographically-signed bypass cookie from Vercel's edge.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

// Constants for Vercel bypass headers
const BYPASS_HEADER = 'x-vercel-protection-bypass';
const SET_BYPASS_COOKIE_HEADER = 'x-vercel-set-bypass-cookie';

// CRITIQUE FIX: Use deterministic filename (not random per worker)
// Random UUID caused each worker to get different path, breaking file sharing
const BYPASS_COOKIE_FILE = path.join(os.tmpdir(), '.vercel-bypass-cookie.json');

interface BypassCookie {
  name: string;
  value: string;
  domain?: string;  // CRITIQUE FIX: Optional for __Host- cookies (RFC compliance)
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'None' | 'Lax' | 'Strict';
  expires?: number;
}

interface BypassCookieState {
  cookie: BypassCookie;
  timestamp: number;
}

/**
 * Check if bypass is needed (external URL + secret present)
 */
export function needsBypassCookie(): boolean {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const isExternal = !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1');

  if (isExternal && !secret) {
    console.warn('⚠️  Running against external URL without VERCEL_AUTOMATION_BYPASS_SECRET');
  }

  return isExternal && !!secret;
}

/**
 * Make priming request to obtain bypass cookie from Vercel (single attempt)
 */
async function obtainBypassCookieSingle(baseUrl: string): Promise<BypassCookie | null> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return null;

  const response = await fetch(baseUrl, {
    headers: {
      [BYPASS_HEADER]: secret,
      [SET_BYPASS_COOKIE_HEADER]: 'samesitenone',
    },
    redirect: 'manual',
  });

  // CRITIQUE FIX: Only expect 302/307 per Vercel docs (not 303)
  if (![302, 307].includes(response.status)) {
    if (response.status === 200) {
      console.log('   ℹ️  Protection may be disabled (got 200), proceeding without bypass cookie');
      return null;
    }
    throw new Error(`Unexpected status: ${response.status}`);
  }

  // Get Set-Cookie headers
  let setCookies: string[];
  if (typeof response.headers.getSetCookie === 'function') {
    setCookies = response.headers.getSetCookie();
  } else {
    // Fallback for older Node (though we require 18+)
    const header = response.headers.get('set-cookie');
    setCookies = header ? [header] : [];
  }

  // CRITIQUE FIX: Accept ANY Set-Cookie with HttpOnly+Secure (not filter by name)
  // Vercel docs say cookie names are "system-managed, not explicitly disclosed"
  const bypassSetCookie = setCookies.find(
    c => c.includes('HttpOnly') && c.includes('Secure')
  );

  if (!bypassSetCookie) {
    console.warn('   ⚠️  No bypass cookie in response');
    return null;
  }

  // Parse Set-Cookie string to extract name=value
  const cookieParts = bypassSetCookie.split(';')[0].split('=');
  const cookieName = cookieParts[0].trim();
  const cookieValue = cookieParts.slice(1).join('=').trim();

  if (!cookieName || !cookieValue) {
    throw new Error(`Malformed Set-Cookie header: ${bypassSetCookie}`);
  }

  const domain = new URL(baseUrl).hostname;

  // CRITIQUE FIX: Parse expires/max-age from header instead of hardcoding
  let expires: number | undefined;
  const maxAgeMatch = bypassSetCookie.match(/Max-Age=(\d+)/i);
  const expiresMatch = bypassSetCookie.match(/Expires=([^;]+)/i);
  if (maxAgeMatch) {
    expires = Math.floor(Date.now() / 1000) + parseInt(maxAgeMatch[1]);
  } else if (expiresMatch) {
    expires = Math.floor(new Date(expiresMatch[1]).getTime() / 1000);
  } else {
    expires = Math.floor(Date.now() / 1000) + 3600; // fallback 1 hour
  }

  // CRITIQUE FIX: Omit domain for __Host- prefixed cookies (RFC compliance)
  const cookie: BypassCookie = {
    name: cookieName,
    value: cookieValue,
    domain: cookieName.startsWith('__Host-') ? undefined : domain,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    expires,
  };

  console.log(`   ✓ Obtained bypass cookie: ${cookieName} for ${domain}`);
  return cookie;
}

/**
 * FIX: Retry logic with exponential backoff (similar to authenticateWithRetry)
 */
export async function obtainBypassCookieWithRetry(
  baseUrl: string,
  maxRetries = 3,
  initialDelayMs = 1000
): Promise<BypassCookie | null> {
  console.log(`   Obtaining Vercel bypass cookie for ${baseUrl}...`);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await obtainBypassCookieSingle(baseUrl);
    } catch (error) {
      lastError = error as Error;
      const isRetryable =
        error instanceof Error &&
        (error.message.includes('ECONNREFUSED') ||
         error.message.includes('ETIMEDOUT') ||
         error.message.includes('fetch failed'));

      if (!isRetryable || attempt === maxRetries) {
        console.error(`   ❌ Failed to obtain bypass cookie (attempt ${attempt}/${maxRetries}):`, error);
        if (attempt === maxRetries) break;
      }

      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      console.warn(`   ⚠️  Bypass request failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Failed to obtain bypass cookie after retries');
}

/**
 * Synchronous write to avoid race condition with workers
 * Sets restrictive file permissions (0o600)
 */
export function saveBypassCookieState(cookie: BypassCookie): void {
  const state: BypassCookieState = {
    cookie,
    timestamp: Date.now(),
  };
  // Write synchronously to ensure file is ready before workers start
  fs.writeFileSync(BYPASS_COOKIE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  // CRITIQUE FIX: Removed unreliable process.on('exit') handler
  // Playwright can kill workers with SIGKILL, cleanup relies on global-teardown
}

/**
 * Load bypass cookie state from file (synchronous for fixture initialization)
 */
export function loadBypassCookieState(): BypassCookieState | null {
  try {
    const content = fs.readFileSync(BYPASS_COOKIE_FILE, 'utf-8');
    const state = JSON.parse(content) as BypassCookieState;

    // Warn if cookie is stale (>55 min old, expires at 60 min)
    if (state.timestamp && Date.now() - state.timestamp > 55 * 60 * 1000) {
      console.warn('   ⚠️  Bypass cookie may be stale (>55 min old)');
    }

    return state;
  } catch {
    return null;
  }
}

/**
 * Cleanup bypass cookie file
 */
export async function cleanupBypassCookieFile(): Promise<void> {
  try {
    await fs.promises.unlink(BYPASS_COOKIE_FILE);
    console.log('   ✓ Cleaned up bypass cookie file');
  } catch {
    // File doesn't exist, that's fine
  }
}

/**
 * Get the current bypass cookie file path (for debugging/testing)
 */
export function getBypassCookieFilePath(): string {
  return BYPASS_COOKIE_FILE;
}

/**
 * Main setup function - call from global-setup.ts
 */
export async function setupVercelBypass(): Promise<void> {
  if (!needsBypassCookie()) {
    return;
  }

  const baseUrl = process.env.BASE_URL!;
  const cookie = await obtainBypassCookieWithRetry(baseUrl);

  if (cookie) {
    saveBypassCookieState(cookie);
  }
}
```

### Phase 2: Integrate into Global Setup
**Files**: `src/__tests__/e2e/setup/global-setup.ts`

Add import and call BEFORE server readiness check:

```typescript
import { setupVercelBypass, needsBypassCookie } from './vercel-bypass';

async function globalSetup() {
  console.log('🚀 E2E Global Setup: Starting...');

  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

  // NEW: Setup Vercel bypass BEFORE server check (for external URLs)
  await setupVercelBypass();

  // CRITIQUE FIX: ALWAYS run health check (don't skip for external URLs)
  // The bypass request hits / not /api/health, so we need the health check
  const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
  try {
    await waitForServerReady(baseUrl, {
      maxRetries: process.env.CI ? 60 : 30,
      retryInterval: 1000,
    });
  } catch (error) {
    console.error('❌ Server did not become ready:', error);
    throw error;
  }

  // ... rest of existing setup (env validation, seeding)
}
```

### Phase 3: Fix Auth Fixture (Critical)
**Files**: `src/__tests__/e2e/fixtures/auth.ts`

Two changes needed:
1. Dynamic domain for Supabase cookie (fix hardcoded `localhost` on line 104)
2. Inject bypass cookie if available

```typescript
import { needsBypassCookie, loadBypassCookieState } from '../setup/vercel-bypass';

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page, context }, use) => {
    const session = await authenticateWithRetry();

    const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const projectRef = supabaseUrl.hostname.split('.')[0];

    // FIXED: Dynamic domain and secure flag based on BASE_URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
    const cookieDomain = new URL(baseUrl).hostname;
    const isSecure = baseUrl.startsWith('https');

    // Create the session object (unchanged)
    const sessionData = {
      access_token: session.access_token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: session.refresh_token,
      user: session.user,
    };

    const base64 = Buffer.from(JSON.stringify(sessionData)).toString('base64');
    const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const cookieValue = `base64-${base64url}`;

    // FIXED: Use dynamic domain and secure flag
    await context.addCookies([
      {
        name: `sb-${projectRef}-auth-token`,
        value: cookieValue,
        domain: cookieDomain,  // FIXED: was 'localhost'
        path: '/',
        httpOnly: false,
        secure: isSecure,       // FIXED: was false
        sameSite: isSecure ? 'None' : 'Lax',  // FIXED: was 'Lax'
      },
    ]);

    // NEW: Inject Vercel bypass cookie if available
    if (needsBypassCookie()) {
      const bypassState = loadBypassCookieState();
      if (bypassState?.cookie) {
        await context.addCookies([bypassState.cookie]);
      }
    }

    await use(page);
  },
});
```

### Phase 3.5: Create Base Fixture for Unauth Tests (NEW)
**Files**: `src/__tests__/e2e/fixtures/base.ts` (NEW)

**FIX for Gap 1**: The `chromium-unauth` project clears all cookies via empty `storageState`.
We need a base fixture that ONLY injects bypass cookie (no auth) for unauth tests.

```typescript
/**
 * Base fixture that provides bypass cookie injection without authentication.
 * Overrides the default `page` fixture to inject bypass cookies.
 */
import { test as base } from '@playwright/test';
import { needsBypassCookie, loadBypassCookieState } from '../setup/vercel-bypass';

// CRITIQUE FIX: Override `page` fixture instead of creating new `bypassPage`
// This avoids needing to update all 18 unauth tests
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
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
```

**Update `playwright.config.ts`** to use base fixture for chromium-unauth:

```typescript
// In playwright.config.ts, update the chromium-unauth project:
{
  name: 'chromium-unauth',
  testMatch: /.*\.unauth\.spec\.ts$/,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.BASE_URL || 'http://localhost:3008',
    storageState: { cookies: [], origins: [] },
  },
  // Note: Tests in this project should import from fixtures/base.ts
  // to get bypass cookie injection: import { test, expect } from '../fixtures/base';
},
```

**Update unauthenticated test files** to use base fixture:

```typescript
// In src/__tests__/e2e/specs/auth.unauth.spec.ts
// Change: import { test, expect } from '@playwright/test';
// To:
import { test, expect } from '../fixtures/base';

// CRITIQUE FIX: Tests can still use { page } - the fixture override handles injection
test('login page loads', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('/login');
  // ...
});
```

### Phase 4: Update GitHub Workflow
**Files**: `.github/workflows/post-deploy-smoke.yml`

Three changes:
1. Add bypass header to health check curl with 403 handling
2. Pass `VERCEL_AUTOMATION_BYPASS_SECRET` to Playwright
3. **FIX for Gap 4**: Add missing Supabase environment variables

```yaml
      - name: Health Check
        id: health
        env:
          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
        run: |
          DEPLOY_URL="${{ github.event.deployment_status.target_url }}"
          echo "Checking health at: $DEPLOY_URL/api/health"

          # Add bypass header for protected deployments
          if [ -n "$VERCEL_AUTOMATION_BYPASS_SECRET" ]; then
            http_code=$(curl -s -o /tmp/health.json -w '%{http_code}' \
              -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
              "$DEPLOY_URL/api/health")
          else
            http_code=$(curl -s -o /tmp/health.json -w '%{http_code}' "$DEPLOY_URL/api/health")
          fi

          # CRITIQUE FIX: Use = instead of == for POSIX compliance
          # CRITIQUE FIX: Handle all non-200 status codes
          if [ "$http_code" = "403" ]; then
            echo "::error::Deployment protection blocked request (403). Check VERCEL_AUTOMATION_BYPASS_SECRET."
            exit 1
          elif [ "$http_code" != "200" ]; then
            echo "::error::Health check returned HTTP $http_code"
            cat /tmp/health.json 2>/dev/null || echo "(No response body)"
            exit 1
          fi

          # CRITIQUE FIX: Add jq error handling
          response=$(cat /tmp/health.json)
          if ! status=$(echo "$response" | jq -r '.status' 2>/dev/null); then
            echo "::error::Failed to parse health check JSON response"
            echo "Response body:"
            cat /tmp/health.json
            exit 1
          fi
          # ... rest unchanged

      - name: Run Smoke Tests against Production
        env:
          BASE_URL: ${{ github.event.deployment_status.target_url }}
          TEST_USER_EMAIL: ${{ secrets.PROD_TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.PROD_TEST_USER_PASSWORD }}
          TEST_USER_ID: ${{ secrets.PROD_TEST_USER_ID }}
          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
          # FIX for Gap 4: Add missing Supabase env vars for auth fixture
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
        run: |
          echo "Running smoke tests against: $BASE_URL"
          npx playwright test --project=chromium --grep="@smoke" --reporter=list
```

### Phase 5: Cleanup and Gitignore
**Files**:
- `src/__tests__/e2e/setup/global-teardown.ts` - Add cleanup call
- `.gitignore` - Add `.vercel-bypass-cookie.json`

```typescript
// global-teardown.ts
import { cleanupBypassCookieFile } from './vercel-bypass';

async function globalTeardown() {
  console.log('🧹 E2E Global Teardown: Starting...');

  // NEW: Cleanup bypass cookie file
  await cleanupBypassCookieFile();

  // ... rest of existing cleanup
}
```

```gitignore
# .gitignore addition
# E2E test artifacts
.vercel-bypass-cookie.json
```

## 6. Tests Added/Modified

### Integration Tests
**FIX for Gap 7**: Use integration test pattern (matches existing codebase structure).

| File | Action | Description |
|------|--------|-------------|
| `src/__tests__/integration/vercel-bypass.integration.test.ts` | CREATE | Integration tests for bypass utility functions |

> **Note**: The codebase has no unit tests in `e2e/setup/`. All tests follow the pattern:
> - `src/__tests__/integration/*.integration.test.ts` for integration tests
> - `src/__tests__/e2e/specs/*.spec.ts` for E2E tests

Test coverage:
- `needsBypassCookie()`
  - Returns false for localhost
  - Returns false for 127.0.0.1
  - Returns false when secret is missing (with warning)
  - Returns true for external URL with secret
  - Handles empty BASE_URL string
- `obtainBypassCookie()`
  - Parses `_vercel_jwt` cookie from 307 redirect
  - Parses `__Host-vercel-bypass` cookie variant
  - Returns null when getSetCookie is undefined (Node < 18)
  - Returns null on 200 response (protection disabled)
  - Throws on 401/403 response (invalid secret)
  - Handles network timeout/ECONNREFUSED
  - Handles malformed Set-Cookie (no `=` sign)
  - Handles cookie value with `=` characters (JWT tokens)
- `saveBypassCookieState()` / `loadBypassCookieState()`
  - Round-trip serialization works
  - Load returns null for missing file
  - Load returns null for invalid JSON
  - Load warns on stale cookie (>55 min)
- `cleanupBypassCookieFile()`
  - Removes file when it exists
  - No error when file doesn't exist

```typescript
// Example test structure
describe('vercel-bypass', () => {
  describe('needsBypassCookie', () => {
    it('returns false for localhost URL', () => {
      process.env.BASE_URL = 'http://localhost:3008';
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'secret';
      expect(needsBypassCookie()).toBe(false);
    });

    it('returns true for external URL with secret', () => {
      process.env.BASE_URL = 'https://example.vercel.app';
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'secret';
      expect(needsBypassCookie()).toBe(true);
    });
  });

  describe('obtainBypassCookie', () => {
    it('parses _vercel_jwt cookie from redirect response', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        status: 307,
        headers: {
          getSetCookie: () => ['_vercel_jwt=abc123; Path=/; HttpOnly; Secure'],
        },
      } as unknown as Response);

      process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'secret';
      const cookie = await obtainBypassCookie('https://example.vercel.app');

      expect(cookie?.name).toBe('_vercel_jwt');
      expect(cookie?.value).toBe('abc123');
    });
  });
});
```

### E2E Tests
| File | Action | Description |
|------|--------|-------------|
| `src/__tests__/e2e/specs/smoke.spec.ts` | EXISTING | Smoke tests that will now work against protected deployments |

No new E2E tests needed - existing smoke tests serve as integration verification.

## 7. Testing Strategy

### Local Testing (no bypass needed)
```bash
npm run test:e2e  # Runs against localhost, bypass skipped
```

### Against Protected Deployment
```bash
BASE_URL=https://explainanything.vercel.app \
VERCEL_AUTOMATION_BYPASS_SECRET=$SECRET \
npm run test:e2e -- --grep="@smoke"
```

### Manual Verification on Stage
1. Trigger a production deployment
2. Observe post-deploy smoke workflow in GitHub Actions
3. Verify logs show "Vercel bypass cookie obtained"
4. Verify smoke tests pass against the protected deployment

### Verification Checklist

**Pre-Merge Verification:**
- [ ] Integration tests pass: `npm test -- vercel-bypass.integration.test.ts`
- [ ] Localhost tests pass: `npm run test:e2e -- --project=chromium`
- [ ] chromium-unauth tests pass: `npm run test:e2e -- --project=chromium-unauth`
- [ ] TypeScript compiles: `npm run type-check`
- [ ] Lint passes: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] Verify `VERCEL_AUTOMATION_BYPASS_SECRET` exists in GitHub Secrets
- [ ] Verify `NEXT_PUBLIC_SUPABASE_URL` exists in GitHub Secrets
- [ ] Verify `NEXT_PUBLIC_SUPABASE_ANON_KEY` exists in GitHub Secrets
- [ ] Verify Node version >= 18 in CI (for `getSetCookie` API)

**Integration Test (Manual, before merge):**
- [ ] Deploy branch to Vercel preview
- [ ] Run: `BASE_URL=https://preview-url.vercel.app VERCEL_AUTOMATION_BYPASS_SECRET=$SECRET npm run test:e2e -- --grep="@smoke"`
- [ ] Verify "Obtained bypass cookie" in console output
- [ ] Verify correct cookie name logged (`_vercel_jwt` or `__Host-vercel-bypass`)
- [ ] Verify smoke tests pass
- [ ] Test `chromium-unauth` project against preview deployment

**Post-Merge Verification:**
- [ ] GitHub Actions post-deploy-smoke workflow passes
- [ ] Health check curl returns 200 in workflow logs
- [ ] No "403 Forbidden" errors in test output
- [ ] Bypass file cleanup happens in teardown logs
- [ ] Monitor next 3 production deployments for stability

## 8. Documentation Updates

| Document | Update |
|----------|--------|
| `docs/planning/smoke_test_bypass_deployment_protection_20260102/` | This planning folder serves as documentation |
| `src/__tests__/e2e/E2E_TESTING_PLAN.md` | Add note about Vercel bypass for external URLs |

## 9. Decisions Made

### chromium-unauth Project
**Decision (REVISED)**: Provide bypass cookie for unauth tests via base fixture.

The `chromium-unauth` project has explicit empty `storageState` which clears all cookies.
However, unauth tests still need to access protected deployments, so they need the bypass cookie.

**Solution**: Create `fixtures/base.ts` with a `bypassPage` fixture that injects only the
bypass cookie (no auth). Unauth tests import from this fixture instead of `@playwright/test`.

### Cookie Parsing Approach
**Decision**: Manual parsing instead of `set-cookie-parser` npm package to avoid adding dependencies. Simple `split(';')[0].split('=')` is sufficient for extracting name/value.

### Server Readiness Check
**Decision**: Skip `waitForServerReady()` for external URLs since the bypass priming request already verifies the server is reachable.

## 10. Rollback Plan

**FIX for Gap 6**: Recovery procedures if the bypass mechanism fails after merge.

### Immediate Rollback (if tests start failing)
1. **Quick fix**: Revert the commit that added bypass mechanism
   ```bash
   git revert <commit-hash>
   ```
2. **Note**: Smoke tests will then fail against protected deployments until fixed

### Temporary Mitigation
1. **Disable Deployment Protection temporarily**:
   - Go to Vercel Dashboard → Project Settings → Deployment Protection
   - Set protection level to "None" or add IP allowlist for CI
   - Re-enable after fixing the bypass mechanism

2. **Use custom domain** (if available):
   - Custom domains are exempt from Standard Protection
   - Update workflow to use `https://explainanything.com` instead of Vercel preview URL

### Investigation Checklist
If bypass suddenly stops working:

1. **Check bypass secret validity**:
   ```bash
   curl -I -H "x-vercel-protection-bypass: $SECRET" https://deployment.vercel.app
   ```
   - If 403: Secret may be invalid or expired

2. **Verify GitHub secret is set**:
   - Go to repo Settings → Secrets → Actions
   - Ensure `VERCEL_AUTOMATION_BYPASS_SECRET` exists

3. **Check Vercel bypass secret**:
   - Vercel Dashboard → Project Settings → Deployment Protection
   - Verify "Protection Bypass for Automation" is enabled
   - Regenerate secret if needed, update GitHub secret

4. **Check for Vercel API changes**:
   - Review [Vercel changelog](https://vercel.com/changelog)
   - Check [Vercel bypass docs](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)

5. **Check cookie format changes**:
   - Look at response headers from bypass request
   - Verify cookie name is still `_vercel_jwt` or `__Host-vercel-bypass`

### Escalation Path
1. Check [Vercel Status](https://vercel-status.com/) for outages
2. Search [Vercel GitHub Discussions](https://github.com/vercel/vercel/discussions) for similar issues
3. Contact Vercel support if issue persists

### Monitoring (Post-Fix)
After restoring functionality:
- [ ] Monitor next 3 production deployments
- [ ] Verify logs show "Obtained bypass cookie" message
- [ ] Verify smoke tests complete without 403 errors
- [ ] Set up alert for smoke test failures (optional)

## 11. Critique Summary

### Round 1: Three Parallel Critique Agents

| Agent | Focus | Initial Score | Issues Found |
|-------|-------|---------------|--------------|
| Vercel API | Header/cookie accuracy | 75/100 | 4 issues |
| Playwright | Test infrastructure | 90/100 | 4 issues |
| GitHub Actions | Workflow correctness | 85/100 | 3 issues |

### All 11 Issues Fixed

| # | Issue | Fix Applied |
|---|-------|-------------|
| 1 | Cookie name filtering for `_vercel_jwt`/`__Host-vercel-bypass` | Accept ANY Set-Cookie with HttpOnly+Secure |
| 2 | Status code 303 in check | Only check 302/307 per Vercel docs |
| 3 | Hardcoded 1-hour expiry | Parse Max-Age/Expires from header |
| 4 | `__Host-` domain violation | Conditionally omit domain for `__Host-` prefix |
| 5 | Random filename per worker | Use deterministic path in temp dir |
| 6 | `bypassPage` requires test updates | Override `page` fixture instead |
| 7 | Unreliable `process.on('exit')` | Remove, rely on global-teardown |
| 8 | Skip health check for external URLs | Always run health check |
| 9 | Bash `==` operator | Use `=` for POSIX compliance |
| 10 | Only 403 error handling | Handle all non-200 status codes |
| 11 | jq parse failure on HTML | Add jq error handling with fallback |

### Round 2: Verification

Both agents confirmed all 11 issues are properly fixed:
- **Verification Agent**: ✅ READY FOR EXECUTION
- **Architecture Agent**: 8.8/10 - Production-ready
