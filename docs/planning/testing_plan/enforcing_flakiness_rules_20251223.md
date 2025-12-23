# Enforcing Flakiness Rules - 2025-12-23

## Current State Assessment

Assessed test setup against `/docs/docs_overall/testing_rules.md`. Overall infrastructure is well-designed with proper patterns, but specific violations exist.

---

## Rule Compliance Summary

| Rule | Status | Notes |
|------|--------|-------|
| 1. Known state per test | ✅ Pass | `createTestContext()` + cleanup pattern |
| 2. No fixed sleeps | ⚠️ 9 violations | E2E tests using `waitForTimeout` |
| 3. Stable selectors | ✅ Pass | 45 `data-testid` in components |
| 4. Async explicit | ✅ Pass | Proper `waitFor`, `waitForURL` patterns |
| 5. Isolate externals | ✅ Pass | Comprehensive mocks for OpenAI, Supabase, Pinecone |
| 6. Timeouts ≤60s | ⚠️ 4 violations | Tests using 90s timeouts |

---

## Violations to Fix

### Rule 2: Fixed Sleep Violations

| File | Line | Current | Fix |
|------|------|---------|-----|
| `state-management.spec.ts` | 75 | `waitForTimeout(500)` | Wait for specific element state |
| `state-management.spec.ts` | 113 | `waitForTimeout(300)` | Wait for specific element state |
| `state-management.spec.ts` | 117 | `waitForTimeout(300)` | Wait for specific element state |
| `state-management.spec.ts` | 158 | `waitForTimeout(500)` | Wait for specific element state |
| `state-management.spec.ts` | 198 | `waitForTimeout(500)` | Wait for specific element state |
| `import-articles.spec.ts` | 208 | `waitForTimeout(500)` | Wait for import completion indicator |
| `error-recovery.spec.ts` | 177 | `waitForTimeout(3000)` | Wait for error state to appear |
| `error-recovery.spec.ts` | 249 | `waitForTimeout(5000)` | Wait for recovery state |
| `user-interactions.spec.ts` | 81 | `setTimeout(1000)` | Wait for UI update |
| `user-interactions.spec.ts` | 105 | `waitForTimeout(100)` | Wait for element visibility |

### Rule 6: Timeout Violations (>60s)

| File | Line | Current | Action |
|------|------|---------|--------|
| `content-boundaries.spec.ts` | 148 | `test.setTimeout(90000)` | Investigate slowness, reduce to 60s |
| `import-articles.spec.ts` | 81 | `test.setTimeout(90000)` | Investigate slowness, reduce to 60s |
| `import-articles.spec.ts` | 128 | `test.setTimeout(90000)` | Investigate slowness, reduce to 60s |
| `action-buttons.spec.ts` | 18 | `test.setTimeout(90000)` | Investigate slowness, reduce to 60s |

---

## Implementation Plan

### Phase 1: Fix Fixed Sleeps (High Priority)

1. **state-management.spec.ts** - Replace all 5 `waitForTimeout` with:
   - `await expect(element).toBeVisible()`
   - `await page.waitForSelector('[data-testid="..."]')`
   - Use existing `waitForState()` helper from `wait-utils.ts`

2. **error-recovery.spec.ts** - Replace 3s/5s sleeps with:
   - Wait for error message element: `await expect(errorMessage).toBeVisible()`
   - Wait for loading state to complete: `await expect(spinner).toBeHidden()`

3. **user-interactions.spec.ts** - Replace sleeps with:
   - Element visibility checks
   - Network request completion via `page.waitForResponse()`

4. **import-articles.spec.ts** - Replace 500ms sleep with:
   - Wait for import success indicator

### Phase 2: Reduce Timeouts (Medium Priority)

For each 90s timeout test:
1. Profile test to identify bottleneck
2. If real slowness: optimize the underlying operation
3. If waiting incorrectly: fix wait conditions
4. Only if truly necessary: document exception

### Phase 3: Prevent Future Violations

1. **Add ESLint rule** to flag:
   - `waitForTimeout` in test files
   - `setTimeout` in test files (except mocks)
   - `test.setTimeout` values > 60000

2. **Update CI** to fail on new violations

3. **Add to CLAUDE.md** testing guidelines

---

## Files to Modify

```
src/__tests__/e2e/specs/06-ai-suggestions/state-management.spec.ts
src/__tests__/e2e/specs/06-ai-suggestions/error-recovery.spec.ts
src/__tests__/e2e/specs/06-ai-suggestions/user-interactions.spec.ts
src/__tests__/e2e/specs/06-import/import-articles.spec.ts
src/__tests__/e2e/specs/06-ai-suggestions/content-boundaries.spec.ts
src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts
```

---

## Success Criteria

- [ ] Zero `waitForTimeout` calls in E2E tests
- [ ] All test timeouts ≤ 60s
- [ ] ESLint rule preventing new violations
- [ ] All tests pass without flakiness
