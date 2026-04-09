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

**Root Cause (2 flaky home-tabs tests):** `home-tabs.spec.ts` lines 83-121 fill the search input then immediately click the submit button or press Enter without waiting for the button to become enabled. The button's disabled state is `disabled={isSubmitting || !query.trim()}` in `HomeSearchPanel.tsx` line 120. On production (slower than local), the React state update hasn't propagated before the click.

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

### Finding 3: AI Suggestion Tests Are Inherently Impossible on Production

All 26 tests fail with `TimeoutError: page.waitForSelector: Timeout 30000ms exceeded` waiting for `[data-diff-key]` (AI suggestion diff nodes).

**Root cause of test failure (when they DO run):**
1. Tests mock `/api/runAISuggestionsPipeline` via `page.route()` (browser-level interception)
2. Production doesn't set `NEXT_PUBLIC_USE_AI_API_ROUTE=true` (only CI/local do)
3. Without this env var, `AIEditorPanel.tsx` line 360 uses `runAISuggestionsPipelineAction()` (server action) instead of the API route
4. Server actions use RSC wire format and make Node.js-level OpenAI SDK calls
5. Playwright **cannot intercept Node.js server-side requests** — only browser requests
6. The mock never fires, the real AI processes slowly (or fails), no diff nodes render

This is explicitly acknowledged at `api-mocks.ts:350-352`:
```typescript
// NOTE: Server-side LLM mocking is not possible with Playwright as the OpenAI SDK
// makes requests from the Node.js server, not from the browser.
```

**Conclusion:** These tests can NEVER work against production. They MUST be filtered via @skip-prod.

### Finding 4: Test Count Difference Confirms Root Cause

- Feb 27 (passing): 101 passed, 107 skipped, 1 flaky (4.3 min)
- Feb 28 (failing): 136 passed, 107 skipped, 26 failed, 2 flaky (34.4 min)
- Delta: +35 passed + 26 failed = +61 tests running (the formerly-filtered @skip-prod tests)

### Finding 5: Flaky Home-Tabs Tests (Separate Issue)

**Component:** `src/components/home/HomeSearchPanel.tsx` line 120
```typescript
<button disabled={isSubmitting || !query.trim()} data-testid="home-search-submit">
```

**State propagation:** `query` comes from parent via props → `page.tsx` manages `searchQuery` state → `onChange` fires synchronously → but React batches the re-render. Tests click before the render completes.

**Fix (in tests, not component):** Add `await expect(searchButton).toBeEnabled({ timeout: 5000 })` after `fill()` in both tests.

**Production safety:** These tests ARE production-safe (fully mocked API, core user flow). They should NOT have @skip-prod.

### Finding 6: @skip-prod Tag Format is Consistent

8 files use @skip-prod. Most use proper `{ tag: '@skip-prod' }` parameter. Two files (`error-recovery.spec.ts`, `errors.spec.ts`) embed it in the describe name string. Both formats are matched by `grepInvert: /@skip-prod/` since Playwright matches against full test titles.

### Finding 7: Audit Step is Misleading

The nightly workflow has a `@skip-prod` audit step that checks files have the tag, but this only validates tag presence — it doesn't skip the tests. The actual filtering was done by `--grep-invert` (now removed) or `grepInvert` config (not on production).

### Finding 8: Other Workflows Are Safe

| Workflow | Code Source | YAML Source | @skip-prod handling | Status |
|----------|-----------|-----------|-------------------|--------|
| CI (ci.yml) | PR branch | PR branch | isProduction=false, tests run with mocks | SAFE |
| Post-deploy smoke | production | production | Only runs @smoke tests | SAFE |
| Nightly | production | main | **NO FILTERING** | BROKEN |

The gap is isolated to the nightly workflow.

### Finding 9: Documentation Has 6 Stale Sections

| Issue | Location | Problem |
|-------|----------|---------|
| `@skip-prod` missing from tag table | testing_overview.md lines 163-171 | Tag not listed in E2E Test Tagging Strategy |
| `grepInvert` undocumented | testing_setup.md CI/CD section | Config-based filtering not mentioned |
| `E2E_TEST_MODE=true` incorrect | testing_setup.md line 349 | Says nightly uses E2E_TEST_MODE — it doesn't |
| Branch checkout behavior undocumented | testing_overview.md & testing_setup.md | No mention that nightly YAML runs from main but checks out production |
| Blocking pre-flight audit undocumented | testing_overview.md nightly section | Audit step not documented |
| Production secrets undocumented | testing_overview.md workflow comparison | Nightly uses `environment: Production` secrets |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — Documentation structure
- docs/docs_overall/architecture.md — System design, tech stack
- docs/docs_overall/project_workflow.md — Project workflow steps

### Relevant Docs
- docs/docs_overall/testing_overview.md — CI/CD workflows, nightly behavior, @skip-prod tag docs (stale)
- docs/feature_deep_dives/testing_setup.md — Test tiers, E2E patterns, AI suggestion test helpers (stale)
- docs/docs_overall/environments.md — GitHub secrets, Production vs Staging env config
- docs/docs_overall/debugging.md — Debugging tools and four-phase methodology

## Code Files Read
- `.github/workflows/e2e-nightly.yml` — Nightly workflow: checkout production, no `--grep-invert` on CLI
- `.github/workflows/ci.yml` — CI workflow: PR branch code, isProduction=false, safe
- `.github/workflows/post-deploy-smoke.yml` — Smoke tests: only @smoke, safe
- `playwright.config.ts` (main) — Has `grepInvert: /@skip-prod/` at line 161, `isProduction` detection at line 80
- `playwright.config.ts` (production) — Does NOT have `grepInvert` — this is the root cause
- `src/components/home/HomeSearchPanel.tsx` — Button disabled logic: `disabled={isSubmitting || !query.trim()}` (line 120)
- `src/components/AIEditorPanel.tsx` — Line 360: conditional code path based on `NEXT_PUBLIC_USE_AI_API_ROUTE`
- `src/__tests__/e2e/specs/01-home/home-tabs.spec.ts` — Flaky search tests (lines 83-121)
- `src/__tests__/e2e/specs/06-ai-suggestions/content-boundaries.spec.ts` — Example failing @skip-prod test
- `src/__tests__/e2e/specs/06-ai-suggestions/user-interactions.spec.ts` — Fails waiting for `[data-diff-key]`
- `src/__tests__/e2e/specs/06-ai-suggestions/editor-integration.spec.ts` — Comment confirms API route requirement
- `src/__tests__/e2e/helpers/api-mocks.ts` — Lines 350-352: acknowledges server-side LLM mocking impossible
- `src/__tests__/e2e/helpers/suggestions-test-helpers.ts` — `waitForDiffNodes` at line 68
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts` — `getQueryFromUrl()` at line 248

## Open Questions
1. ~~Should we add `--grep-invert` back as belt-and-suspenders?~~ **YES** — resolved: belt-and-suspenders is the correct approach
2. ~~Should we also release to production?~~ **NO** — not in scope for this fix; next regular release will include config change
3. ~~For the flaky home-tabs tests — should we add `@skip-prod` or fix the waits?~~ **FIX THE WAITS** — these are production-safe tests that just need proper timing
