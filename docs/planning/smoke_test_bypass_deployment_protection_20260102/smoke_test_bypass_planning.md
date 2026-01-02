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

## 4. Phased Execution Plan

### Phase 1: Create vercel-bypass.ts Utility
**Files**: `src/__tests__/e2e/setup/vercel-bypass.ts` (NEW)

Create utility module with:
- `needsBypassCookie()` - Check if bypass needed (external URL + secret present)
- `obtainBypassCookie(baseUrl)` - Make priming request, parse Set-Cookie
- `saveBypassCookieState()` / `loadBypassCookieState()` - File-based cross-worker sharing
- `cleanupBypassCookieFile()` - Teardown cleanup

Key implementation:
```typescript
const response = await fetch(baseUrl, {
  headers: {
    'x-vercel-protection-bypass': secret,
    'x-vercel-set-bypass-cookie': 'samesitenone',
  },
  redirect: 'manual', // CRITICAL: capture Set-Cookie before redirect
});
const setCookie = response.headers.get('set-cookie');
```

### Phase 2: Integrate into Global Setup
**Files**: `src/__tests__/e2e/setup/global-setup.ts`

Add bypass cookie priming BEFORE server readiness check:
```typescript
async function globalSetup() {
  dotenv.config({ path: '.env.local' });
  await setupVercelBypass();  // NEW - must run first
  await waitForServerReady(); // Existing
  await seedTestFixtures();   // Existing
}
```

### Phase 3: Inject Cookie in Auth Fixture
**Files**: `src/__tests__/e2e/fixtures/auth.ts`

Add bypass cookie injection + fix hardcoded domain:
```typescript
// Inject Vercel bypass cookie
if (needsBypassCookie()) {
  const bypassState = loadBypassCookieState();
  if (bypassState?.cookie) {
    await context.addCookies([bypassState.cookie]);
  }
}

// Fix: Use dynamic domain instead of hardcoded 'localhost'
const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
const cookieDomain = new URL(baseUrl).hostname;
```

### Phase 4: Update GitHub Workflow
**Files**: `.github/workflows/post-deploy-smoke.yml`

Add bypass header to curl health check:
```yaml
response=$(curl -s \
  -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
  "$DEPLOY_URL/api/health")
```

Pass secret to Playwright:
```yaml
env:
  VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
```

### Phase 5: Cleanup and Gitignore
**Files**:
- `src/__tests__/e2e/setup/global-teardown.ts` - Add cleanup call
- `.gitignore` - Add `.vercel-bypass-cookie.json`

## 5. Testing

### Integration Testing
1. **Local (no bypass)**: `npm run test:e2e` - bypass skipped for localhost
2. **Against protected deployment**:
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

## 6. Documentation Updates

- This planning folder serves as documentation of the approach
- No other docs identified for update
