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

The test suite has 5158 unit tests, 212 integration tests, and ~240 E2E tests — substantial coverage — but suffers from systemic quality issues across all tiers. The single largest flakiness source is **29 `networkidle` calls in admin POM files** (plus 29 paired eslint-disable comments = 58 grep matches) and **46 inline `networkidle` calls in E2E spec files** (only 5 in active code; 41 inside `describe.skip` blocks), totaling **75 actual networkidle calls** (tracked in issue #548). Non-admin POMs have widespread Rule 12 violations (missing post-action waits). CI lacks timeouts on 7/8 jobs, Jest lacks `--forceExit`/`--detectOpenHandles`, coverage thresholds are all 0, and the `@critical` tagging strategy has 3 incompatible syntax patterns. Documentation is severely outdated — file counts, directory trees, and helper listings all diverge from reality. There are **44+ tests unnecessarily skipped** across 6 `describe.skip` blocks (evolution/hall-of-fame/elo/strategy — DB tables now exist), dead code artifacts (`auth.setup.ts`, `debug-publish-bug.spec.ts`, deprecated mocks), hardcoded credentials, and 16+ debug console.log lines left in test infrastructure.

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
   - Remove same fallback in `auth.unauth.spec.ts` line 69
   - **Prerequisite**: Verify CI secrets `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` are configured in all GitHub Actions environments (staging, production). Check `.env.example` has clear placeholder entries so local devs know to set these.

**Verification**: `npm test` passes, `npm run test:integration` passes (same suites as before), `npm run lint` passes, CI workflow syntax validated.

**Rollback**: Each Phase 1 change is independent. If any causes issues, revert the specific commit. Phase 1 items should be committed as separate, atomic commits for easy cherry-pick revert.

---

### Phase 2: E2E Flakiness — networkidle Migration (POMs)
**Goal**: Eliminate the 29 actual networkidle calls in admin POM files (plus their 29 eslint-disable comments) — the #1 flakiness source.
**Estimated scope**: 6 admin POM files.
**References**: Research findings #10, #14.
**Rollback**: Revert the single commit. All changes are in POM files only.

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

**Dependency**: Phase 3 Part A assumes Phase 2 POM waits are in place. Spec-level networkidle calls that compensated for POM deficiencies are only safe to remove after Phase 2 adds proper POM waits. Execute Phase 2 first and verify before starting Phase 3.

**Part A: Spec networkidle removal** (Research finding #17)

Only **5 networkidle calls are in active (non-skipped) spec code** across 3 files: `admin-content.spec.ts` (2), `admin-candidates.spec.ts` (1), `auth.unauth.spec.ts` (2). The remaining **41 calls are inside `describe.skip` blocks** across the other 5 files and will be fixed in Phase 5 when un-skipped.

For the 3 active spec files:
- Remove the 5 occurrences (Playwright assertions already auto-wait or POM waits from Phase 2 now cover them)
- Also remove paired eslint-disable comments
- Note: `auth.unauth.spec.ts` does NOT depend on Phase 2 POM changes (it's non-admin)

**Part B: Non-admin POM Rule 12 fixes** (Research finding #18)

| POM | Methods to Fix | Wait to Add |
|-----|---------------|-------------|
| `LoginPage.ts` | `login()`, `clickSubmit()`, `loginWithRememberMe()` | `waitForURL` or `waitForLoadState` |
| `SearchPage.ts` | `search()`, `clickSearch()` | `waitForURL(/\/results/)` |
| `ResultsPage.ts` | ~15 methods; remove 3 `.catch(() => {})` | Various: `waitForSelector`, response waits |
| `ImportPage.ts` | `clickProcess()`, `clickPublish()`, `clickCancel()`, `clickBack()` | State change assertions |
| `UserLibraryPage.ts` | `navigate()`, `clickViewByTitle()` | `waitForLoadState`, `waitForURL` |

**Verification**: Run full E2E suite. Grep confirms 0 `networkidle` in active (non-skipped) code. Run `npx eslint --rule 'no-networkidle: error'` on E2E files.

**Rollback**: Revert commit. Phase 3 changes are test-only (POM files + spec files).

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

### Phase 5: Un-skip Evolution/Hall-of-Fame/Elo/Strategy Tests
**Goal**: Re-enable ~44 tests across 6 `describe.skip` blocks that were skipped pending DB migration (now complete).
**Estimated scope**: 6 spec files.
**References**: Research finding #21.

1. **Un-skip 6 `describe.skip` blocks**:
   - `admin-evolution.spec.ts` line 97 → remove `.skip` and migration comment (5 tests)
   - `admin-evolution-visualization.spec.ts` line 126 → same (9 tests)
   - `admin-article-variant-detail.spec.ts` line 177 → same (8 tests)
   - `admin-hall-of-fame.spec.ts` lines 200 and 603 → same (14 tests)
   - `admin-elo-optimization.spec.ts` line 123 → same (6 tests)
   - `admin-strategy-registry.spec.ts` line 68 → same (2 tests)

2. **Fix networkidle in un-skipped code**: 41 networkidle calls total across the 6 files (deferred from Phase 3). Per-file: admin-elo-optimization (8), admin-evolution (7), admin-hall-of-fame (17), admin-evolution-visualization (7), admin-strategy-registry (2), admin-article-variant-detail (0). Migrate using the same POM/spec patterns from Phases 2-3.

3. **Fix @critical tags in un-skipped tests**: Ensure any `@critical` in name strings are converted to `{ tag: '@critical' }` syntax.

4. **Keep 2 nested `adminTest.skip()` blocks** (lines 347, 469 in hall-of-fame) — these require real LLM calls, legitimate skips.

**Data seeding**: Verified that each spec handles its own test data via inline seed/cleanup functions (`seedEvolutionRun()`, `seedHallOfFameData()`, `seedStrategyData()`) in `beforeAll`/`afterAll`. These use `SUPABASE_SERVICE_ROLE_KEY` which is confirmed available in all 4 CI E2E jobs. No changes to `global-setup.ts` needed.

**Verification**: Run all 6 spec files individually to confirm they pass. Verify test count increased by ~44.

**Rollback**: Revert commit. Only test files changed, no production code.

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
   - **Production fail-fast**: The lazy pattern defers env var validation from import-time to first-use. To preserve fail-fast in production, add a standalone `validateVectorSimEnv()` function in `vectorsim.ts` itself (no new imports needed) that checks `OPENAI_API_KEY`, `PINECONE_API_KEY`, and `PINECONE_INDEX_NAME_ALL` exist without instantiating clients. Call this from the app's server startup path (e.g., a Next.js middleware or a health-check route). **Do NOT call it from `instrumentation.ts`** — vectorsim.ts already imports from instrumentation.ts (line 6: `import { createLLMSpan, createVectorSpan }`), so adding a reverse import would create a circular dependency.
   - **This is a production code change** — commit separately from test-only changes. Verify consumer paths (`actions.ts`, `returnExplanation.ts`, `importActions.ts`) work correctly with lazy init by running their existing unit tests.

4. **Add centralized mock cleanup** to `jest.integration-setup.js`
   - Add `afterEach(() => { jest.clearAllMocks(); })` for defensive cleanup

**Verification**: `npm test` passes with 0 failures (except `run-strategy-experiment.test.ts` which needs `tsx`). `npm run test:integration` — verify the 4 previously-crashing suites (`actions`, `returnExplanation`, `importActions`, and one more transitive importer) now import successfully. Note: `--forceExit` is a stopgap — the underlying open handles identified by `--detectOpenHandles` should be tracked as follow-up work.

**Rollback**: vectorsim.ts change reverts cleanly (restore module-level instantiation). Test-only changes revert independently.

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

**Note**: This phase modifies production component files (adding `data-testid` attributes). These are render-only changes with no behavioral impact, but run build + lint to verify. Verify `data-action="accept"`/`data-action="reject"` attributes actually exist in the rendered DOM before referencing them in selectors.

**Verification**: Run affected E2E specs. `grep -r '\.diff-accept-btn\|\.text-red-700\|has-text.*Get Suggestions' src/__tests__/` returns 0 matches. `npm run build` passes.

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

**Ordering note**: Phase 9 should execute AFTER Phase 10 if Phase 10 is done, since coverage thresholds and test reclassification change the numbers. If Phase 10 is deferred, Phase 9 can proceed with a note that numbers may need a second pass.

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

3. **Verify `@skip-prod` grepInvert** coverage: Phase 4 adds config-level `grepInvert`. Verify the nightly workflow's existing command-line `--grep-invert='@skip-prod'` doesn't conflict with the config-level setting. If redundant, remove the command-line flag in favor of config-only.

4. **Consider `tsconfig.ci.json`**: Include test files in CI typecheck (currently excluded)

5. **Fix `integration-full` change detection bypass**: The production integration run doesn't gate on `path == 'full'` like unit-tests does. A docs-only PR to `production` runs all integration tests. Gate it on the same change detection condition.

**Verification**: CI pipeline green. Coverage thresholds enforced.

## Testing

### Tests to Write
- `linkCandidates.test.ts` (~55 test cases) — Phase 7
- `sourceSummarizer.test.ts` (~14 test cases) — Phase 7

### Tests to Modify
- 6 admin POM files (29 networkidle calls + 29 eslint-disable comments removed) — Phase 2
- 8 admin spec files (inline networkidle removal) — Phase 3
- 5 non-admin POM files (Rule 12 fixes) — Phase 3
- 6 evolution/hall-of-fame/elo/strategy spec files (un-skip ~44 tests) — Phase 5
- ~10 unit/integration test files (flakiness fixes) — Phase 6
- 1 production service file: `vectorsim.ts` (lazy initialization) — Phase 6
- `report-content.spec.ts` + `ResultsPage.ts` + `suggestions-test-helpers.ts` (selector fixes) — Phase 8
- ~5 component files (add `data-testid` attributes) — Phase 8

### Manual Verification
- Run full E2E suite after Phases 2, 3, 5 to confirm no regressions
- Run unit tests after Phase 6 to confirm flakiness fixes
- Review documentation accuracy after Phase 9

## Documentation Updates
The following docs were identified as relevant and will be updated in Phase 9:
- `docs/docs_overall/testing_overview.md` - Test counts, tiers, CI/CD workflows, tagging strategy
- `docs/feature_deep_dives/testing_setup.md` - Directory trees, file counts, helpers, mocks, fixtures, setup files, npm scripts
- `docs/feature_deep_dives/testing_pipeline.md` - API accuracy review
