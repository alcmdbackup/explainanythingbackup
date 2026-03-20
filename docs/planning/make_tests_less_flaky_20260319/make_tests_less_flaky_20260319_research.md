# Make Tests Less Flaky Research

## Problem Statement
Reduce test flakiness across the codebase by identifying and fixing unreliable tests, improving test infrastructure, and adding better wait strategies and isolation patterns. This includes addressing race conditions, improving test data management, and ensuring deterministic test execution in both local and CI environments.

## Requirements (from GH Issue #739)
1. Audit all E2E tests for flakiness patterns (fixed sleeps, networkidle, missing waits)
2. Audit unit/integration tests for race conditions and shared state
3. Fix identified flaky tests with proper wait strategies
4. Improve test isolation (route cleanup, temp files, test data)
5. Add/update ESLint rules for flakiness prevention
6. Update testing documentation with findings

## High Level Summary

Research conducted over 8 rounds with 32 parallel agents. The codebase has a mature test flakiness prevention system (12 rules, 6 ESLint rules, Claude hooks), built over 3 previous projects. Despite this, significant flakiness risks remain.

### Verified Critical Issues
1. **14 E2E test suites use retries but NO serial mode** — shared `beforeAll` state + `fullyParallel: true` causes race conditions when tests MODIFY shared data (tags, editor state, diffs). CONFIRMED REAL with specific data modification evidence.
2. **Route handler stacking in mock helpers** — 9 functions in api-mocks.ts register `page.route()` without unrouting. 5 tests in 3 files call mocks multiple times per test, stacking handlers. CONFIRMED with line-level evidence.
3. **Column name bug** in integration-helpers.ts:106 — uses `explanation_id` but actual column is `explanationid`. CONFIRMED against migration schema. Causes silent cleanup failure.

### Verified High Issues
4. **1 active networkidle call** (admin-arena.spec.ts:281) + 2 in skipped tests
5. **7 POM methods with missing/weak post-action waits** in ResultsPage.ts and ImportPage.ts
6. **Timing-sensitive integration assertions** (100ms, 15s thresholds fail on slow CI)
7. **Module-scoped `titleGenerated` flag** in explanation-generation.integration.test.ts persists across mock invocations
8. **6+ unit test files with unrestored `global.fetch`** assignments that leak between test suites

### Verified Medium Issues
9. Admin spec fragile text-based selectors and `.first()` usage
10. Missing post-action waits in search-generate, import, add-sources, client-logging specs
11. 9 `adminTest.skip()` calls bypass ESLint rule (no eslint-disable comment)
12. Asymmetric test.slow() pattern — 56 AI suggestion tests get 180s on first attempt, 60s on retries
13. 2 tests have conflicting test.slow() + test.setTimeout(60000) that may override each other

### Verified False Positives (from earlier rounds)
- **Global setup race condition (Finding #3):** FALSE POSITIVE — globalSetup runs once before all workers start (Playwright guarantee), so no concurrent execution
- **Auth session caching:** FALSE POSITIVE — each worker is a separate process with isolated module state
- **Global teardown FK ordering:** VERIFIED CORRECT
- **Integration test double-mocking:** FALSE POSITIVE — Jest ignores second jest.mock() on already-mocked modules; tests use global mocks correctly
- **jest.clearAllMocks() not resetting implementations:** FALSE POSITIVE — config has `restoreMocks: true` which handles this automatically
- **wait-utils.ts:** VERIFIED ROBUST

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md — 12 testing rules with enforcement matrix
- docs/feature_deep_dives/testing_setup.md — Four-tier testing strategy, mocking patterns, utilities
- docs/feature_deep_dives/testing_pipeline.md — AI suggestion A/B testing infrastructure

### Historical Projects
- docs/planning/fix_flaky_production_tests_20260224/ — Fixed 6 flaky test files, created networkidle rule, POM waits, temp file isolation
- docs/planning/reduce_flaky_tests_improve_testing_setup_20260307/ — CI caching, ESLint rule tests, no-hardcoded-tmpdir rule
- docs/planning/testing_plan/enforcing_flakiness_rules_20251223.md — Fixed 10 waitForTimeout violations, reduced 90s→60s timeouts

## Code Files Read

### E2E Infrastructure
- playwright.config.ts — fullyParallel:true (non-prod), workers:2, retries:2 (CI), reporters: HTML+JSON
- src/__tests__/e2e/fixtures/base.ts — unrouteAll({behavior:'wait'}) in teardown
- src/__tests__/e2e/fixtures/auth.ts — Per-worker session caching (safe), unrouteAll teardown at line 143
- src/__tests__/e2e/fixtures/admin-auth.ts — unrouteAll teardown at line 155
- src/__tests__/e2e/helpers/wait-utils.ts — waitForState, waitForRouteReady, waitForPageStable (verified robust)
- src/__tests__/e2e/helpers/api-mocks.ts — 9 functions calling page.route() without prior unroute
- src/__tests__/e2e/helpers/suggestions-test-helpers.ts — submitAISuggestionPrompt, no mock teardown
- src/__tests__/e2e/helpers/error-utils.ts — safeWaitFor, safeIsVisible helpers
- src/__tests__/e2e/helpers/test-data-factory.ts — Per-worker ID tracking, append-only format
- src/__tests__/e2e/setup/global-setup.ts — Runs once before workers (verified), seeds shared fixtures
- src/__tests__/e2e/setup/global-teardown.ts — FK ordering verified correct
- src/__tests__/e2e/setup/vercel-bypass.ts — Cookie handling, 55-min staleness threshold

### E2E Page Objects (all 12 POMs audited)
- ResultsPage.ts — 9 silent catches (all with eslint-disable), 7 weak post-action waits
- ImportPage.ts — selectSource() missing post-action wait
- All admin POMs — Mostly compliant

### E2E Spec Files (all 36 specs audited)
- 7 AI suggestion specs — retries:2, NO serial, shared testExplanation, ALL modify shared state (HIGH risk)
- 5 content-viewing specs — retries:1, NO serial, tags/action-buttons MODIFY shared state (HIGH risk)
- viewing.spec.ts, report-content.spec.ts, hidden-content.spec.ts — Read-only shared state (LOW risk)
- library.spec.ts — CORRECTLY uses serial mode (only file that does)
- search-generate.spec.ts — SSE mock timing, production mode branching, 3 Firefox-specific test.slow()
- errors.spec.ts — Only test with defensive page.unrouteAll() before re-mocking
- Admin specs — Shared seeded data without serial mode, fragile selectors, 1 active networkidle

### Jest & Integration
- jest.config.js — clearMocks:true, restoreMocks:true
- jest.integration.config.js — maxWorkers:1, clearMocks:true, restoreMocks:true
- jest.integration-setup.js — afterEach calls clearAllMocks (redundant with config restoreMocks:true)
- explanation-generation.integration.test.ts — titleGenerated module-scoped flag (REAL bug)
- explanation-update.integration.test.ts — Double jest.mock() ignored by Jest (FALSE POSITIVE)
- rls-policies.integration.test.ts — Verified clean isolation

### Unit Tests
- 6+ files with unrestored global.fetch (evolutionRunClient, traces/route, fetchWithTracing, monitoring/route, sessionId, remoteFlusher)
- sourceFetcher.test.ts — CORRECT pattern (stores original, restores in afterEach)

### ESLint & Enforcement
- eslint.config.mjs — 6 flakiness rules applied to E2E files
- eslint-rules/*.js — All 6 rules read completely, gaps identified
- .claude/hooks/check-test-patterns.sh — Edit-time enforcement (rules 7, 8, 9)
- 27 eslint-disable comments across E2E files (all documented with reasons)
- 9 adminTest.skip() calls WITHOUT eslint-disable (rule gap)

### CI Workflows
- .github/workflows/ci.yml — 2 retries, 3-shard parallelism for production, artifact capture
- .github/workflows/e2e-nightly.yml — 3 retries, serial browsers, @skip-prod filtering
- .github/workflows/post-deploy-smoke.yml — @smoke tests against production

## Key Findings

### Finding 1: Missing Serial Mode (CRITICAL — CONFIRMED)

14/15 E2E test suites with `beforeAll` shared state lack `mode: 'serial'`. With `fullyParallel: true` and 2 workers, tests within each describe block CAN run in parallel.

**HIGH-risk files (tests MODIFY shared state):**

| File | Modification | Lines |
|------|-------------|-------|
| tags.spec.ts | removeTag() on shared explanation | 70-95 |
| action-buttons.spec.ts | clickFormatToggle(), selectMode(), clickEditButton() | 190-312 |
| suggestions.spec.ts | enterEditMode(), submitAISuggestionPrompt(), accept/reject diffs | 59-631 |
| save-blocking.spec.ts | enterEditMode(), submitPrompt(), acceptDiff | 51-216 |
| state-management.spec.ts | clickAcceptOnFirstDiff(), undo/redo | 56-316 |
| editor-integration.spec.ts | enterEditMode(), submitPrompt | 60-260 |
| error-recovery.spec.ts | enterEditMode(), submitPrompt | 55-260 |
| content-boundaries.spec.ts | enterEditMode(), submitPrompt, clickAcceptOnFirstDiff | 108-270 |
| user-interactions.spec.ts | enterEditMode(), submitPrompt, clickAcceptOnFirstDiff | 62-250 |

**LOW-risk files (read-only shared state):**
- viewing.spec.ts, report-content.spec.ts, hidden-content.spec.ts, regenerate.spec.ts

**Admin specs (shared seeded data, no serial):**
- admin-arena.spec.ts, admin-content.spec.ts, admin-reports.spec.ts, admin-strategy-budget.spec.ts, admin-strategy-registry.spec.ts

**Retry amplification:** With retries:2, failed tests retry with same beforeAll state. Other tests continue in parallel, potentially modifying shared data while retry runs.

**Fix:** Add `test.describe.configure({ mode: 'serial' })` — following library.spec.ts pattern.

### Finding 2: Route Handler Stacking (CRITICAL — CONFIRMED)

9 mock functions in api-mocks.ts register `page.route()` without calling `page.unroute()` first. When called multiple times in the same test, handlers stack non-deterministically.

**Tests with multiple mock calls per test (stacking occurs):**

| File | Test | Lines | Mocks |
|------|------|-------|-------|
| state-management.spec.ts | "multiple rounds" | 240, 260 | 2x |
| state-management.spec.ts | "reject all then new" | 281, 301 | 2x |
| user-interactions.spec.ts | "submit after accepting" | 163, 185 | 2x |
| error-recovery.spec.ts | "API 500 and retry" | 68, 88 | 2x |
| error-recovery.spec.ts | "recover after retry" | 213, 222 | 2x |

**Only errors.spec.ts (line 150) correctly calls `page.unrouteAll()` before re-mocking.**

**Fix (recommended hybrid):**
- Option A: Add `await page.unroute(pattern)` inside each mock helper function in api-mocks.ts
- Option B: Defensive `unrouteAll()` in test code before second mock call

### Finding 3: Column Name Bug (HIGH — CONFIRMED)

**File:** integration-helpers.ts:106
**Bug:** `await supabase.from('userLibrary').delete().in('explanation_id', explanationIds);`
**Actual column:** `explanationid` (no underscore, per migration 20251109053825_fix_drift.sql:121-126)
**Impact:** Every integration test run silently fails to clean up userLibrary data, causing orphaned records.
**Fix:** Change `explanation_id` to `explanationid`.

### Finding 4: Active networkidle Call (HIGH)

admin-arena.spec.ts:281 — `await adminPage.waitForLoadState('networkidle')` with eslint-disable comment "#548 batch migration". This is the last ACTIVE networkidle call in the codebase.

**Fix:** Replace with `await adminPage.locator('[data-testid="leaderboard-table"]').waitFor({ state: 'visible' })`.

### Finding 5: POM Rule 12 Violations (HIGH)

7 POM methods performing actions without proper post-action waits:

| POM | Method | Line | Issue |
|-----|--------|------|-------|
| ResultsPage | clickRewriteWithTags() | 367 | No post-action wait |
| ResultsPage | clickEditWithTags() | 373 | No post-action wait |
| ResultsPage | clickChangesPanelToggle() | 709 | Waits for wrong element |
| ResultsPage | clickEditButton() | 555 | Weak wait (button visibility, not mode change) |
| ResultsPage | clickPublishButton() | 576 | Generic DOM wait |
| ResultsPage | selectMode() | 598 | Generic DOM wait |
| ImportPage | selectSource() | 56 | No post-selection wait |

### Finding 6: Timing-Sensitive Integration Assertions (HIGH)

- logging-infrastructure.integration.test.ts:146 — `expect(avgTimePerCall).toBeLessThan(100)` (100ms)
- tag-management.integration.test.ts:213 — `expect(duration).toBeLessThan(15000)` (15s)

**Fix:** Remove timing assertions or use 5-10x generous thresholds.

### Finding 7: Module-Scoped titleGenerated Flag (HIGH)

explanation-generation.integration.test.ts:309 — `let titleGenerated = false` is module-scoped and persists across mock invocations. Not reset by Jest mock cleanup. If test A sets it to true, test B's mock may see stale value.

**Fix:** Move flag inside mock implementation scope or reset it in beforeEach.

### Finding 8: Unrestored global.fetch in Unit Tests (HIGH)

6+ test files assign `global.fetch = mockFetch` at module level without afterEach restoration:
- evolution/src/services/evolutionRunClient.test.ts:6
- src/app/api/traces/route.test.ts:10
- src/lib/tracing/__tests__/fetchWithTracing.test.ts:54
- src/lib/logging/client/__tests__/remoteFlusher.test.ts:34
- src/lib/sessionId.test.ts:42
- src/app/api/monitoring/route.test.ts:12

**Fix:** Store original fetch, restore in afterEach (see sourceFetcher.test.ts for correct pattern).

### Finding 9: ESLint Rule Gaps (MEDIUM)

**Not covered by existing 6 rules:**
- Route mock cleanup enforcement (Rule 10)
- POM wait-after-action pattern (Rule 12)
- `adminTest.skip()` pattern (9 instances bypass no-test-skip)
- Route handler stacking prevention

### Finding 10: Asymmetric test.slow() Pattern (MEDIUM)

56 AI suggestion tests use `if (testInfo.retry === 0) test.slow()` — 180s timeout on first attempt, 60s on retries. This means retries are MORE likely to timeout than initial attempts. 2 tests also have conflicting `test.setTimeout(60000)` that may override test.slow().

### Finding 11: Git History Shows Recurring Flakiness (EVIDENCE)

Recent commits fixing flaky tests:
- 955e526d (Mar 17): SearchPage.fillQuery button timeout + home-tabs toBeEnabled timeout increase
- 089f6071 (Mar 10): Flaky E2E seed errors + duplicate key constraint violations
- 5d0dee27 (Mar 7): Retry CI due to flaky tag-management integration test
- 8530742c (Mar 7): hidden-content.spec.ts column name bug + broken assertions
- 3b371d2b (Feb 24): Production test flakiness fixes

## Open Questions

1. Should we add serial mode to ALL 14 suites, or only the 9 HIGH-risk ones that modify shared state?
2. Should route unrouting go inside mock helper functions (automatic) or in test code (explicit)?
3. Should timing-sensitive integration assertions be removed or given generous thresholds?
4. Should we add new ESLint rules for route stacking and adminTest.skip()?
5. For the test.slow() asymmetry — should retries also get 3x timeout?
