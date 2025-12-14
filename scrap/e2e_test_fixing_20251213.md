# E2E Test Fixing - 2025-12-13

## Issue
E2E tests were timing out with error: `Timed out waiting 120000ms from config.webServer`

## Root Cause
`playwright.config.ts` webServer command was `npm run dev` which defaults to port 3000, but the config expected port 3002.

## Fix
Updated `playwright.config.ts` to use port 3008:
- `baseURL: 'http://localhost:3008'`
- `command: 'npm run dev -- -p 3008'`
- `url: 'http://localhost:3008'`

## Results After Fix
- 92 passed
- 6 failed
- 6 skipped

### Remaining Failures
1. `smoke.spec.ts` - "home page loads and has search bar" (chromium + firefox)
2. `regenerate.spec.ts` - rewrite button tests (chromium, 2 tests)
3. `search-generate.spec.ts` - streaming tests (firefox, 2 tests)

### Server Logs During Tests
RLS policy errors on `explanationMetrics` table:
```
new row violates row-level security policy (USING expression) for table "explanationMetrics"
```
This is a known issue but doesn't cause test failures directly.
