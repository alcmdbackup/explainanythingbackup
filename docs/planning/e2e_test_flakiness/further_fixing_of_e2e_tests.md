# E2E Test Flakiness Fix Plan

## Summary
Comprehensive refactor to reduce E2E test flakiness with reusable utilities and test data seeding.

## Current Issues by File

### High Priority

| File | Line | Issue | Fix |
|------|------|-------|-----|
| `specs/05-edge-cases/errors.spec.ts` | 48 | `waitForTimeout(100)` for route registration | Use `waitForRouteReady()` |
| `specs/05-edge-cases/errors.spec.ts` | 109 | `waitForTimeout(100)` for route registration | Use `waitForRouteReady()` |
| `specs/05-edge-cases/errors.spec.ts` | 31-33, 76-78 | `.catch(() => {})` swallows errors | Use `waitForState()` |
| `specs/auth.unauth.spec.ts` | 34 | `networkidle` can hang in CI | Use `waitForPageStable()` |
| `specs/auth.unauth.spec.ts` | 42, 95, 113 | `.catch(() => {})` in Promise.race | Use `waitForState()` |
| `specs/02-search-generate/search-generate.spec.ts` | 160 | `waitForTimeout(3000)` | Use error/content state detection |

### Already Well-Structured (No Changes Needed)
- `viewing.spec.ts` - Uses `waitForLibraryReady()` properly with typed returns
- `tags.spec.ts` - Uses same proper patterns
- `regenerate.spec.ts` - Uses condition-based waiting

---

## Implementation Plan

### Phase 1: Create Reusable Wait Utilities

**New file:** `src/__tests__/e2e/helpers/wait-utils.ts`

```typescript
import { Page } from '@playwright/test';

interface WaitOptions {
  timeout?: number;
  pollInterval?: number;
}

/**
 * Wait for one of multiple possible states
 * Returns which state was reached - replaces Promise.race with silent catches
 */
export async function waitForState<T extends string>(
  page: Page,
  states: Record<T, () => Promise<boolean>>,
  options: WaitOptions = {}
): Promise<T | 'timeout'> {
  const { timeout = 10000, pollInterval = 100 } = options;
  const startTime = Date.now();
  const stateNames = Object.keys(states) as T[];

  while (Date.now() - startTime < timeout) {
    for (const stateName of stateNames) {
      if (await states[stateName]()) return stateName;
    }
    await page.waitForTimeout(pollInterval);
  }
  return 'timeout';
}

/**
 * Wait for route to be registered before navigation
 * Replaces waitForTimeout(100) after mock setup
 */
export async function waitForRouteReady(page: Page): Promise<void> {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(undefined))));
}

/**
 * Wait for page to stabilize without networkidle
 * Replaces networkidle which can hang in CI
 */
export async function waitForPageStable(
  page: Page,
  options: WaitOptions = {}
): Promise<void> {
  const { timeout = 10000 } = options;
  await page.waitForLoadState('domcontentloaded');

  const loadingIndicators = [
    '[data-testid="loading-indicator"]',
    '[data-testid="library-loading"]',
    '.animate-spin',
    '[aria-busy="true"]',
  ];

  for (const indicator of loadingIndicators) {
    const locator = page.locator(indicator);
    if (await locator.isVisible({ timeout: 100 }).catch(() => false)) {
      await locator.waitFor({ state: 'hidden', timeout }).catch(() => {});
    }
  }
}
```

### Phase 2: Fix High-Priority Files

#### 2.1 `errors.spec.ts` Changes

```typescript
// Line 48 & 109 - Replace:
await page.waitForTimeout(100);
// With:
await waitForRouteReady(page);

// Lines 28-37 - Replace Promise.race pattern:
// BEFORE:
await Promise.race([
  page.locator('.bg-red-100').waitFor({ state: 'visible', timeout: 10000 }),
  page.locator('[data-testid="explanation-content"]').waitFor({ state: 'visible', timeout: 10000 }),
]).catch(() => {});
const hasContent = await resultsPage.hasContent().catch(() => false);

// AFTER:
const state = await waitForState(page, {
  error: async () => await page.locator('.bg-red-100').isVisible(),
  content: async () => await page.locator('[data-testid="explanation-content"]').isVisible(),
}, { timeout: 10000 });
const hasContent = state === 'content';
```

#### 2.2 `auth.unauth.spec.ts` Changes

```typescript
// Line 34 - Replace networkidle:
// BEFORE:
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

// AFTER:
await waitForPageStable(page, { timeout: 10000 });

// Lines 37-42 - Replace Promise.race:
// BEFORE:
const hasRedirectedOrError = await Promise.race([
  page.waitForURL(/\/(login|auth)/, { timeout: 3000 }).then(() => 'redirected'),
  page.waitForSelector('.bg-red-100', { timeout: 3000 }).then(() => 'error'),
  ...
]).catch(() => 'timeout');

// AFTER:
const state = await waitForState(page, {
  redirected: async () => /\/(login|auth)/.test(page.url()),
  error: async () => await page.locator('.bg-red-100').isVisible(),
  loginPrompt: async () => await page.locator('text=/log in|sign in/i').isVisible(),
}, { timeout: 10000 });
```

#### 2.3 `search-generate.spec.ts` Changes

```typescript
// Lines 158-164 - Replace 3-second wait:
// BEFORE:
await page.waitForTimeout(3000);
const hasContent = await resultsPage.hasContent().catch(() => false);

// AFTER:
const state = await waitForState(page, {
  error: async () => await page.locator('.bg-red-100').isVisible(),
  content: async () => await resultsPage.hasContent(),
}, { timeout: 10000 });
const hasContent = state === 'content';
```

### Phase 3: Add Test Data Seeding

**New file:** `src/__tests__/e2e/helpers/seed-test-data.ts`

```typescript
import { createClient } from '@supabase/supabase-js';

export async function seedTestExplanation(userId: string): Promise<{ explanationId: number }> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check if test data exists
  const { data: existing } = await supabase
    .from('userLibrary')
    .select('explanationid')
    .eq('userid', userId)
    .limit(1);

  if (existing?.length) {
    return { explanationId: existing[0].explanationid };
  }

  // Create minimal test explanation
  const { data: explanation } = await supabase
    .from('explanations')
    .insert({
      explanation_title: 'E2E Test Explanation',
      content: '# Test Content\n\nCreated for E2E tests.',
      status: 'published',
    })
    .select()
    .single();

  await supabase.from('userLibrary').insert({
    explanationid: explanation.id,
    userid: userId,
  });

  return { explanationId: explanation.id };
}
```

**Modify:** `setup/auth.setup.ts` - Add seeding after auth

```typescript
// After line 28 (after storageState save)
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const userId = await getUserIdFromCookies(page);
  if (userId) {
    await seedTestExplanation(userId);
  }
}
```

---

## Files to Modify

| File | Action |
|------|--------|
| `src/__tests__/e2e/helpers/wait-utils.ts` | CREATE - reusable utilities |
| `src/__tests__/e2e/helpers/seed-test-data.ts` | CREATE - test data seeding |
| `src/__tests__/e2e/specs/05-edge-cases/errors.spec.ts` | MODIFY - replace waits & catches |
| `src/__tests__/e2e/specs/auth.unauth.spec.ts` | MODIFY - remove networkidle, fix catches |
| `src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts` | MODIFY - replace 3s wait |
| `src/__tests__/e2e/setup/auth.setup.ts` | MODIFY - add seeding call |

---

## Implementation Order

1. **Create `wait-utils.ts`** - foundation for all fixes
2. **Fix `errors.spec.ts`** - highest flakiness impact (route timing + error handling)
3. **Fix `auth.unauth.spec.ts`** - removes networkidle which causes CI hangs
4. **Fix `search-generate.spec.ts`** - removes 3-second arbitrary wait
5. **Create `seed-test-data.ts`** - test data seeding utility
6. **Modify `auth.setup.ts`** - integrate seeding

---

## Validation

After implementation:
1. Run `npm run test:e2e -- --retries=0` to verify no flakiness
2. Grep for remaining `waitForTimeout` (should only be in wait-utils.ts)
3. Grep for `networkidle` (should be 0 occurrences)
4. Verify CI passes without retries
