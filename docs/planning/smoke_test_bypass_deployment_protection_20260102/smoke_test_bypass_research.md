# Smoke Test Bypass Deployment Protection - Research

## 1. Problem Statement

E2E and smoke tests need to run against Vercel deployments, but Vercel's Deployment Protection blocks automated requests. Previous attempts to implement bypass were reverted after failing to work correctly with browser navigation and redirects.

## 2. High Level Summary

Vercel's Deployment Protection operates at the edge layer and requires a two-step bypass process:
1. Send headers `x-vercel-protection-bypass` + `x-vercel-set-bypass-cookie: true`
2. Vercel responds with a redirect that sets a cryptographically signed cookie
3. Subsequent requests use the cookie automatically

Previous attempts failed because:
- Query params are lost on redirects
- `extraHTTPHeaders` in Playwright only works for `page.request.*`, NOT `page.goto()` navigation
- Manually injecting the cookie doesn't work because Vercel's cookie is cryptographically signed

The solution is to make a "priming" fetch request with `redirect: 'manual'` to capture Vercel's Set-Cookie header, then inject that cookie into Playwright's browser context.

## 3. Documents Read

- [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection)
- [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
- [More Secure Deployment Protection Changelog](https://vercel.com/changelog/more-secure-deployment-protection)

Key findings from docs:
- Standard Protection now protects ALL auto-generated domains including `*.vercel.app`
- Only custom domains are exempt from Standard Protection
- `x-vercel-set-bypass-cookie: samesitenone` is needed for cross-origin scenarios
- The bypass cookie is set via redirect, not directly injectable

## 4. Code Files Read

### Reverted Commits Analyzed

| Commit | Approach | Why It Failed |
|--------|----------|---------------|
| a9a4c18 | Query param `?x-vercel-protection-bypass=TOKEN` | Lost through redirects |
| 408d24b | Headers + cookie jar in curl | Headers stripped on redirects |
| b93ca52 | `redirect: 'manual'` in fetch | Only added detection, didn't solve problem |
| 13b7ef7 | Query param in Node.js fetch | Still doesn't persist through redirects |
| eaf48ec | Cookie injection in Playwright context | Cookie is cryptographically signed by Vercel |

### Current Test Infrastructure Files

- `playwright.config.ts` - Main Playwright config with projects and base URL
- `src/__tests__/e2e/setup/global-setup.ts` - Server readiness check, fixture seeding
- `src/__tests__/e2e/fixtures/auth.ts` - Per-worker API auth, cookie injection into browser context
- `src/__tests__/e2e/setup/global-teardown.ts` - Test cleanup
- `.github/workflows/post-deploy-smoke.yml` - Smoke test workflow using `deployment_status.target_url`

### Key Insights from Code

1. Auth fixture already injects Supabase cookies via `context.addCookies()` - same pattern can be used for bypass cookie
2. Global setup runs before tests and can make fetch requests
3. Cookie domain was hardcoded to `localhost` - needs to be dynamic for external URLs
4. `VERCEL_AUTOMATION_BYPASS_SECRET` is already in GitHub secrets

## 5. Critical Gaps Identified (Agent Review)

Multiple review agents identified the following gaps in the original approach:

### 5.1 Set-Cookie Header Parsing
**Issue**: `response.headers.get('set-cookie')` may not return all cookies in Node.js
**Resolution**: Use `response.headers.getSetCookie()` (Node 18+ API) to get array of Set-Cookie values

### 5.2 Cookie Structure Transformation
**Issue**: No code to transform Set-Cookie string to Playwright's `Cookie` object format
**Resolution**: Parse Set-Cookie manually: `cookieString.split(';')[0].split('=')` to extract name/value

### 5.3 Supabase Cookie Also Needs Fix
**Issue**: The Supabase auth cookie in `auth.ts` line 104 also has hardcoded `domain: 'localhost'`
**Resolution**: Both cookies need dynamic domain AND `secure`/`sameSite` attributes based on `BASE_URL`

```typescript
// BEFORE (broken for external URLs)
domain: 'localhost',
secure: false,
sameSite: 'Lax',

// AFTER (works for both localhost and external)
domain: cookieDomain,           // dynamic from BASE_URL
secure: isSecure,               // true for https
sameSite: isSecure ? 'None' : 'Lax',  // None required for cross-origin
```

### 5.4 chromium-unauth Project
**Issue**: `playwright.config.ts` has a `chromium-unauth` project with explicit empty `storageState` that won't receive bypass cookies
**Resolution**: Skip bypass for unauth tests - they test unauthenticated flows that don't need protected routes

### 5.5 Error Handling
**Issue**: No handling for invalid/missing secret or unexpected response codes
**Resolution**: Add explicit warnings and graceful fallbacks

### 5.6 Vercel Cookie Name
**Issue**: Cookie name varies between deployments
**Resolution**: Search for `_vercel_jwt` OR `__Host-vercel-bypass` in Set-Cookie headers

## 6. Technical Verification

### `redirect: 'manual'` Verification
Confirmed via MDN and node-fetch documentation that `redirect: 'manual'` stops at redirect response and provides access to Set-Cookie headers before they're lost.

### Cookie Attributes for Playwright
Verified Playwright's `context.addCookies()` format:
```typescript
{
  name: string;
  value: string;
  domain: string;      // Exact domain, no leading dot
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'None' | 'Lax' | 'Strict';  // Capitalized
  expires?: number;    // Unix timestamp in seconds
}
```

### Cross-Worker Cookie Sharing
Playwright workers are separate Node.js processes. File-based sharing is appropriate:
- Global setup writes cookie to `.vercel-bypass-cookie.json`
- Each worker reads from file in fixture
- Global teardown cleans up file
