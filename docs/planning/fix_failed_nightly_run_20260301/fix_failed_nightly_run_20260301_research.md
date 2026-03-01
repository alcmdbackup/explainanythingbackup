# Fix Failed Nightly Run Research

## Problem Statement
The nightly E2E test run has failed for 2 consecutive days (Feb 28 and Mar 1) after 3 days of passing. All 26 failures are @skip-prod tagged AI suggestions tests that are running against the production URL but should either be skipped or the production environment no longer supports them. Additionally, 2 home-tabs search tests are flaky on Chromium (search button stays disabled). The root cause needs investigation — either the nightly workflow isn't filtering @skip-prod tests, the production deployment changed, or the tests themselves need updating.

## Requirements (from GH Issue #596)
1. Investigate why 26 @skip-prod AI suggestions tests are not being skipped in the nightly workflow
2. Determine if @skip-prod filtering was recently removed or never existed in e2e-nightly.yml
3. Fix the nightly workflow to properly skip @skip-prod tests, OR fix the tests to work against production
4. Investigate the 2 flaky home-tabs search tests (search button disabled timeout)
5. Fix the flaky tests or add proper waits/retries
6. Verify the fix by triggering a manual nightly run
7. Update testing documentation if workflow behavior changes

## High Level Summary

**Root Cause (26 @skip-prod failures):** PR #589 (analyze_test_suite_20260226), merged Feb 27 at 22:24 UTC, moved @skip-prod filtering from CLI (`--grep-invert="@skip-prod"`) to config (`grepInvert` in `playwright.config.ts`). However, the nightly workflow YAML runs from `main` (GitHub Actions cron behavior) while test code is checked out from `production` branch. The `production` branch doesn't have the config-based `grepInvert` (30 commits behind `main`), so @skip-prod tests now run unfiltered.

**Root Cause (2 flaky home-tabs tests):** `home-tabs.spec.ts` lines 83-121 fill the search input then immediately click the submit button or press Enter without waiting for the button to become enabled. On production (slower than local), the React state update hasn't propagated before the click.

**Timeline:**
- Feb 27 06:21 UTC — Nightly **passed** (PR #589 not yet merged, CLI had `--grep-invert`)
- Feb 27 22:24 UTC — PR #589 merged to `main` (removed CLI `--grep-invert`, added config `grepInvert`)
- Feb 28 06:11 UTC — Nightly **failed** (workflow from `main` has no CLI filter, config from `production` has no config filter)
- Mar 1 06:18 UTC — Nightly **failed** (same issue persists)

## Key Findings

### Finding 1: Workflow/Config Mismatch is the Root Cause

The nightly workflow (`e2e-nightly.yml`) uses the YAML from `main` (GitHub Actions scheduled trigger behavior) but checks out `production` branch code:

```yaml
# From e2e-nightly.yml (runs from main):
- uses: actions/checkout@v4
  with:
    ref: production  # Test code from production branch
```

PR #589 changed the filtering approach:
- **Before (working):** `npx playwright test --project=${{ matrix.browser }} --grep-invert="@skip-prod"`
- **After (broken):** `npx playwright test --project=${{ matrix.browser }}` (relies on config-based grepInvert)

The config-based approach (`...(isProduction ? { grepInvert: /@skip-prod/ } : {})`) exists only on `main`, not `production`. Result: no filtering at all.

### Finding 2: 30 Commits Behind on Production

```
origin/main is 30 commits ahead of origin/production
Last production release: Feb 26 (#584)
PR #589 merged to main: Feb 27 (not in any production release)
```

### Finding 3: AI Suggestion Tests Fail Deterministically

All 26 tests fail with `TimeoutError: page.waitForSelector: Timeout 30000ms exceeded` waiting for `[data-diff-key]` (AI suggestion diff nodes). These tests mock API routes, but without `NEXT_PUBLIC_USE_AI_API_ROUTE='true'` on production, the mock targets may not match the actual request flow. Tests fail on all 3 retries, on both Chromium and Firefox.

### Finding 4: Test Count Difference Confirms Root Cause

- Feb 27 (passing): 101 passed, 107 skipped, 1 flaky (4.3 min)
- Feb 28 (failing): 136 passed, 107 skipped, 26 failed, 2 flaky (34.4 min)
- Delta: +35 passed + 26 failed = +61 tests running (the formerly-filtered @skip-prod tests)

### Finding 5: Flaky Home-Tabs Tests (Separate Issue)

`home-tabs.spec.ts` lines 102-121 (search button click test):
```typescript
await searchInput.fill('quantum entanglement');
await searchButton.click();  // Button may still be disabled!
```

The button starts disabled and is enabled by React after processing the input change. On production, this happens slower. The test needs `await expect(searchButton).toBeEnabled()` before clicking.

Lines 83-100 (Enter key test) has the same race condition — `searchInput.press('Enter')` fires before the form validates the input.

### Finding 6: @skip-prod Tag Format is Consistent

8 files use @skip-prod. Most use proper `{ tag: '@skip-prod' }` parameter. Two files (`error-recovery.spec.ts`, `errors.spec.ts`) embed it in the describe name string. Both formats are matched by `grepInvert: /@skip-prod/` since Playwright matches against full test titles.

### Finding 7: Audit Step is Misleading

The nightly workflow has a `@skip-prod` audit step that checks files have the tag, but this only validates tag presence — it doesn't skip the tests. The actual filtering was done by `--grep-invert` (now removed) or `grepInvert` config (not on production).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — Documentation structure
- docs/docs_overall/architecture.md — System design, tech stack
- docs/docs_overall/project_workflow.md — Project workflow steps

### Relevant Docs
- docs/docs_overall/testing_overview.md — CI/CD workflows, nightly behavior, @skip-prod tag docs
- docs/feature_deep_dives/testing_setup.md — Test tiers, E2E patterns, AI suggestion test helpers
- docs/docs_overall/environments.md — GitHub secrets, Production vs Development env config
- docs/docs_overall/debugging.md — Debugging tools and four-phase methodology

## Code Files Read
- `.github/workflows/e2e-nightly.yml` — Nightly workflow: checkout production, no `--grep-invert` on CLI
- `playwright.config.ts` (main) — Has `grepInvert: /@skip-prod/` at line 161
- `playwright.config.ts` (production) — Does NOT have `grepInvert` — this is the root cause
- `src/__tests__/e2e/specs/01-home/home-tabs.spec.ts` — Flaky search tests (lines 83-121)
- `src/__tests__/e2e/specs/06-ai-suggestions/content-boundaries.spec.ts` — Example failing @skip-prod test
- `src/__tests__/e2e/specs/06-ai-suggestions/user-interactions.spec.ts` — Fails waiting for `[data-diff-key]`
- `src/__tests__/e2e/helpers/suggestions-test-helpers.ts` — `waitForDiffNodes` at line 68

## Open Questions
1. Should we add `--grep-invert` back as belt-and-suspenders, or rely solely on config-based filtering?
2. Should we also release to production to get the config-based filter deployed?
3. For the flaky home-tabs tests — should we add `@skip-prod` or fix the waits?
