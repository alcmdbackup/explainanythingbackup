# E2E Test Major Fixes - Implementation Progress

Status tracking for the implementation of `e2e_test_major_fixes.md`.

---

## Implementation Status Overview

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0: Test User Provisioning | ✅ Done | Using existing test user (abecha@gmail.com) |
| Phase 1: Infrastructure | ⚠️ Partial | Config done, but env var propagation issue |
| Phase 2: Auth Isolation | ✅ Done | API-based per-worker auth with retry logic |
| Phase 3: Data Management | ✅ Done | global-setup, global-teardown, test-data-factory |
| Phase 4: SSE Streaming | ✅ Done | test-mode.ts with 4 scenarios |
| Phase 5: Test Migration | ✅ Done | Serial mode removed, fixtures migrated |
| Phase 6: Verification | ⏳ In Progress | Running tests, fixing issues |

---

## Issues Found During Verification

### Issue 1: E2E_TEST_MODE Not Available to globalSetup (BLOCKING)

**Symptom:**
```
🚀 E2E Global Setup: Starting...
⏭️  E2E_TEST_MODE not enabled, skipping setup
```

**Root Cause:**
- `E2E_TEST_MODE: 'true'` is set in `playwright.config.ts` → `webServer.env` (line 59)
- `globalSetup` runs BEFORE the webServer starts
- globalSetup loads `.env.local` via dotenv, but `E2E_TEST_MODE` isn't in `.env.local`
- Result: globalSetup sees `E2E_TEST_MODE === undefined`, skips seeding

**Impact:**
- Shared fixtures not seeded
- globalTeardown may also be affected
- SSE test-mode bypass works (webServer has the env var), but setup/teardown don't

**Fix Required:**
Option A: Add to `.env.local`:
```bash
E2E_TEST_MODE=true
```

Option B: Set env var at Playwright config root level (before globalSetup runs):
```typescript
// playwright.config.ts - at top level
process.env.E2E_TEST_MODE = 'true';
```

Option C: Use Playwright's `env` option at config level (not just webServer):
```typescript
export default defineConfig({
  // This doesn't exist - webServer.env is the only env option
});
```

**Recommended:** Option B - set `process.env.E2E_TEST_MODE = 'true'` at the top of playwright.config.ts

---

### Issue 2: Failing Test - "should not crash with very long query"

**Location:** `src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts:175`

**Symptom:**
```
Test timeout of 30000ms exceeded.
Error: page.waitForURL: Test timeout of 30000ms exceeded.
waiting for navigation until "load"
```

**Test Code:**
```typescript
test('should not crash with very long query', async ({ authenticatedPage }) => {
  // ... creates 2000 char query
  await page.waitForURL(/\/results/, { timeout: 10000 });  // Line 188 - FAILS
});
```

**Possible Causes:**
1. Very long query causes server-side error/hang
2. Frontend validation blocks submission
3. Network timeout on large payload

**Impact:** First test failure stops test run with `-x` flag

**Priority:** Medium - should investigate if this is a real bug or test issue

---

### Issue 3: Conditional test.skip() Calls (NOT A PROBLEM)

**Finding:** Many `test.skip()` calls in:
- `tags.spec.ts` (18 occurrences)
- `action-buttons.spec.ts` (12 occurrences)

**Analysis:** These are **conditional skips**, not hardcoded skips:
```typescript
if (libraryState === 'empty') {
  test.skip();  // Skip if no data exists
  return;
}
```

**Status:** Working as designed. Tests skip gracefully when test data doesn't exist.

**Future Improvement:** Use test-data-factory to create per-test data, eliminating these conditional skips.

---

## Files Modified (Completed)

| File | Status | Changes |
|------|--------|---------|
| `playwright.config.ts` | ✅ | Added globalSetup/Teardown, E2E_TEST_MODE in webServer.env |
| `src/__tests__/e2e/fixtures/auth.ts` | ✅ | API-based per-worker auth with retry |
| `src/__tests__/e2e/setup/global-setup.ts` | ✅ | Seeds shared fixtures |
| `src/__tests__/e2e/setup/global-teardown.ts` | ✅ | 17-table cleanup |
| `src/__tests__/e2e/helpers/test-data-factory.ts` | ✅ | Per-test data creation |
| `src/app/api/returnExplanation/route.ts` | ✅ | E2E_TEST_MODE branch + guard |
| `src/app/api/returnExplanation/test-mode.ts` | ✅ | Mock streaming (4 scenarios) |

---

## Next Steps

1. **Fix Issue 1:** Add `process.env.E2E_TEST_MODE = 'true'` to top of playwright.config.ts
2. **Re-run tests:** Verify globalSetup runs properly
3. **Investigate Issue 2:** Debug the "very long query" test failure
4. **Full test run:** Run all 123 tests and check pass rate

---

## Test Run Results

### Run 1: 2024-12-26 (Initial Verification)

```
Running 123 tests using 4 workers
E2E_TEST_MODE not enabled, skipping setup  <-- Issue 1

First failure at test 18/123:
  search-generate.spec.ts:175 - "should not crash with very long query"
  Timeout waiting for /results URL
```

**Pass Rate:** Unknown (stopped at first failure)
**Skipped:** Unknown (conditional skips depend on data)

---

## CI Secrets Checklist

From Phase 0 verification:
- [ ] TEST_USER_ID stored in CI secrets
- [ ] TEST_USER_EMAIL stored in CI secrets
- [ ] TEST_USER_PASSWORD stored in CI secrets
- [ ] SUPABASE_SERVICE_ROLE_KEY stored in CI secrets

---

## Related Documents

- `e2e_test_major_fixes.md` - Original implementation plan
- `rewrite_testing_streaming_approach.md` - SSE streaming details
- `test_data_setup_and_cleanup_improvements.md` - Data management options
