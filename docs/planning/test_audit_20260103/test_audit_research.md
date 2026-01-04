# Test Audit Research

## 1. Problem Statement
Evaluate if the existing E2E and integration tests conform to the testing rules defined in `docs/docs_overall/testing_rules.md`. Identify violations and areas for improvement.

## 2. High Level Summary

The codebase has **238 uses of data-testid** across 27 test files, showing strong selector practices. However, there are significant violations in several rules that need remediation.

### Rule Violations Summary

| Rule | Status | Violations Found |
|------|--------|-----------------|
| Rule 1: Start from known state | ⚠️ PARTIAL | Tests rely on seeded data but have good cleanup patterns |
| Rule 2: Never use fixed sleeps | ❌ VIOLATION | 10+ instances of waitForTimeout and setTimeout |
| Rule 3: Use stable selectors | ✅ COMPLIANT | Strong data-testid usage, no brittle CSS selectors |
| Rule 4: Make async explicit | ✅ MOSTLY COMPLIANT | Good use of waitFor, toPass patterns |
| Rule 5: Isolate external deps | ✅ COMPLIANT | Good mocking via api-mocks.ts |
| Rule 6: Short timeouts (60s max) | ⚠️ VIOLATION | 2 tests with 120000ms timeout |
| Rule 7: Never swallow errors | ❌ VIOLATION | 25+ instances of bare .catch(() => {}) |
| Rule 8: No conditional skips | ❌ VIOLATION | 60+ instances of test.skip for data availability |

## 3. Detailed Findings

### Rule 2: Fixed Sleeps (VIOLATIONS)

**E2E Tests:**
| File | Line | Code | Issue |
|------|------|------|-------|
| `helpers/pages/ResultsPage.ts` | 78 | `await this.page.waitForTimeout(1000)` | Fixed sleep after failed wait |
| `helpers/suggestions-test-helpers.ts` | 228 | `await page.waitForTimeout(100)` | Polling loop (acceptable) |
| `helpers/suggestions-test-helpers.ts` | 299, 308 | `await page.waitForTimeout(500)` | Fixed sleep for React state update |
| `specs/06-ai-suggestions/user-interactions.spec.ts` | 86 | `setTimeout(r, 1000)` | API delay simulation (acceptable) |

**Integration Tests:**
| File | Line | Code | Issue |
|------|------|------|-------|
| `streaming-api.integration.test.ts` | 94, 167 | `setTimeout(resolve, 10)` | Simulating streaming chunks (acceptable) |
| `session-id-propagation.integration.test.ts` | 115 | `setTimeout(r, Math.random() * 10)` | Concurrent test simulation (acceptable) |

### Rule 6: Timeout Violations

| File | Line | Timeout | Max Allowed |
|------|------|---------|-------------|
| `specs/debug-publish-bug.spec.ts` | 13 | 120000ms | 60000ms |

### Rule 7: Swallowed Errors (VIOLATIONS)

**Critical violations in helpers/pages/:**
```typescript
// ImportPage.ts:194-197
.catch(() => {})  // Silently ignores detection indicator failures

// UserLibraryPage.ts:14-20
.catch(() => {})  // Silently ignores loading state failures

// ResultsPage.ts:75-78
.catch(() => {
  // If both fail, just wait a bit and continue
});
```

**Spec files with violations:**
- `specs/06-ai-suggestions/error-recovery.spec.ts` - Lines 192, 273
- `specs/06-ai-suggestions/state-management.spec.ts` - Lines 80, 172, 220
- `specs/03-library/library.spec.ts` - Lines 24, 35-37, 57, 75, 94, 148

### Rule 8: Conditional Skips (MAJOR VIOLATION)

**Pattern found across AI Suggestions tests:**
```typescript
test.skip(libraryState !== 'loaded', 'No saved explanations available');
```

**Files affected (60+ occurrences):**
- `specs/06-ai-suggestions/save-blocking.spec.ts` - 4 tests
- `specs/06-ai-suggestions/user-interactions.spec.ts` - 5 tests
- `specs/06-ai-suggestions/suggestions.spec.ts` - 23 tests
- `specs/06-ai-suggestions/editor-integration.spec.ts` - 6 tests
- `specs/06-ai-suggestions/error-recovery.spec.ts` - 6 tests
- `specs/06-ai-suggestions/content-boundaries.spec.ts` - 6 tests
- `specs/06-ai-suggestions/state-management.spec.ts` - 6 tests
- `specs/04-content-viewing/viewing.spec.ts` - 10 tests
- `specs/04-content-viewing/tags.spec.ts` - 16 tests
- `specs/04-content-viewing/action-buttons.spec.ts` - 20 tests
- `specs/03-library/library.spec.ts` - 7 tests
- `specs/02-search-generate/regenerate.spec.ts` - 4 tests

**Also statically skipped:**
- `specs/auth.unauth.spec.ts` - Lines 226, 244 (localStorage/sessionStorage tests)
- `specs/01-auth/auth.spec.ts` - Line 37 (logout test)
- `specs/02-search-generate/search-generate.spec.ts` - Lines 124, 141 (tag auto-assign, save button)

## 4. Documents Read

- `docs/docs_overall/testing_rules.md` - 8 testing rules
- `src/__tests__/e2e/E2E_TESTING_PLAN.md` - Comprehensive E2E testing documentation
- `src/__tests__/integration/README.md` - Integration test patterns

## 5. Code Files Analyzed

**E2E Test Files:**
- `src/__tests__/e2e/fixtures/auth.ts` - Authentication fixture
- `src/__tests__/e2e/helpers/api-mocks.ts` - API mocking utilities
- `src/__tests__/e2e/helpers/error-utils.ts` - Safe error handling (should be used more)
- `src/__tests__/e2e/helpers/wait-utils.ts` - Wait utilities
- `src/__tests__/e2e/helpers/suggestions-test-helpers.ts` - AI suggestions helpers
- `src/__tests__/e2e/helpers/pages/*.ts` - Page Object Models (5 files)
- `src/__tests__/e2e/specs/**/*.spec.ts` - All spec files (17 files)

**Integration Test Files:**
- `src/__tests__/integration/*.integration.test.ts` - 14 test files
- `src/testing/utils/integration-helpers.ts` - Integration helpers

## 6. Root Cause Analysis

### Conditional Skips Issue
The `test.skip(libraryState !== 'loaded')` pattern violates Rule 8 because tests should:
1. Create their own test data rather than depend on external state
2. Use the test data factory (`helpers/test-data-factory.ts`) to seed explanations

**Root cause:** Tests check if library has saved explanations rather than creating their own.

### Swallowed Errors Issue
The `.catch(() => {})` pattern is used to:
1. Handle optional UI elements that may or may not appear
2. Fallback gracefully when expected states don't materialize

**Root cause:** The `error-utils.ts` file provides safe alternatives but they're not being used consistently.

### Fixed Sleeps Issue
The `waitForTimeout` calls are used to:
1. Wait for React state updates after clicks
2. Handle race conditions in Lexical editor initialization

**Root cause:** Lack of proper observable conditions to wait for.
