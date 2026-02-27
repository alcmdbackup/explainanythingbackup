# Analyze Test Suite Plan

## Background
Assess the existing test suite including critical tests and all tests across unit, integration, and E2E tiers. Look for ways to reduce flakiness, update testing-related documentation, and identify gaps that need to be plugged.

## Requirements (from GH Issue #582)
- Assess existing test suite including critical tests and all tests
- Unit, integration, E2E tiers
- Look for ways to reduce flakiness
- Update testing-related documentation
- Look for gaps that need to be plugged

## Problem

The test suite has 5158 unit tests, 212 integration tests, and ~240 E2E tests — substantial coverage — but suffers from systemic quality issues across all tiers. The single largest flakiness source is 119 `networkidle` usages in E2E admin specs (77 in POMs + 42 inline in specs), tracked in issue #548 but not yet addressed. Non-admin POMs have widespread Rule 12 violations (missing post-action waits). CI lacks timeouts on 7/8 jobs, Jest lacks `--forceExit`/`--detectOpenHandles`, coverage thresholds are all 0, and the `@critical` tagging strategy has 3 incompatible syntax patterns. Documentation is severely outdated — file counts, directory trees, and helper listings all diverge from reality. There are 36 tests unnecessarily skipped (evolution/hall-of-fame — DB tables now exist), dead code artifacts (`auth.setup.ts`, `debug-publish-bug.spec.ts`, deprecated mocks), hardcoded credentials, and 16+ debug console.log lines left in test infrastructure.

## Options Considered

### Approach A: Big-Bang Overhaul
Fix everything in one large PR. Risk: massive diff, hard to review, merge conflicts.

### Approach B: Phased by Category (Selected)
Group changes by type (flakiness → cleanup → coverage → docs) with each phase producing a mergeable commit. Each phase is independently valuable and reviewable. Phases ordered by impact: flakiness reduction first (most user-visible), then hygiene/cleanup, then coverage gaps, then documentation.

### Approach C: Phased by Tier
Fix all unit test issues, then all integration issues, then all E2E issues. Problem: cross-cutting concerns like CI timeouts and documentation span all tiers.

## Phased Execution Plan

### Phase 1: Quick Wins — Dead Code, Debug Cleanup, CI Hardening
**Goal**: Remove noise, harden CI, fix things that require no behavioral changes.
**Estimated scope**: ~15 files touched, all mechanical/safe changes.

1. **Delete dead code**
   - Delete `src/__tests__/e2e/setup/auth.setup.ts` (never referenced by any Playwright project)
   - Delete `debug-publish-bug.spec.ts` (debug artifact, no tags, 120s timeout)
   - Remove `mockAISuggestionsPipeline` export from `api-mocks.ts` line 409 (deprecated, never imported — `mockAISuggestionsPipelineAPI` is the active one)

2. **Remove debug console.log statements**
   - Remove 7 `[DEBUG]` statements in `global-setup.ts` (lines 297-382)
   - Remove 7 `[MOCK-DEBUG]` statements in `api-mocks.ts` (lines 318-357)
   - Remove 2 `console.log` in `jest.shims.js` (lines 4, 10)

3. **Add CI job timeouts** to `.github/workflows/ci.yml` and `post-deploy-smoke.yml`
   - `detect-changes`: 5 min
   - `typecheck`: 10 min
   - `lint`: 10 min
   - `unit-tests`: 15 min
   - `integration-critical`: 15 min
   - `integration-full`: 30 min
   - `e2e-critical`: 20 min
   - `post-deploy-smoke.yml`: 15 min

4. **Add Jest flags** to `package.json` scripts
   - Add `--forceExit` to `test` and `test:ci` scripts
   - Add `--detectOpenHandles` to `test:ci` script

5. **Fix hardcoded credentials** in `fixtures/auth.ts`
   - Remove fallback `|| 'abecha@gmail.com'` (line 39) and `|| 'password'` (line 51)
   - Throw descriptive error if `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` not set
   - Remove same fallbacks from `auth.setup.ts` (moot since file is deleted) and `auth.unauth.spec.ts` line 69

**Verification**: `npm test` passes, `npm run test:integration` passes (same suites as before), `npm run lint` passes, CI workflow syntax validated.

---

### Phase 2: E2E Flakiness — networkidle Migration (POMs)
**Goal**: Eliminate the 77 networkidle usages in admin POM files — the #1 flakiness source.
**Estimated scope**: 6 admin POM files.
**References**: Research findings #10, #14.

1. **AdminBasePage.ts** (1 occurrence, line 42)
   - `goto()`: Replace `waitUntil: 'networkidle'` with `waitUntil: 'domcontentloaded'`

2. **AdminCandidatesPage.ts** (6 occurrences)
   - Navigation methods: Replace with `domcontentloaded` + `table.waitFor({ state: 'visible' })`
   - Filter/search methods: Replace with `expect(tbody).not.toContainText('Loading...')`
   - Action methods (approve/reject): Replace with modal close or toast assertion

3. **AdminContentPage.ts** (5 occurrences) — same pattern as Candidates

4. **AdminWhitelistPage.ts** (6 occurrences) — table-remove pattern: use `table.waitFor({ state: 'visible' })`

5. **AdminUsersPage.ts** (6 occurrences) — Loading text pattern: use `not.toContainText('Loading...')`

6. **AdminReportsPage.ts** (5 occurrences) — Loading text pattern

**Important**: Two different loading patterns exist:
- WhitelistContent/CandidatesContent: Remove table entirely during load → `table.waitFor({ state: 'visible' })`
- ExplanationTable/ReportsTable/UsersPage: Keep table, show "Loading..." → `expect(tbody).not.toContainText('Loading...')`

**Verification**: Run admin E2E specs locally. Confirm no `networkidle` remains in POM files via `grep -r 'networkidle' src/__tests__/e2e/helpers/pages/admin/`. Run ESLint to verify no-networkidle rule now passes without eslint-disable comments (remove the disable comments too).

---

### Phase 3: E2E Flakiness — networkidle Migration (Specs) + POM Rule 12 Fixes
**Goal**: Eliminate the 42 inline networkidle usages in spec files and fix Rule 12 violations in non-admin POMs.
**Estimated scope**: 8 spec files + 5 non-admin POM files.

**Part A: Spec networkidle removal** (Research finding #17)

For each of the 8 spec files:
- Remove ~35 occurrences where Playwright assertions already auto-wait
- Replace ~6 post-action waits where next assertion serves as the wait
- Add 1 new assertion for admin-auth sidebar visibility
- Skip the 12 occurrences inside `describe.skip` blocks (will be fixed when un-skipped in Phase 5)

**Part B: Non-admin POM Rule 12 fixes** (Research finding #18)

| POM | Methods to Fix | Wait to Add |
|-----|---------------|-------------|
| `LoginPage.ts` | `login()`, `clickSubmit()`, `loginWithRememberMe()` | `waitForURL` or `waitForLoadState` |
| `SearchPage.ts` | `search()`, `clickSearch()` | `waitForURL(/\/results/)` |
| `ResultsPage.ts` | ~15 methods; remove 3 `.catch(() => {})` | Various: `waitForSelector`, response waits |
| `ImportPage.ts` | `clickProcess()`, `clickPublish()`, `clickCancel()`, `clickBack()` | State change assertions |
| `UserLibraryPage.ts` | `navigate()`, `clickViewByTitle()` | `waitForLoadState`, `waitForURL` |

**Verification**: Run full E2E suite. Grep confirms 0 `networkidle` in active (non-skipped) code. Run `npx eslint --rule 'no-networkidle: error'` on E2E files.

---

### Phase 4: E2E Tagging and Test Organization
**Goal**: Standardize tagging strategy, fix @critical tag syntax, clean up test organization.
**Estimated scope**: ~15 spec files + `playwright.config.ts`.

1. **Fix admin @critical tag syntax** (3 files)
   - `admin-auth.spec.ts` line 16: Move `@critical` from name string to `{ tag: '@critical' }` parameter
   - `admin-content.spec.ts` line 35: Same
   - `admin-candidates.spec.ts` line 14: Same

2. **Remove JSDoc tag comments**
   - `hidden-content.spec.ts`: Remove `/** @tags non-critical */` comment (Playwright ignores it)

3. **Add `grepInvert` for `@skip-prod`** to `playwright.config.ts`
   - Add `grepInvert: /@skip-prod/` to production-facing projects to prevent 40+ dev-only tests from running in production

4. **Audit untagged core tests** — consider adding `@critical` to:
   - `auth.spec.ts` — session persistence and protected route access (HIGH value)
   - `library.spec.ts` — library loading, sorting, search (MEDIUM value)
   - Leave `regenerate.spec.ts` untagged (lower priority)

**Verification**: Run `npx playwright test --grep="@critical" --list` and confirm admin critical tests now appear. Run `npx playwright test --project=chromium-critical --list` and verify expected count.

---

### Phase 5: Un-skip Evolution/Hall-of-Fame Tests + Fix Remaining Skips
**Goal**: Re-enable 36 tests that were skipped pending DB migration (now complete).
**Estimated scope**: 4 spec files.
**References**: Research finding #21.

1. **Un-skip 4 `describe.skip` blocks**:
   - `admin-evolution.spec.ts` line 97 → remove `.skip` and migration comment (5 tests)
   - `admin-evolution-visualization.spec.ts` line 126 → same (9 tests)
   - `admin-article-variant-detail.spec.ts` line 177 → same (8 tests)
   - `admin-hall-of-fame.spec.ts` lines 200 and 603 → same (14 tests)

2. **Fix networkidle in un-skipped code**: The 12 networkidle occurrences in these files (Phase 3 deferred them) should be migrated using the same patterns from Phase 2.

3. **Fix @critical tags in un-skipped tests**: Ensure any `@critical` in name strings are converted to `{ tag: '@critical' }` syntax.

4. **Keep 2 nested `adminTest.skip()` blocks** (lines 347, 469 in hall-of-fame) — these require real LLM calls, legitimate skips.

**Verification**: Run the 4 spec files individually to confirm they pass. Verify test count increased by ~36.

**Note**: These tests depend on seeded evolution/hall-of-fame data. If global-setup doesn't seed this data, a seeding step will need to be added or the tests will need test-local data creation.

---

### Phase 6: Unit/Integration Flakiness Fixes
**Goal**: Fix known flaky patterns in unit and integration tests.
**Estimated scope**: ~10 test files.

1. **Unit test flakiness fixes**
   - `findMatches.test.ts:490-497`: Replace wall-clock `Date.now()` timing assertion with mock timers or remove
   - `userLibrary.test.ts:93`: Replace 10ms `setTimeout` with `jest.useFakeTimers()` + `jest.advanceTimersByTime()`
   - `browserTracing.test.ts`: Wrap `process.env.NODE_ENV` mutations in `beforeEach`/`afterEach`
   - `cronAuth.test.ts`: Same for `process.env.CRON_SECRET`
   - `cron/evolution-watchdog/route.test.ts`: Move env var setup from describe-scope to beforeEach/afterEach
   - `returnExplanation.test.ts:130-135`: Move `jest.mock()` to module scope (currently inside describe)

2. **Integration test flakiness fixes**
   - `request-id-propagation.integration.test.ts:269`: Replace `Math.random() * 10` with fixed delay
   - `session-id-propagation.integration.test.ts:115`: Same
   - `logging-infrastructure.integration.test.ts:169`: Replace 50ms hardcoded sleep with deterministic approach
   - `hall-of-fame-actions.integration.test.ts`: Fix `.env.local` → `.env.test` loading
   - `explanation-update.integration.test.ts`: Remove redundant local Pinecone/OpenAI mocks (use global setup)

3. **vectorsim.ts lazy initialization** (Research finding #13)
   - Refactor module-level `getRequiredEnvVar` calls to lazy `getClient()` pattern (matching `llms.ts`)
   - This unblocks 4 integration suites that currently crash at import time

4. **Add centralized mock cleanup** to `jest.integration-setup.js`
   - Add `afterEach(() => { jest.clearAllMocks(); })` for defensive cleanup

**Verification**: `npm test` passes with 0 failures (except `run-strategy-experiment.test.ts` which needs `tsx`). `npm run test:integration` — same pass/fail ratio but no flaky patterns.

---

### Phase 7: Coverage Gaps — New Unit Tests
**Goal**: Add unit tests for untested services.
**Estimated scope**: 2 new test files, ~69 test cases total.

1. **`linkCandidates.test.ts`** (~55 test cases)
   - Mock Supabase client
   - Cover all 11 exported functions
   - Test silent error swallowing paths in `saveCandidatesFromLLM` and `updateOccurrencesForArticle`
   - Test `approveCandidate` 2-step write (whitelist creation + status update)
   - Test edge cases: empty arrays, null IDs, duplicate candidates

2. **`sourceSummarizer.test.ts`** (~14 test cases)
   - Mock `callLLM`
   - Test successful summarization
   - Test truncation fallback when LLM fails
   - Test content length handling
   - Test error propagation

**Verification**: New test files pass. Coverage for these 2 services goes from 0 to >80%.

---

### Phase 8: Fragile Selectors — data-testid Migration
**Goal**: Replace fragile CSS class and text selectors with stable `data-testid` attributes.
**Estimated scope**: ~5 component files + ~3 test files.

1. **Add `data-testid` to components**
   - `ReportContentButton.tsx` — add testids for report-content spec
   - `LexicalEditor.tsx` — add `data-testid="editor"` to editor div
   - AI suggestions submit button — add `data-testid="get-suggestions-btn"`
   - Evolution tab buttons — add testids

2. **Migrate `report-content.spec.ts`** (Priority 1 — 28 fragile selectors)
   - Replace all CSS class/structure selectors with `data-testid`

3. **Fix `ResultsPage.ts` selectors**
   - Lines 39-40: `.diff-accept-btn`/`.diff-reject-btn` → `button[data-action="accept"]`/`button[data-action="reject"]`
   - Line 63: Remove `.text-red-700`, use existing `[data-testid="error-message"]`

4. **Fix `suggestions-test-helpers.ts` selectors**
   - `button:has-text("Get Suggestions")` → `[data-testid="get-suggestions-btn"]`
   - Unicode `✓`/`✕` → testid-based selectors

**Verification**: Run affected E2E specs. `grep -r '\.diff-accept-btn\|\.text-red-700\|has-text.*Get Suggestions' src/__tests__/` returns 0 matches.

---

### Phase 9: Documentation Updates
**Goal**: Bring all testing documentation in sync with reality.
**Estimated scope**: 3 doc files.

1. **`docs/docs_overall/testing_overview.md`**
   - Update test counts (unit: ~267 files/5158 tests, integration: 29/212, E2E: 37/~240)
   - Fix self-contradicting E2E count ("170+" vs "163")
   - Update @critical test count
   - Document ESLint flakiness rules
   - Update CI/CD workflow descriptions with timeout info
   - Add section on tagging strategy (`@critical`, `@skip-prod`, `@smoke`, `@prod-ai`)

2. **`docs/feature_deep_dives/testing_setup.md`**
   - Update directory tree to match reality (28 integration files, not 14)
   - Update file counts in all sections
   - Fix `evolution-test-helpers.ts` path (actually at `evolution/src/testing/`, not `src/testing/utils/`)
   - Document all 9 mock files in `src/testing/mocks/`
   - Document all E2E fixtures (auth.ts, admin-auth.ts, base.ts)
   - Document all E2E setup files (global-setup, global-teardown, vercel-bypass)
   - Add undocumented npm scripts
   - Update known issues section

3. **`docs/feature_deep_dives/testing_pipeline.md`**
   - Review for accuracy against current `testingPipeline.ts` implementation
   - Minor updates if API has changed

**Verification**: Manual review of each doc. Spot-check file counts against `find` results.

---

### Phase 10: CI Improvements (Optional / Lower Priority)
**Goal**: Longer-term CI quality improvements.

1. **Reclassify misplaced integration tests** as unit tests
   - `evolution-agent-selection.integration.test.ts` → unit test (pure pipeline wiring, no DB)
   - `strategy-experiment.integration.test.ts` → unit test (pure algorithm)

2. **Set coverage thresholds**
   - Run `npm test -- --coverage` to get current baseline
   - Set thresholds to ~5% below current in `jest.config.js` as a floor
   - Same for `jest.integration.config.js`

3. **Add `@skip-prod` grepInvert** to nightly/production projects in `playwright.config.ts`

4. **Consider `tsconfig.ci.json`**: Include test files in CI typecheck (currently excluded)

**Verification**: CI pipeline green. Coverage thresholds enforced.

## Testing

### Tests to Write
- `linkCandidates.test.ts` (~55 test cases) — Phase 7
- `sourceSummarizer.test.ts` (~14 test cases) — Phase 7

### Tests to Modify
- 6 admin POM files (networkidle removal) — Phase 2
- 8 admin spec files (inline networkidle removal) — Phase 3
- 5 non-admin POM files (Rule 12 fixes) — Phase 3
- 4 evolution/hall-of-fame spec files (un-skip) — Phase 5
- ~10 unit/integration test files (flakiness fixes) — Phase 6
- `report-content.spec.ts` + `ResultsPage.ts` + `suggestions-test-helpers.ts` (selector fixes) — Phase 8

### Manual Verification
- Run full E2E suite after Phases 2, 3, 5 to confirm no regressions
- Run unit tests after Phase 6 to confirm flakiness fixes
- Review documentation accuracy after Phase 9

## Documentation Updates
The following docs were identified as relevant and will be updated in Phase 9:
- `docs/docs_overall/testing_overview.md` - Test counts, tiers, CI/CD workflows, tagging strategy
- `docs/feature_deep_dives/testing_setup.md` - Directory trees, file counts, helpers, mocks, fixtures, setup files, npm scripts
- `docs/feature_deep_dives/testing_pipeline.md` - API accuracy review
