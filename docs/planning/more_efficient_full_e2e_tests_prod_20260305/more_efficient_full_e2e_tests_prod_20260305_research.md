# More Efficient Full E2E Tests Prod Research

## Problem Statement
Split tests into evolution vs. non-evolution and run only the relevant portion based on what changed. Also detect and fix sources of flakiness in tests.

## Requirements (from GH Issue #633)
1. Split tests into evolution-focused vs. non-evolution, leveraging existing CI change-detection logic to run only relevant tests based on changed files
2. Enforce testing rules from `docs/docs_overall/testing_overview.md` to eliminate flakiness

## High Level Summary

The CI already has a fast/full path split based on file-extension change detection but has NO evolution-specific logic. All code changes trigger the full test suite. There's a clear boundary between evolution and non-evolution code, making a split feasible. On the flakiness front, the codebase follows most rules well (data isolation, route cleanup, selectors, test.skip discipline) but has violations in: networkidle usage (8 instances), missing POM waits (7+ methods), fixed sleeps in integration tests, and silent error swallowing (4 instances).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md - 12 testing rules, CI workflow details, test data management
- docs/feature_deep_dives/testing_setup.md - 4-tier strategy, 36 E2E specs, 27 integration tests, mocking patterns

## Code Files Read
- `.github/workflows/ci.yml` - CI change detection and job pipeline
- `.github/workflows/e2e-nightly.yml` - Nightly production E2E
- `.github/workflows/post-deploy-smoke.yml` - Post-deploy smoke tests
- `playwright.config.ts` - Projects, timeouts, sharding, production detection
- `jest.config.js` - Unit test config with --changedSince threshold bypass
- `jest.integration.config.js` - Integration test config
- `package.json` - NPM scripts for test commands

## Key Findings

### Finding 1: CI Change Detection (ci.yml:17-39)
- Uses `git diff --name-only` against `origin/${BASE_REF}` with extension filter (`.ts|tsx|js|jsx|json|css`)
- Binary fast/full decision: either ALL tests or NONE (lint+tsc only)
- No evolution-specific detection — evolution code changes trigger full suite
- Unit tests use `--changedSince` for affected-only filtering, but integration/E2E run everything

### Finding 2: Evolution vs Non-Evolution Test Mapping

| Category | Evolution | Non-Evolution | Total |
|----------|-----------|---------------|-------|
| E2E Specs | 7 files | 29 files | 36 |
| Integration Tests | 11 files | 16 files | 27 |
| Unit Tests (evolution/) | 88 files | — | 88 |
| Unit Tests (src/) | 5 files | ~172 files | ~177 |

**Evolution E2E specs (7):**
- `admin-evolution.spec.ts` - Pipeline page, runs table, variants
- `admin-arena.spec.ts` - Arena leaderboard, Elo, diffs
- `admin-evolution-visualization.spec.ts` - Dashboard, run detail, timeline
- `admin-experiment-detail.spec.ts` - Experiment history, tabs
- `admin-elo-optimization.spec.ts` - Elo dashboard, strategy leaderboard
- `admin-strategy-registry.spec.ts` - Strategy configs (@critical)
- `admin-article-variant-detail.spec.ts` - Variant detail, lineage

**Evolution integration tests (11):**
- `evolution-infrastructure.integration.test.ts`
- `evolution-actions.integration.test.ts`
- `evolution-cost-estimation.integration.test.ts`
- `evolution-tree-search.integration.test.ts`
- `evolution-cost-attribution.integration.test.ts`
- `evolution-outline.integration.test.ts`
- `evolution-pipeline.integration.test.ts`
- `evolution-visualization.integration.test.ts`
- `arena-actions.integration.test.ts`
- `manual-experiment.integration.test.ts`
- `strategy-resolution.integration.test.ts`

### Finding 3: Clear Evolution Code Boundary

**Evolution-only directories:**
- `evolution/` - Core lib, services, components, config, testing
- `src/app/admin/quality/evolution/` - Evolution pipeline UI
- `src/app/admin/quality/arena/` - Arena UI
- `src/app/admin/quality/optimization/experiment/` - Experiment UI
- `src/app/admin/quality/strategies/` - Strategy registry
- `src/app/admin/quality/prompts/` - Prompt bank
- `src/app/admin/evolution-dashboard/` - Dashboard
- `src/app/api/evolution/` - Evolution API routes
- `src/app/api/cron/evolution-*` - Evolution cron jobs
- `src/app/api/cron/experiment-*` - Experiment cron jobs

**Shared/bridge files (small set):**
- `src/lib/services/runTriggerContract.ts`
- `src/lib/services/adminAuth.ts`
- `src/lib/services/auditLog.ts`

### Finding 4: Flakiness Violations

**Rule 2 - Fixed sleeps (5 violations):**
- `request-id-propagation.integration.test.ts:269` - `setTimeout(resolve, 5)`
- `streaming-api.integration.test.ts:94` - `setTimeout(resolve, 10)`
- `streaming-api.integration.test.ts:167` - `setTimeout(resolve, 5)`
- `e2e/helpers/api-mocks.ts:373` - configurable delay in mock
- `e2e/setup/global-setup.ts:85` - retry interval (acceptable for setup)

**Rule 9 - networkidle (8 violations, all have eslint-disable):**
- `auth.unauth.spec.ts:239,260` - skipped tests
- `admin-arena.spec.ts:297` - batch migration note
- `admin-experiment-detail.spec.ts:149,175,198,212,228` - 5 instances, experiment migration

**Rule 7 - Silent catches (4 violations in ResultsPage.ts):**
- Line 191: `.catch(() => {})` on tag removal wait
- Line 197: `.catch(() => null)` on tag apply button wait
- Line 220: `.catch(() => null)` on save complete wait
- Line 104: `.catch(() => {})` on Promise.race fallback

**Rule 12 - Missing POM waits after actions (7+ violations):**
- `LoginPage.ts:45` - submit click, no navigation wait
- `LoginPage.ts:61` - toggleToSignup, no form appearance wait
- `LoginPage.ts:99` - toggleRememberMe, no state change wait
- `ResultsPage.ts:542` - clickEditButton, no edit mode wait
- `ResultsPage.ts:560` - clickPublishButton, no response wait
- `ResultsPage.ts:685` - clickChangesPanelToggle, no panel visibility wait
- `ImportPage.ts:64` - selectSource, no selection verification

**Good areas (no violations):**
- Rule 3 (stable selectors) - excellent data-testid usage throughout
- Rule 8 (test.skip) - all have proper eslint-disable comments
- Rule 10 (route cleanup) - all fixtures have `page.unrouteAll({ behavior: 'wait' })`
- Rule 1 (data isolation) - excellent test-data-factory pattern
- Rule 11 (per-worker temp files) - global-setup reads `/tmp/claude-instance-*.json` but these are read-only discovery files, not shared writes

### Finding 5: CI Pipeline Structure

```
PRs to main:
  detect-changes → typecheck + lint → unit-tests(--changedSince) → integration-critical(5 tests) + e2e-critical(@critical)

PRs to production:
  detect-changes → typecheck + lint → unit-tests → integration-full(27 tests) + e2e-full(4 shards)
```

Current integration-critical list: `auth-flow|explanation-generation|streaming-api|error-handling|vector-matching` (NO evolution tests in critical path)

### Finding 6: Existing Tag System for E2E

Playwright projects already support tag-based filtering via `grep`:
- `chromium-critical` project: `grep: /@critical/`
- Could add `@evolution` tag and a `chromium-evolution` project
- CI can use `--grep` / `--grep-invert` to include/exclude

### Finding 7: Integration Test Critical Subset

The integration critical list is hardcoded in `package.json` as a `--testPathPatterns` regex. Evolution tests could be similarly grouped with a pattern like `evolution-|arena-|strategy-|manual-experiment`.

### Finding 8: Historical Test Failures (Past 2 Weeks from GH CI + Commits)

**27 CI failures in last 500 runs**, concentrated on deploy/main-to-production branches.

**deploy/main-to-production-mar05 (13 failures, 13 fix commits to get green):**

| Test / Area | Root Cause | Fix Applied | Type |
|------------|------------|-------------|------|
| `home-tabs.spec.ts` (E2E) | React controlled input: `fill()` doesn't trigger `onChange` in CI; submit button stays disabled | Use `pressSequentially` with delay; wait for button enabled before Enter | Timing race |
| `library.spec.ts` (E2E) | `safeIsVisible` returns false on slow CI; card load timeout too short | Wait for `feed-card` element directly with 30s timeout | Timing race |
| `search-generate.spec.ts` (E2E) | Wrong testid on results page (`home-search-input` vs `search-input`); missing `searchPage` instantiation | Use correct nav bar testid; add `new SearchPage(page)` in test scope | Test bug |
| `smoke.spec.ts` (E2E) | Wrong testid (`search-submit` vs `home-search-submit`) | Fix testid to match `HomeSearchPanel` | Test bug |
| `action-buttons.spec.ts` (E2E) | Plain text mode content in `<textarea>`, used `innerText()` instead of `inputValue()` | Use `inputValue()` for textarea elements | Test bug |
| `admin-arena.spec.ts` (E2E) | Expression index on `lower(prompt)` prevents INSERT with duplicate prompts; missing `title` column | Use select-then-insert with upsert fallback; provide title | Seeding bug |
| `hidden-content.spec.ts` (E2E) | Column renamed `topic_name` → `topic_title` | Update column reference | Schema drift |
| `report-content.spec.ts` (E2E) | Clicking disabled submit button; wrong assertion order | Check disabled state; select reason before checking submit | Test logic |
| `evolution-pipeline.integration.test.ts` | Pipeline returns `completed` with `budget_exhausted` error_message on graceful completion | Update assertion to expect `budget_exhausted` error_message | Behavioral change |
| Lint failures | Unused imports after test fixes | Remove unused imports | Cleanup |

**Nightly failure Mar 4 (#600):**

| Test / Area | Root Cause | Fix Applied | Type |
|------------|------------|-------------|------|
| 26 @skip-prod AI suggestion tests | PR #589 moved `--grep-invert` from CLI to config; production branch lacks config update | Restore CLI `--grep-invert` as belt-and-suspenders | Config regression |
| 2 home-tabs search tests | React state batching: button disabled until re-render after fill | Add `toBeEnabled()` wait after fill | Timing race |

**PR #555 - Fix Flaky Production Tests (Feb 24):**

| Test / Area | Root Cause | Fix Applied | Type |
|------------|------------|-------------|------|
| `hidden-content.spec.ts` | `getExplanationByIdImpl()` missing `delete_status` filter — real app bug | Add `.eq('delete_status', 'visible')` | App bug |
| `home-tabs.spec.ts` | `waitForURL` timeout 10s too short in CI | Increase to 30s | Timeout |
| `action-buttons.spec.ts` | No waits between format toggle clicks and assertions | Add POM waits | Timing race |
| `tags.spec.ts` | `removeTag()` and `clickApplyTags()` POM methods don't wait | Add completion waits | Missing POM wait |
| `library.spec.ts` | `clickCardByIndex()` POM has no destination wait | Add `waitForURL` | Missing POM wait |
| `add-sources.spec.ts` | Source fetch timeout variability | Increase `test.setTimeout` to 45s | Timeout |
| `suggestions.spec.ts` | Input race during mock setup | Fix setup ordering | Timing race |
| Shard 1 overload | Alphabetical assignment puts ALL flaky tests in shard 1 | Remove `--max-failures=5` | CI config |
| Integration mock leakage | `jest.integration.config.js` had `restoreMocks: false` | Change to `true` | Config bug |

### Finding 9: Pattern Analysis — Top Failure Categories

| Category | Count | Examples | Recurring? |
|----------|-------|----------|------------|
| **Timing races / missing waits** | 12 | React state batching, POM clicks without waits, `safeIsVisible` races | YES - systemic |
| **Test bugs (wrong selectors/assertions)** | 8 | Wrong testid, wrong assertion method, missing variable | Merge-related |
| **Schema/behavioral drift** | 4 | Column renames, pipeline status changes, API changes | Merge-related |
| **CI configuration** | 3 | fail-fast, mock restoration, grep-invert regression | One-time |
| **Seeding/data setup** | 3 | Arena topic duplicates, expression index conflicts | Evolution-specific |
| **networkidle** | 8 | Admin tests, skipped auth tests | Known debt |
| **App bugs caught by tests** | 1 | Missing delete_status filter | Rare |

**Key insight: 12 of 27 failures (44%) are timing races / missing waits — the single biggest category. This is a systemic POM quality issue, not random flakiness.**

**Secondary insight: 12 of 27 failures (44%) occurred during main→production merges due to test/schema drift. These are NOT flakiness — they're merge integration issues where tests reference old selectors, column names, or behaviors that changed on main.**

## Open Questions

1. Should evolution E2E tests run on PRs to main when only evolution code changes? Or just on PRs to production?
2. Should the CI detect "evolution-only" changes at a finer grain (e.g., `evolution/` or `src/app/admin/quality/evolution*`) or use a simpler tag-based approach?
3. For integration tests on main PRs, should we add an `integration-evolution-critical` job, or just expand the existing critical list?
4. Should the networkidle eslint-disables be fixed now or tracked as separate work?
