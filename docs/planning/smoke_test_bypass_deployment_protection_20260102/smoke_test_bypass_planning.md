# Smoke Test Bypass Deployment Protection - Planning

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
| `src/__tests__/e2e/setup/vercel-bypass.ts` | CREATE | Bypass utility module |
| `src/__tests__/e2e/setup/global-setup.ts` | MODIFY | Call bypass setup first |
| `src/__tests__/e2e/fixtures/auth.ts` | MODIFY | Dynamic domain + bypass cookie injection |
| `src/__tests__/e2e/setup/global-teardown.ts` | MODIFY | Cleanup bypass cookie file |
| `.github/workflows/post-deploy-smoke.yml` | MODIFY | Add bypass header + env var |
| `.gitignore` | MODIFY | Add `.vercel-bypass-cookie.json` |

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
import * as path from 'path';

// Constants for Vercel bypass headers and cookie names
const BYPASS_HEADER = 'x-vercel-protection-bypass';
const SET_BYPASS_COOKIE_HEADER = 'x-vercel-set-bypass-cookie';
const VERCEL_JWT_COOKIE_NAME = '_vercel_jwt';
const HOST_BYPASS_COOKIE_NAME = '__Host-vercel-bypass';
const BYPASS_COOKIE_FILE = path.join(process.cwd(), '.vercel-bypass-cookie.json');

interface BypassCookie {
  name: string;
  value: string;
  domain: string;
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
 * Make priming request to obtain bypass cookie from Vercel
 */
export async function obtainBypassCookie(baseUrl: string): Promise<BypassCookie | null> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return null;

  console.log(`   Obtaining Vercel bypass cookie for ${baseUrl}...`);

  try {
    const response = await fetch(baseUrl, {
      headers: {
        [BYPASS_HEADER]: secret,
        [SET_BYPASS_COOKIE_HEADER]: 'samesitenone',
      },
      redirect: 'manual',
    });

    // Expect redirect (302/303/307) with Set-Cookie
    if (![302, 303, 307].includes(response.status)) {
      console.warn(`   ⚠️  Bypass request returned ${response.status}, expected redirect`);
      // 200 means protection may be disabled - proceed without cookie
      if (response.status === 200) return null;
      throw new Error(`Unexpected status: ${response.status}`);
    }

    // Get Set-Cookie headers (Node 18+ API)
    const setCookies = response.headers.getSetCookie?.() ?? [];

    // Find the Vercel bypass cookie (name varies)
    const bypassSetCookie = setCookies.find(
      c => c.includes(VERCEL_JWT_COOKIE_NAME) || c.includes(HOST_BYPASS_COOKIE_NAME)
    );

    if (!bypassSetCookie) {
      console.warn('   ⚠️  No Vercel bypass cookie in response');
      console.warn('   Response headers:', [...response.headers.entries()]);
      return null;
    }

    // Parse Set-Cookie string to extract name=value
    const cookieParts = bypassSetCookie.split(';')[0].split('=');
    const cookieName = cookieParts[0].trim();
    const cookieValue = cookieParts.slice(1).join('=').trim();
    const domain = new URL(baseUrl).hostname;

    // Note: __Host- prefixed cookies must NOT have a domain attribute
    // But Playwright requires domain, so we set it anyway (works in practice)
    const cookie: BypassCookie = {
      name: cookieName,
      value: cookieValue,
      domain,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      expires: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    };

    console.log(`   ✓ Obtained bypass cookie: ${cookieName} for ${domain}`);
    return cookie;
  } catch (error) {
    console.error('   ❌ Failed to obtain bypass cookie:', error);
    return null;
  }
}

/**
 * Save bypass cookie state to file for cross-worker sharing
 */
export async function saveBypassCookieState(cookie: BypassCookie): Promise<void> {
  const state: BypassCookieState = {
    cookie,
    timestamp: Date.now(),
  };
  await fs.promises.writeFile(BYPASS_COOKIE_FILE, JSON.stringify(state, null, 2));
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
 * Main setup function - call from global-setup.ts
 */
export async function setupVercelBypass(): Promise<void> {
  if (!needsBypassCookie()) {
    return;
  }

  const baseUrl = process.env.BASE_URL!;
  const cookie = await obtainBypassCookie(baseUrl);

  if (cookie) {
    await saveBypassCookieState(cookie);
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

  const baseUrl = process.env.BASE_URL || 'http://localhost:3008';

  // Skip server readiness for external URLs (bypass request already verified reachability)
  if (!needsBypassCookie()) {
    try {
      await waitForServerReady(baseUrl, {
        maxRetries: process.env.CI ? 60 : 30,
        retryInterval: 1000,
      });
    } catch (error) {
      console.error('❌ Server did not become ready:', error);
      throw error;
    }
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

### Phase 4: Update GitHub Workflow
**Files**: `.github/workflows/post-deploy-smoke.yml`

Two changes:
1. Add bypass header to health check curl (without `eval` for security)
2. Pass `VERCEL_AUTOMATION_BYPASS_SECRET` to Playwright

```yaml
      - name: Health Check
        id: health
        env:
          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
        run: |
          DEPLOY_URL="${{ github.event.deployment_status.target_url }}"
          echo "Checking health at: $DEPLOY_URL/api/health"

          # Add bypass header for protected deployments (no eval - security)
          if [ -n "$VERCEL_AUTOMATION_BYPASS_SECRET" ]; then
            response=$(curl -s -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" "$DEPLOY_URL/api/health")
          else
            response=$(curl -s "$DEPLOY_URL/api/health")
          fi

          status=$(echo "$response" | jq -r '.status')
          # ... rest unchanged

      - name: Run Smoke Tests against Production
        env:
          BASE_URL: ${{ github.event.deployment_status.target_url }}
          TEST_USER_EMAIL: ${{ secrets.PROD_TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.PROD_TEST_USER_PASSWORD }}
          TEST_USER_ID: ${{ secrets.PROD_TEST_USER_ID }}
          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}  # NEW
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

### Unit Tests
| File | Action | Description |
|------|--------|-------------|
| `src/__tests__/e2e/setup/vercel-bypass.test.ts` | CREATE | Unit tests for bypass utility functions |

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
- [ ] Unit tests pass: `npm test -- vercel-bypass.test.ts`
- [ ] Localhost tests pass: `npm run test:e2e -- --project=chromium`
- [ ] chromium-unauth tests pass: `npm run test:e2e -- --project=chromium-unauth`
- [ ] TypeScript compiles: `npm run type-check`
- [ ] Lint passes: `npm run lint`

**Integration Test (Manual, before merge):**
- [ ] Deploy branch to Vercel preview
- [ ] Run: `BASE_URL=https://preview-url.vercel.app VERCEL_AUTOMATION_BYPASS_SECRET=$SECRET npm run test:e2e -- --grep="@smoke"`
- [ ] Verify "Obtained bypass cookie" in console output
- [ ] Verify smoke tests pass

**Post-Merge Verification:**
- [ ] GitHub Actions post-deploy-smoke workflow passes
- [ ] Health check curl returns 200 in workflow logs
- [ ] No "403 Forbidden" errors in test output
- [ ] Bypass file cleanup happens in teardown logs

## 8. Documentation Updates

| Document | Update |
|----------|--------|
| `docs/planning/smoke_test_bypass_deployment_protection_20260102/` | This planning folder serves as documentation |
| `src/__tests__/e2e/E2E_TESTING_PLAN.md` | Add note about Vercel bypass for external URLs |

## 9. Decisions Made

### chromium-unauth Project
**Decision**: Skip bypass for unauth tests. The `chromium-unauth` project has explicit empty `storageState` and tests unauthenticated flows that likely don't access protected routes. No changes needed for this project.

### Cookie Parsing Approach
**Decision**: Manual parsing instead of `set-cookie-parser` npm package to avoid adding dependencies. Simple `split(';')[0].split('=')` is sufficient for extracting name/value.

### Server Readiness Check
**Decision**: Skip `waitForServerReady()` for external URLs since the bypass priming request already verifies the server is reachable.
