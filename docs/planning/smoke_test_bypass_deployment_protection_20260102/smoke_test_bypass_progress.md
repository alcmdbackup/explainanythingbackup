# Smoke Test Bypass Deployment Protection - Progress

## Overall Status: 🔄 Post-Deploy Testing

Implementation complete and merged to production. First production run failed - fixing curl redirect handling.

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
