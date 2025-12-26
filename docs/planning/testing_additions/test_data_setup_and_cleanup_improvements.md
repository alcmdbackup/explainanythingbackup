# Test Data Setup and Cleanup Improvements

## E2E Test Data Management Approaches

### Option 1: Pre-seeded Static Data
**How:** Maintain a fixed dataset in the database that tests rely on.

| Pros | Cons |
|------|------|
| Simple setup, no runtime data creation | Tests coupled to specific data state |
| Fast test execution | Fragile - data changes break tests |
| No cleanup needed | Can't test edge cases easily |
| | Parallel test runs conflict |

**Why this doesn't work for our codebase:**

1. **Parallel Test Execution Conflicts** - Playwright runs tests in parallel. Two tests modifying the same pre-seeded explanation simultaneously causes race conditions and flaky tests.

2. **Test Isolation Broken** - Test A saves an explanation to library, Test B checks library count and fails because Test A's side effect is visible.

3. **CI Environment Problem** - Supabase instance is shared. Pre-seeded data would need to exist in remote DB before CI runs. Who seeds it? When? What if it gets corrupted?

4. **Can't Test Edge Cases** - Testing "user with 100 saved items" or "explanation with no tags" requires pre-seeding every scenario. Dataset becomes unwieldy.

5. **Data Drift** - Schema changes (like link_whitelist tables) require updating seed data. Easy to forget, tests break mysteriously.

**When Option 1 works:** Read-only tests against truly static reference data, small stable datasets, single-threaded execution, local-only testing with easy DB reset.

---

### Option 2: Per-Test Data Creation + Cleanup
**How:** Each test creates its own data via API/DB, cleans up after.

| Pros | Cons |
|------|------|
| Tests are isolated and repeatable | Slower - DB round-trips per test |
| Can test any scenario | Cleanup failures leave orphans |
| Parallel-safe with unique testIds | Needs service role key in E2E context |
| Tests document their data needs | More code to maintain |

---

### Option 3: Database Snapshots/Reset
**How:** Restore DB to known state before each test run (or suite).

| Pros | Cons |
|------|------|
| Guaranteed clean state | Slow restore for large DBs |
| No orphan data possible | Can't run tests in parallel |
| Simple mental model | Requires DB admin access |
| | Supabase cloud doesn't support easy snapshots |

---

### Option 4: Transactional Rollback
**How:** Wrap each test in a transaction, rollback after.

| Pros | Cons |
|------|------|
| Perfect isolation | Doesn't work across network boundaries |
| Fast (no actual commits) | E2E browser can't share test's transaction |
| No cleanup code needed | **Not viable for Playwright + Supabase** |

---

### Option 5: Hybrid - Shared Fixtures + Per-Test Data
**How:** Pre-seed common data (topics, tags), create test-specific records per test.

| Pros | Cons |
|------|------|
| Balance of speed and isolation | More complex setup logic |
| Common fixtures reduce duplication | Need to track what's shared vs per-test |
| Per-test data still isolated | Shared data mutations still risky |

---

### Option 6: Skip Pattern (Current E2E Approach)
**How:** Tests skip if required data doesn't exist.

| Pros | Cons |
|------|------|
| Zero data management code | Tests may never run in CI |
| Works with production-like data | Unreliable, non-deterministic |
| | Can't test specific scenarios |
| | Not really "testing" |

---

## Recommendation

**Option 2 (Per-Test) or Option 5 (Hybrid)** are the realistic choices for Playwright + Supabase.

Given the codebase already has:
- `test-${timestamp}-${random}` pattern in integration tests
- Service role access pattern established
- Factory functions in `database-records.ts`

**Simplest path:** Extend Option 2 to E2E by:
1. Reusing the testId pattern
2. Adding `global-teardown.ts` cleanup
3. Creating E2E-specific factories that use service role

**If performance becomes an issue:** Move to Option 5 by pre-seeding common topics/tags in `global-setup.ts` and only creating explanations per-test.

---

## Current State Assessment

### What's Working Well (Integration Tests)

| Pattern | Location | Notes |
|---------|----------|-------|
| **testId prefix pattern** | `integration-helpers.ts` | `test-${timestamp}-${random}` enables reliable cleanup |
| **Test context abstraction** | `createTestContext()` | Returns supabase client, testId, userId, cleanup function |
| **Cleanup order** | `cleanupTestData()` | Respects FK constraints: junction tables → main tables |
| **Fixture factories** | `database-records.ts` | Good separation of concerns |
| **Service role bypass** | Integration tests | Uses service role key to bypass RLS |

### Integration Test Flow
```
BeforeAll:  setupTestDatabase()     → Creates service-role client, verifies connection
BeforeEach: createTestContext()     → Creates unique testId, userId, cleanup fn
AfterEach:  cleanup()               → Test-specific cleanup via testId
AfterAll:   teardownTestDatabase()  → Global cleanup of all test-* data
```

---

## Issues Requiring Improvement

### 1. E2E Has No Database Cleanup (High Priority)

**Problem**: `global-teardown.ts` is empty. Test data accumulates indefinitely.

**Impact**:
- Database bloat over time
- Failed test runs leave orphaned data
- No mechanism to identify/clean stale test data

---

### 2. E2E Has No Test Data Creation (Medium Priority)

**Problem**: E2E tests rely on pre-existing library data or skip entirely.

**Impact**:
- Tests are unreliable (depend on external state)
- Can't test specific data scenarios
- "Library loading" pattern is a workaround, not a solution

---

### 3. Shared E2E Auth State (Medium Priority)

**Problem**: Single `.auth/user.json` shared by all authenticated tests.

**Impact**:
- Risk of cross-test contamination if auth state modified
- Can't test multi-user scenarios
- Session changes in one test affect others

---

### 4. Integration Cleanup Fails Silently (Low Priority)

**Problem**: Errors in cleanup are logged but not thrown.

**Impact**:
- Cleanup failures go unnoticed
- Data accumulates if cleanup consistently fails

---

## Critical Gaps

### Gap #1: Missing Tables in Cleanup (High Severity)

Cleanup only covers 5 tables but codebase has **17 tables** that tests interact with.

**Tables covered:** topics, explanations, tags, explanation_tags, userLibrary

**Missing tables:**

| Table | Impact | FK Relationship |
|-------|--------|-----------------|
| `userQueries` | High | → explanations.id |
| `userExplanationEvents` | High | → explanationid |
| `explanationMetrics` | High | → explanationid |
| `link_whitelist` | Medium | Root table |
| `link_whitelist_aliases` | Medium | → link_whitelist.id CASCADE |
| `article_heading_links` | Medium | → explanations.id CASCADE |
| `article_link_overrides` | Medium | → explanations.id CASCADE |
| `link_whitelist_snapshot` | Low | Singleton (id=1) |
| `link_candidates` | Medium | → explanations.id SET NULL |
| `candidate_occurrences` | Medium | → link_candidates, explanations CASCADE |
| `source_cache` | Medium | Root table |
| `article_sources` | Medium | → explanations, source_cache CASCADE |
| `llmCallTracking` | Low | → userid (RLS) |
| `testing_edits_pipeline` | Low | → explanation_id |

---

### Gap #2: Complete FK-Respecting Cleanup Order

```
Phase 1 - Junction/leaf tables:
  - explanation_tags (→ explanations, tags)
  - candidate_occurrences (→ link_candidates, explanations)
  - article_sources (→ explanations, source_cache)
  - link_whitelist_aliases (→ link_whitelist)

Phase 2 - Tables referencing explanations:
  - userLibrary (→ explanations)
  - userQueries (→ explanations)
  - userExplanationEvents (→ explanations)
  - explanationMetrics (→ explanations)
  - article_heading_links (→ explanations, CASCADE)
  - article_link_overrides (→ explanations, CASCADE)
  - testing_edits_pipeline (→ explanations)

Phase 3 - Main tables:
  - explanations (→ topics, CASCADE deletes children)
  - link_candidates (→ explanations SET NULL)
  - topics
  - tags
  - link_whitelist
  - source_cache
  - llmCallTracking

Phase 4 - Snapshots:
  - link_whitelist_snapshot (singleton, may not need cleanup)
```

---

### Gap #3: E2E Test User ID Not Available

The recommended factory uses `process.env.TEST_USER_ID` but this value is not currently available.

**Options:**
1. Add `TEST_USER_ID` env var with authenticated user's UUID (recommended)
2. Extract user_id from saved auth state (parse JWT)
3. Query Supabase auth after login

---

### Gap #4: Per-Table Cleanup Strategies

Title pattern `.ilike('title', '%test-%')` won't work for all tables:

| Table | Identifiable Field | Cleanup Strategy |
|-------|-------------------|------------------|
| `userQueries` | `searchTerm` | `.ilike('searchTerm', '%test-%')` |
| `userExplanationEvents` | `explanationid` | Delete by explanation_id |
| `explanationMetrics` | `explanationid` | Delete by explanation_id |
| `llmCallTracking` | `userid` | Delete by test user_id |
| `link_whitelist` | `canonical_term` | `.ilike('canonical_term', '%test-%')` |
| `link_candidates` | `surface_form` | `.ilike('surface_form', '%test-%')` |
| `source_cache` | `url` | `.ilike('url', '%test-%')` |

---

## Summary Table

| Issue | Severity | Effort | Recommended Action |
|-------|----------|--------|-------------------|
| E2E no DB cleanup | High | Medium | Add global-teardown.ts cleanup |
| Missing 12 tables in cleanup | High | Medium | Add all tables to cleanup order |
| E2E no data creation | Medium | Medium | Add test-data-factory.ts |
| TEST_USER_ID not available | Medium | Low | Add env var |
| Title pattern incomplete | Medium | Low | Per-table cleanup strategy |
| Shared E2E auth | Medium | Low | Per-test auth reset |
| Silent cleanup failures | Low | Low | Add strict mode option |

---

## Implementation Priority

1. **E2E cleanup infrastructure** - Add all 17 tables with correct FK order
2. **TEST_USER_ID resolution** - Enable E2E test data factory
3. **E2E test data factory** - Enables reliable, isolated tests
4. **Per-table cleanup strategies** - Handle tables without title field
5. **Auth state management** - Prevents cross-contamination
6. **Cleanup verification** - Catches cleanup failures early

---

## Related Files

- `src/testing/utils/integration-helpers.ts` - Integration test setup/cleanup
- `src/__tests__/e2e/setup/global-teardown.ts` - E2E global cleanup (empty)
- `src/__tests__/e2e/setup/auth.setup.ts` - E2E auth state creation
- `playwright.config.ts` - E2E project configuration
- `src/testing/fixtures/database-records.ts` - Test data factories
