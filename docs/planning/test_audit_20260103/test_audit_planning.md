# Test Audit Planning

## 1. Background

The codebase has well-established testing rules in `docs/docs_overall/testing_rules.md` covering 8 key areas: test isolation, no fixed sleeps, stable selectors, explicit async handling, mocked external dependencies, short timeouts (60s max), proper error handling, and no conditional skips. These rules are designed to create reliable, deterministic tests that don't depend on external state or timing.

The E2E test suite uses Playwright with 133+ tests, Page Object Models, custom fixtures for authentication, and comprehensive mocking infrastructure via `api-mocks.ts`. Integration tests use Jest with real Supabase database and mocked OpenAI/Pinecone APIs.

## 2. Problem

An audit of the test codebase revealed significant violations of the testing rules:

1. **Rule 2 (No fixed sleeps):** 10+ instances of `waitForTimeout` and `setTimeout` for fixed delays
2. **Rule 6 (60s max timeout):** 1 test file with 120000ms timeout
3. **Rule 7 (No swallowed errors):** 25+ instances of bare `.catch(() => {})` patterns
4. **Rule 8 (No conditional skips):** 60+ instances of `test.skip()` based on data availability

The most severe issue is Rule 8 - tests skipping when test data isn't available, rather than creating their own test data. This undermines test reliability and coverage.

## 3. Options Considered

### Option A: Fix All Violations (Recommended)
- Remediate all rule violations across the codebase
- Create test data factory patterns for tests that currently skip
- Replace all swallowed errors with `safeWaitFor` from `error-utils.ts`
- **Pros:** Full compliance, improved test reliability
- **Cons:** Larger scope of work

### Option B: Fix Critical Violations Only
- Focus only on Rule 8 (conditional skips) as highest priority
- Leave minor violations (acceptable timeouts) as-is
- **Pros:** Faster to complete
- **Cons:** Doesn't address all issues

### Option C: Document Exceptions
- Update `testing_rules.md` with documented exceptions for acceptable patterns
- Only fix true violations
- **Pros:** Recognizes legitimate use cases
- **Cons:** May mask real issues

**Selected: Option A** - Full remediation with documented acceptable patterns

## 4. Phased Execution Plan

### Phase 0: Audit `test.slow()` Usage (NEW)
**Priority: High | Files: 7+**

All AI suggestions tests use `if (testInfo.retry === 0) test.slow()` which gives 3x timeout on first run. This masks performance issues and should be audited.

**Action:** Review all 59 `test.slow()` calls and:
- Remove if test can run within normal timeout with proper waits
- Document if genuinely slow operation requires it

### Phase 1: Document Acceptable Patterns (Non-breaking)
Update `testing_rules.md` to document acceptable uses of patterns that appear to violate rules:

**Acceptable setTimeout uses:**
- API delay simulation in mocks (testing debounce/throttle)
- Streaming chunk simulation in integration tests
- Polling loops with observable exit conditions

**Changes to make:**
- Update `docs/docs_overall/testing_rules.md` with clarifications

### Phase 2: Fix Timeout Violations
**Priority: Low | Files: 1**

| File | Change |
|------|--------|
| `specs/debug-publish-bug.spec.ts:13` | Reduce `test.setTimeout(120000)` to `test.setTimeout(60000)` |

### Phase 3: Fix Fixed Sleep Violations
**Priority: Medium | Files: 2**

| File | Line | Current | Replacement |
|------|------|---------|-------------|
| `ResultsPage.ts` | 78 | `waitForTimeout(1000)` | Remove or replace with observable condition |
| `suggestions-test-helpers.ts` | 299, 308 | `waitForTimeout(500)` | Wait for Done button visibility directly |

**Code snippet for suggestions-test-helpers.ts fix:**
```typescript
// Before:
await editButton.click({ force: true });
await page.waitForTimeout(500);

// After:
await editButton.click({ force: true });
await page.waitForSelector('[data-testid="edit-button"]:has-text("Done")', {
  state: 'visible',
  timeout: 3000
});
```

### Phase 4: Fix Swallowed Errors
**Priority: Medium | Files: 6**

Replace bare `.catch(() => {})` with `safeWaitFor` or `safeIsVisible` from `error-utils.ts`.

**CRITICAL: Correct API Signatures (from error-utils.ts review):**
```typescript
// safeWaitFor signature:
safeWaitFor(
  locator: Locator,
  state: 'visible' | 'hidden' | 'attached' | 'detached',  // String, NOT object
  context: string,
  timeout: number = 10000
): Promise<boolean>

// safeIsVisible signature:
safeIsVisible(
  locator: Locator,
  context: string,
  timeout: number = 100
): Promise<boolean>
```

**Page Object Models:**
| File | Lines | Current | Replacement |
|------|-------|---------|-------------|
| `ImportPage.ts` | 194-197 | `.catch(() => {})` | `safeWaitFor()` with context |
| `UserLibraryPage.ts` | 14, 20 | `.catch(() => {})` | `safeWaitFor()` with context |
| `ResultsPage.ts` | 75-78 | `.catch(() => {})` | `safeWaitFor()` or remove fallback |
| `SearchPage.ts` | 76 | `.catch(() => false)` | `safeIsVisible()` |

**Correct usage example:**
```typescript
// Before:
await page.locator('[data-testid="library-loading"]')
  .waitFor({ state: 'detached', timeout: 30000 })
  .catch(() => {});

// After:
import { safeWaitFor } from '../../helpers/error-utils';
await safeWaitFor(
  page.locator('[data-testid="library-loading"]'),
  'detached',                                    // State as bare string
  'Library loading indicator to disappear',     // Context for logging
  30000                                          // Timeout as separate param
);
```

**Spec files:**
| File | Lines | Fix |
|------|-------|-----|
| `error-recovery.spec.ts` | 192, 273 | `safeWaitFor()` |
| `state-management.spec.ts` | 80, 172, 220 | `safeWaitFor()` |
| `library.spec.ts` | 24, 35-37, 57, 75, 94, 148 | `safeIsVisible()` |

### Phase 5: Fix Conditional Skips (Major - Phased Rollout)
**Priority: High | Files: 12 | Tests: 60+**

This is the most significant change. Tests should create their own test data using `test-data-factory.ts` instead of skipping when data isn't available.

**CRITICAL: Correct Pattern (from test-data-factory.ts review):**

The factory uses direct Supabase calls with service role key, NOT browser fixtures. `beforeAll` does NOT receive fixtures in Playwright.

```typescript
// CORRECT pattern using test-data-factory.ts:
import { createTestExplanationInLibrary, TestExplanation } from '../../helpers/test-data-factory';

test.describe('AI Suggestions', () => {
  let testExplanation: TestExplanation;  // Store full object, not just ID

  test.beforeAll(async () => {
    // NO fixtures here - factory uses direct Supabase calls
    testExplanation = await createTestExplanationInLibrary({
      title: 'Test Explanation for AI Suggestions',
      content: '<p>Test content for AI suggestions testing</p>',
    });
  });

  test.afterAll(async () => {
    // Use the cleanup method on the object, NOT cleanupTestExplanations([id])
    await testExplanation.cleanup();
  });

  test('should do something', async ({ authenticatedPage: page }) => {
    // Navigate directly to the test explanation
    await page.goto(`/results?explanation_id=${testExplanation.id}`);
    // ... test logic (no skip needed!)
  });
});
```

**Required Environment Variables:**
- `SUPABASE_SERVICE_ROLE_KEY` - Already configured in CI (ci.yml lines 62, 94, 156)
- `TEST_USER_ID` - Already configured in CI (ci.yml lines 62, 94, 156)

**Pre-execution Validation:**
Before starting Phase 5, run this validation script to ensure environment is properly configured:
```bash
# Verify env vars are set (uses same dotenv path as global-setup.ts)
# Using npx tsx for ESM compatibility (project uses module:esnext)
npx tsx -e "
  const dotenv = require('dotenv');
  const path = require('path');
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
  const missing = [];
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.TEST_USER_ID) missing.push('TEST_USER_ID');
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (missing.length) {
    console.error('❌ Missing required env vars:', missing.join(', '));
    process.exit(1);
  }
  console.log('✅ All required environment variables are set');
"
```

**Security Note:**
- `.env.test` contains example API keys but is gitignored (`.env*` pattern in `.gitignore`)
- Verified: `.env.test` was NEVER committed to git history
- Real secrets are in `.env.local` (also gitignored) and CI secrets

#### Phase 5a: Pilot with save-blocking.spec.ts (4 tests)
**Smallest file, lowest risk for validating the pattern**

1. Refactor `save-blocking.spec.ts` to use `beforeAll` + `createTestExplanationInLibrary`
2. Remove all `test.skip(libraryState !== 'loaded')` calls
3. Run tests multiple times to verify stability
4. Address any issues discovered

**Pilot Success Criteria (MUST ALL PASS):**
| Criterion | Requirement | Command to Verify |
|-----------|-------------|-------------------|
| Reliability | 5/5 consecutive runs pass | `for i in {1..5}; do npx playwright test save-blocking.spec.ts; done` |
| No skips | 0 tests skipped | Check Playwright output for "skipped" |
| Performance | Each test completes in <30s | Check Playwright timing output |
| Cleanup | No orphaned data after 5 runs | `SELECT COUNT(*) FROM explanations WHERE explanation_title LIKE 'test-%'` |
| CI passes | GitHub Actions E2E job passes | Push to branch, verify CI |

**Pilot Failure Criteria (ANY = STOP):**
| Criterion | What to Do |
|-----------|------------|
| Any flaky test (passes sometimes, fails sometimes) | Debug root cause before proceeding |
| Factory throws "TEST_USER_ID is required" | Fix env var configuration |
| Orphaned test data accumulates | Fix global teardown or factory cleanup |
| Tests take >60s each | Review and optimize waits |
| CI fails with new pattern | Debug before rollout |

**If pilot fails:** Do NOT proceed to Phase 5b. Fix issues and re-run pilot.

#### Phase 5b: Roll out to remaining 11 files

After pilot is stable, apply pattern to:
1. `specs/06-ai-suggestions/user-interactions.spec.ts` (5 tests)
2. `specs/06-ai-suggestions/suggestions.spec.ts` (23 tests)
3. `specs/06-ai-suggestions/editor-integration.spec.ts` (6 tests)
4. `specs/06-ai-suggestions/error-recovery.spec.ts` (6 tests)
5. `specs/06-ai-suggestions/content-boundaries.spec.ts` (6 tests)
6. `specs/06-ai-suggestions/state-management.spec.ts` (6 tests)
7. `specs/04-content-viewing/viewing.spec.ts` (10 tests)
8. `specs/04-content-viewing/tags.spec.ts` (16 tests)
9. `specs/04-content-viewing/action-buttons.spec.ts` (20 tests)
10. `specs/03-library/library.spec.ts` (7 tests)
11. `specs/02-search-generate/regenerate.spec.ts` (4 tests)

#### Phase 5c: Add empty library state tests

Currently the conditional skip accidentally tests empty library. Add explicit tests:
- `library.spec.ts`: Test for empty library UI state
- Test for library with 100+ items (pagination)

### Phase 6: Review Static Skips
**Priority: Low | Files: 3**

Review statically skipped tests and either:
- Fix the underlying issue and un-skip
- Document why they must remain skipped

| File | Test | Decision |
|------|------|----------|
| `auth.unauth.spec.ts:226` | localStorage auth test | Investigate Supabase storage behavior |
| `auth.unauth.spec.ts:244` | sessionStorage auth test | Investigate Supabase storage behavior |
| `auth.spec.ts:37` | logout test | Investigate server action testing |
| `search-generate.spec.ts:124` | auto-assign tags | May need tag API mocking |
| `search-generate.spec.ts:141` | save button enable | Check if covered elsewhere |

### Phase 7: Address Inline Skip Patterns (NEW)
**Priority: Medium | Files: 3+**

The codebase has TWO skip patterns. Phase 5 addresses pattern 1 but not pattern 2:

```typescript
// Pattern 1 (addressed in Phase 5):
test.skip(libraryState !== 'loaded', 'reason');

// Pattern 2 (NOT addressed):
if (state === 'empty') { test.skip(); return; }
```

**Files with Pattern 2:**
- `tags.spec.ts`
- `library.spec.ts`
- `action-buttons.spec.ts`

**Remediation Strategy for Pattern 2:**

Pattern 2 is used inside individual tests, typically checking for specific conditions. The fix is the same as Pattern 1 - use test-data-factory to ensure the condition is met.

```typescript
// BEFORE (Pattern 2):
test('should show tag options', async ({ authenticatedPage: page }) => {
  const libraryPage = new UserLibraryPage(page);
  await libraryPage.navigate();
  const state = await libraryPage.waitForLibraryReady();

  if (state === 'empty') {
    test.skip();  // ❌ Skips when no data
    return;
  }

  // Test logic...
});

// AFTER (with test-data-factory):
test.describe('Tag Options', () => {
  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    testExplanation = await createTestExplanationInLibrary({
      title: 'Test Explanation for Tag Options',
    });
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  test('should show tag options', async ({ authenticatedPage: page }) => {
    await page.goto(`/results?explanation_id=${testExplanation.id}`);
    // Test logic - no skip needed!
  });
});
```

**Note:** Pattern 2 requires restructuring tests into describe blocks with beforeAll/afterAll. This is more invasive than Pattern 1 but follows the same principle.

**Test Isolation Concern - Addressed:**

Wrapping tests in describe blocks with shared beforeAll data does NOT break test isolation:

1. **Each describe block gets its OWN data** - `beforeAll` creates fresh data for that block
2. **Tests within a block are independent** - they read the same data but don't mutate it
3. **If tests need different data** - create multiple describe blocks with different fixtures
4. **Existing retries config moves INSIDE the describe** - not outside

```typescript
// CORRECT: retries config inside describe block
test.describe('Tag Options', () => {
  test.describe.configure({ retries: 2 });  // ← Inside, not outside

  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    testExplanation = await createTestExplanationInLibrary({...});
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  // Multiple tests can use testExplanation - they're isolated because:
  // 1. They navigate to a fresh page state each time (authenticatedPage fixture)
  // 2. They read testExplanation.id but don't modify it
  // 3. Each test gets its own browser context via the fixture
  test('test 1', async ({ authenticatedPage: page }) => {...});
  test('test 2', async ({ authenticatedPage: page }) => {...});
});
```

**Key insight:** Test isolation comes from the `authenticatedPage` fixture (fresh browser context), not from having separate data. Tests sharing read-only data is fine.

## 5. Testing

### Validation for Each Phase
1. Run `npm run test:e2e:critical` - Critical path tests
2. Run `npm run test:e2e` - Full E2E suite
3. Run `npm run test:integration` - Integration tests
4. Verify no new skipped tests appear
5. Verify test count remains same or increases
6. **NEW:** Run tests 3x to check for flakiness

### Phase 5 Specific Validation
1. Run `npx playwright test specs/06-ai-suggestions/save-blocking.spec.ts` 5 times
2. Verify all 4 tests pass consistently
3. Check database for orphaned test data after runs

### Manual Verification
- Run E2E tests on staging environment
- Verify no flaky tests introduced

## 6. Documentation Updates

### Files to Update
- `docs/docs_overall/testing_rules.md` - Add clarifications for acceptable patterns
- `src/__tests__/e2e/E2E_TESTING_PLAN.md` - Update patterns section
- `src/__tests__/integration/README.md` - Add note about acceptable setTimeout usage

## 7. Code Files Modified

### Helpers/Utilities
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts`
- `src/__tests__/e2e/helpers/pages/ImportPage.ts`
- `src/__tests__/e2e/helpers/pages/UserLibraryPage.ts`
- `src/__tests__/e2e/helpers/pages/SearchPage.ts`
- `src/__tests__/e2e/helpers/suggestions-test-helpers.ts`

### Spec Files
- `src/__tests__/e2e/specs/debug-publish-bug.spec.ts`
- `src/__tests__/e2e/specs/02-search-generate/regenerate.spec.ts`
- `src/__tests__/e2e/specs/03-library/library.spec.ts`
- `src/__tests__/e2e/specs/04-content-viewing/viewing.spec.ts`
- `src/__tests__/e2e/specs/04-content-viewing/tags.spec.ts`
- `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts`
- `src/__tests__/e2e/specs/06-ai-suggestions/*.spec.ts` (7 files)

### Documentation
- `docs/docs_overall/testing_rules.md`
- `src/__tests__/e2e/E2E_TESTING_PLAN.md`

## 8. Tests Added or Modified

### Modified
All files listed in Phase 5 (60+ tests modified to use test data factory pattern)

### Added
- Empty library state tests (Phase 5c)
- Pagination tests for library with many items

### E2E Tests to Run
```bash
npm run test:e2e           # Full suite
npm run test:e2e:critical  # Critical path only
```

### Integration Tests to Run
```bash
npm run test:integration
```

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| `cleanupTestExplanations` API uses objects, not IDs | Use `TestExplanation.cleanup()` method directly |
| `safeWaitFor` has different signature than planned | Use correct signature: `(locator, state, context, timeout)` |
| `beforeAll` doesn't receive fixtures | Factory uses direct Supabase calls, no fixtures needed |
| test-data-factory.ts is currently unused | Pilot with one file (Phase 5a) before mass rollout |
| Tests become slower with data creation | Create data in beforeAll, not beforeEach |
| Database conflicts between parallel tests | Factory uses `generateTestPrefix()` with timestamp+random |
| Flaky tests during migration | Run tests 3-5x during development |
| afterAll cleanup may not run if tests crash | Global teardown already cleans via userLibrary→explanation cascade (see below) |

**Global Teardown Analysis:**

The existing `global-teardown.ts` handles test-data-factory cleanup correctly:

1. **User-specific data**: Deleted via `userLibrary.delete().eq('userid', testUserId)` (line 36)
2. **Explanation cascade**: Gets explanation IDs from userLibrary BEFORE deletion, then deletes explanations (lines 27-31, 56)
3. **Pattern cleanup**: `test-%` prefixed topics, tags, testing_edits_pipeline (lines 65-69)

**Gap identified:** Factory creates explanations with `test-TIMESTAMP-RANDOM` titles, but cleanup relies on userLibrary junction table. If factory creates an explanation WITHOUT adding to userLibrary, it won't be cleaned.

**Verification needed:** Confirm `createTestExplanationInLibrary()` (which we use) creates the userLibrary entry. ✅ Verified at line 92: `supabase.from('userLibrary').insert({...})`

**Conclusion:** No global-teardown.ts changes needed - the factory pattern IS compatible with existing cleanup

### Global Setup vs Test-Data-Factory Coexistence

**Current State:**
- `global-setup.ts` seeds ONE shared fixture: `e2e-test-quantum-physics` (lines 252-262)
- This fixture is used by tests that just need "some" content to exist
- `test-data-factory.ts` creates ISOLATED fixtures with `test-TIMESTAMP-RANDOM` prefixes

**Design Decision:**
These two patterns serve DIFFERENT purposes and should COEXIST:

| Pattern | Purpose | When to Use |
|---------|---------|-------------|
| Global shared fixture (`e2e-test-*`) | Fallback for tests not yet migrated | Existing tests with `libraryState === 'loaded'` check |
| Test-data-factory (`test-TIMESTAMP-*`) | Isolated, deterministic data per test | New pattern after migration |

**No Conflict Because:**
1. Different prefixes: `e2e-test-` vs `test-TIMESTAMP-`
2. Global fixture is idempotent (upsert) - runs once, reuses
3. Factory fixtures are unique per test run (timestamp + random)
4. Cleanup handles both: teardown cleans by userLibrary → explanation cascade

**Migration Strategy:**
1. Keep global-setup.ts unchanged during Phase 5
2. Tests using factory will have their OWN data, ignoring global fixture
3. After ALL tests migrated (Phase 5b complete + stable), consider removing global-setup seeding
4. But leave global-setup for backward compatibility - it's harmless
| Missing rollback strategy | See "Rollback Decision Criteria" section below |

## 11. Rollback Decision Criteria

### When to Rollback

| Trigger | Action |
|---------|--------|
| CI fails 3+ consecutive runs with new pattern | Revert to old pattern, debug offline |
| >10% test flakiness after rollout | Revert affected files, investigate |
| Database pollution (orphaned test data) | Revert + fix global-teardown.ts |
| Test runtime doubles (>2x baseline) | Revert + optimize before retry |

### How to Rollback

1. **Git revert**: `git revert <commit-hash>` for the specific phase commit
2. **Verify**: Run full E2E suite to confirm old pattern works
3. **Debug**: Create branch to fix issues without blocking main

### Migration Strategy

During Phase 5b rollout, maintain both patterns temporarily:

```
Week 1: Pilot (save-blocking.spec.ts) - new pattern
Week 2: If stable, migrate 3 more files
Week 3: If stable, migrate remaining 8 files
Week 4: Delete old pattern code, finalize
```

**Rollout gate:** Each batch must pass CI 3x before proceeding to next batch.

### Point of No Return

After ALL files migrated and stable for 1 week:
- Delete any commented-out old pattern code
- Update documentation to reflect new pattern as standard
- Close this planning document as complete

## 12. Agent Critique Summary

### Iteration 1 (Original)

Three agents reviewed this plan and identified these issues (now addressed):

1. ✅ **`cleanupTestExplanations([id])` wrong** - Corrected to use `testExplanation.cleanup()`
2. ✅ **`safeWaitFor` signature mismatch** - Corrected to `(locator, state, context, timeout)`
3. ✅ **`beforeAll` doesn't get fixtures** - Corrected pattern shows no fixtures, direct factory call
4. ✅ **test-data-factory is unused** - Added Phase 5a pilot to validate pattern first
5. ✅ **Missing Phase 0 for test.slow()** - Added Phase 0 to audit slow tests
6. ✅ **Missing inline skip pattern** - Added Phase 7 for Pattern 2 skips
7. ✅ **Missing empty library tests** - Added Phase 5c
8. ✅ **Missing rollback strategy** - Added to risks section

### Iteration 2 (Plan Review Loop)

Second review by Security, Architecture, and Testing agents:

**Security & Technical (Score: 2/5 → Fixed):**
1. ✅ **TEST_USER_ID not in .env.test** - Clarified it's in .env.local/CI, added validation script
2. ✅ **Global teardown doesn't clean explanations** - Verified factory IS compatible with existing cleanup
3. ✅ **.env.test contains secrets** - Verified `.env*` is gitignored

**Architecture & Integration (Score: 3/5 → Fixed):**
1. ✅ **No validation that beforeAll + factory works** - Added Phase 5a pilot with explicit success criteria
2. ✅ **Missing Phase 7 implementation pattern** - Added code examples for Pattern 2 remediation
3. ✅ **No env var validation step** - Added pre-execution validation script

**Testing & CI/CD (Score: 3/5 → Fixed):**
1. ✅ **Missing rollback decision criteria** - Added Section 11 with triggers and procedures
2. ✅ **Pilot success metrics undefined** - Added success/failure criteria tables
3. ✅ **Global teardown compatibility** - Verified and documented compatibility

### Iteration 3 (Plan Review Loop)

**Security & Technical (Score: 4/5 → Fixed):**
1. ✅ **ts-node ESM compatibility** - Changed to `npx tsx` with CommonJS require() syntax
2. ✅ **Added NEXT_PUBLIC_SUPABASE_URL** to validation (used by test-data-factory.ts line 24)

**Architecture & Integration (Score: 5/5):** ✅ APPROVED
**Testing & CI/CD (Score: 5/5):** ✅ APPROVED

### Iteration 4 (Final)

**Security & Technical (Score: 5/5):** ✅ APPROVED

All three agents voted 5/5. **CONSENSUS REACHED.**

---

## ✅ PLAN APPROVED FOR EXECUTION

Plan reviewed by 3 agents over 4 iterations. All critical gaps addressed.

| Iteration | Security | Architecture | Testing | Outcome |
|-----------|----------|--------------|---------|---------|
| 1 | 2/5 | 3/5 | 3/5 | Iterate |
| 2 | 2/5 | 3/5 | 5/5 | Iterate |
| 3 | 4/5 | 5/5 | 5/5 | Iterate |
| 4 | **5/5** | **5/5** | **5/5** | **APPROVED** |
