# Hide E2E Tests from Staging Plan

## Background
E2E tests create data with `[E2E]` and `[TEST_EVO]` prefixes that aren't filtered by the existing test content filter, causing them to appear in the staging admin UI.

## Problem
The filter functions in `shared.ts` only check for `[TEST]` prefix and exact "test" name. They miss `[E2E]` and `[TEST_EVO]` prefixed content created by E2E tests and the evolution test data factory.

## Phased Execution Plan

### Phase 1: Update filter functions
- [x] Update `isTestContentName()` to detect `[E2E]` and `[TEST_EVO]`
- [x] Update `applyTestContentNameFilter()` to exclude `[E2E]` and `[TEST_EVO]`
- [x] Update `getTestStrategyIds()` query to include `[E2E]` and `[TEST_EVO]`

### Phase 2: Update tests
- [x] Update integration test to cover `[E2E]` prefix filtering

### Phase 3: Verify
- [x] Run lint, tsc, build, and tests
