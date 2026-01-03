# Smoke Test Bypass Deployment Protection - Progress

## Overall Status: 🔄 Post-Deploy Testing (Iteration 3)

Implementation complete. Multiple production failures identified and fixed through iterative debugging.

---

## Phase 1: Create vercel-bypass.ts Utility

**Status**: ✅ Complete

### Work Done
- Created `src/__tests__/e2e/setup/vercel-bypass.ts` with:
  - `needsBypassCookie()` - checks BASE_URL + secret
  - `obtainBypassCookieWithRetry()` - priming request with exponential backoff
  - `saveBypassCookieState()` / `loadBypassCookieState()` - file-based sharing
  - `cleanupBypassCookieFile()` - teardown cleanup
  - `setupVercelBypass()` - main entry point

### Implementation Details
- Deterministic temp file path for cross-worker sharing
- Accept ANY Set-Cookie with HttpOnly+Secure (not filter by name)
- Only expect 302/307 (not 303) per Vercel docs
- Parse Max-Age/Expires from header
- Omit domain for `__Host-` prefixed cookies

---

## Phase 2: Integrate into Global Setup

**Status**: ✅ Complete

### Work Done
- Added import for `setupVercelBypass` in `global-setup.ts`
- Call `setupVercelBypass()` BEFORE `waitForServerReady()`
- Health check always runs (even for external URLs)

---

## Phase 3: Fix Auth Fixture

**Status**: ✅ Complete

### Work Done
- Added import for bypass utilities in `fixtures/auth.ts`
- Fixed hardcoded `domain: 'localhost'` to use dynamic domain from BASE_URL
- Fixed hardcoded `secure: false` to be based on https
- Fixed hardcoded `sameSite: 'Lax'` to use 'None' for secure contexts
- Added bypass cookie injection after auth cookie

---

## Phase 3.5: Create Base Fixture for Unauth Tests

**Status**: ✅ Complete

### Work Done
- Created `src/__tests__/e2e/fixtures/base.ts` that overrides `page` fixture
- Updated `auth.unauth.spec.ts` to import from `fixtures/base.ts`
- Tests can still use `{ page }` - no changes to test files needed

---

## Phase 4: Update GitHub Workflow

**Status**: 🔄 Iteration Required

### Work Done (Initial)
- Added bypass header to health check curl
- Added 403 handling and all non-200 status codes
- Used POSIX-compliant `=` instead of `==`
- Added jq error handling
- Added `VERCEL_AUTOMATION_BYPASS_SECRET` to Playwright env
- Added `NEXT_PUBLIC_SUPABASE_URL` to Playwright env
- Added `NEXT_PUBLIC_SUPABASE_ANON_KEY` to Playwright env

### Issue Found in Production (2026-01-03)
First production smoke test failed with HTTP 307:
```
Checking health at: https://explainanything-9z7ht184o-acs-projects-dcdb9943.vercel.app/api/health
##[error]Health check returned HTTP 307
```

**Root Cause**: The bypass mechanism returns 307 with Set-Cookie header, then redirects to the same URL. Without `-L`, curl stops at the redirect response.

### Fix Applied
- Added `-L` to follow redirects
- Added `-c/-b` to persist cookies across redirects
- Added `x-vercel-set-bypass-cookie: samesitenone` header

```bash
# Before (broken)
curl -s -o /tmp/health.json -w '%{http_code}' \
  -H "x-vercel-protection-bypass: $SECRET" \
  "$URL"

# After (fixed)
curl -s -L -o /tmp/health.json -w '%{http_code}' \
  -c /tmp/cookies.txt -b /tmp/cookies.txt \
  -H "x-vercel-protection-bypass: $SECRET" \
  -H "x-vercel-set-bypass-cookie: samesitenone" \
  "$URL"
```

**PR**: #115

---

## Phase 5: Cleanup and Gitignore

**Status**: ✅ Complete

### Work Done
- Added cleanup call in `global-teardown.ts`
- Added `.vercel-bypass-cookie.json` to `.gitignore`

---

## Phase 6: Integration Tests

**Status**: ✅ Complete

### Work Done
- Created `src/__tests__/integration/vercel-bypass.integration.test.ts`
- 14 tests covering all utility functions
- All tests passing

---

## Verification

**Status**: ✅ Complete (Local)

### Results
- TypeScript: ✅ No errors
- Lint: ✅ No warnings or errors
- Build: ✅ Successful
- Integration tests: ✅ 14/14 passing
- E2E tests (unauth): ✅ 2/2 passing
- Unit tests: ✅ 2234/2247 passing

---

## Production Deployment Log

| Date | Event | Result |
|------|-------|--------|
| 2026-01-03 05:41 | First production smoke test | ❌ Failed - HTTP 307 |
| 2026-01-03 05:50 | Fix PR #115 created | Pending merge |
| 2026-01-03 06:04 | PR #117 merged to production | curl redirect fix deployed |
| 2026-01-03 06:06 | Second production smoke test | ❌ Failed - HTML instead of JSON |
| 2026-01-03 06:15 | Parallel agent analysis | 11 issues identified across 4 categories |
| 2026-01-03 06:30 | Comprehensive fixes applied | Middleware, locking, validation, timeouts |

---

## Key Learnings

### 1. curl Redirect Behavior
The Vercel bypass mechanism works in two steps:
1. Request with bypass header → 307 redirect + Set-Cookie
2. Follow redirect with cookie → 200 OK

Without `-L` (follow redirects) and `-c/-b` (cookie jar), curl stops at step 1.

### 2. Planning Doc Gaps
The original planning doc focused on Playwright's fetch API but didn't account for the GitHub workflow's curl-based health check needing the same redirect handling.

### 3. Vercel Environment Naming
- Merging to `main` triggers a "staging" deployment
- Merging to `production` branch triggers "Production" deployment
- The smoke test only runs for `environment == 'Production'`

### 4. Two Layers of Protection (2026-01-03 06:06)
The second smoke test revealed there are TWO layers of protection:

1. **Vercel Deployment Protection** - Handled by bypass header/cookie. Returns 307 → Set-Cookie → redirect.
2. **App-level Auth Middleware** - Next.js middleware in `src/middleware.ts` redirects unauthenticated requests to `/login`.

The Vercel bypass was working (200 response, not 403), but the app's auth middleware was intercepting `/api/health` and redirecting to the login page, returning HTML instead of JSON.

**Fix**: Add `api/health` to the middleware matcher exclusions in `src/middleware.ts`:
```typescript
// Before
'/((?!_next/static|...|api/monitoring|.*\\.(?:svg|...)$).*)',

// After
'/((?!_next/static|...|api/monitoring|api/health|.*\\.(?:svg|...)$).*)',
```

This is a critical oversight in the original planning - the health endpoint must be accessible without authentication for smoke tests to work.

### 5. Comprehensive Issue Analysis (2026-01-03 06:15)

Used 4 parallel exploration agents to analyze potential failure points. Found 11 issues:

**Critical (2)**:
1. ✅ Middleware auth redirect - Fixed by adding `api/health` to exclusions
2. ⚠️ Hardcoded Tag IDs 2 & 5 - Health check fails if tags missing in prod DB

**High Priority (4)**:
3. ✅ File race condition - Added file locking to `vercel-bypass.ts`
4. ✅ No cookie validation - Added post-injection validation in `base.ts`
5. ⚠️ Missing SERVICE_ROLE_KEY - Smoke tests can't seed fixtures
6. ✅ Stale cookie handling - Improved with better validation and error messages

**Medium Priority (3)**:
7. ✅ No query timeout - Added 10s timeout to health endpoint DB queries
8. Domain parsing - Uses hostname only (acceptable for now)
9. ✅ Curl redirect limit - Added `--max-redirs 5` and connection timeouts

**Low Priority (2)**:
10. Text selector brittleness - Uses `text=Saved` (acceptable for now)
11. Secret format validation - Not critical

### 6. Fixes Applied (2026-01-03 06:30)

**vercel-bypass.ts**:
- Added file locking mechanism (`acquireLock`/`releaseLock`) using exclusive file creation
- Added cookie structure validation in `loadBypassCookieState()`
- Added `isBypassCookieStale()` helper function
- Better error logging for debugging

**base.ts**:
- Added post-injection validation to verify cookie was actually set
- Added error logging when bypass cookie is missing/invalid

**post-deploy-smoke.yml**:
- Added `--max-redirs 5` to prevent redirect loops
- Added `--connect-timeout 10` and `--max-time 30` to prevent hangs

**api/health/route.ts**:
- Added query timeout using Supabase client's global fetch with AbortSignal.timeout
- Prevents DB queries from hanging indefinitely

---

## Pre-Merge Checklist

- [x] TypeScript compiles: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint`
- [x] Build succeeds: `npm run build`
- [x] Integration tests pass: `npm run test:integration -- vercel-bypass`
- [x] E2E unauth tests pass locally
- [x] `VERCEL_AUTOMATION_BYPASS_SECRET` exists in GitHub Secrets
- [x] `NEXT_PUBLIC_SUPABASE_URL` exists in GitHub Secrets
- [x] `NEXT_PUBLIC_SUPABASE_ANON_KEY` exists in GitHub Secrets
- [ ] Production smoke test passes

---

## Files Modified

| File | Action |
|------|--------|
| `src/__tests__/e2e/setup/vercel-bypass.ts` | CREATE |
| `src/__tests__/e2e/setup/global-setup.ts` | MODIFY |
| `src/__tests__/e2e/fixtures/auth.ts` | MODIFY |
| `src/__tests__/e2e/fixtures/base.ts` | CREATE |
| `src/__tests__/e2e/setup/global-teardown.ts` | MODIFY |
| `src/__tests__/e2e/specs/auth.unauth.spec.ts` | MODIFY |
| `.github/workflows/post-deploy-smoke.yml` | MODIFY (x2) |
| `.gitignore` | MODIFY |
| `src/__tests__/e2e/E2E_TESTING_PLAN.md` | MODIFY |
| `src/__tests__/integration/vercel-bypass.integration.test.ts` | CREATE |
| `src/middleware.ts` | MODIFY (add api/health exclusion) |
| `src/app/api/health/route.ts` | MODIFY (add query timeout) |
