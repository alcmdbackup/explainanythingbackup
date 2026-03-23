# Bifurcate Test Set Evolution Vs Non Evolution Research

## Problem Statement
E2E tests are failing on every mainToProd attempt, blocking production deploys. Investigation revealed two categories: (1) tests with deterministic bugs that fail 100% of the time, and (2) intermittently flaky tests caused by React hydration races, selector mismatches, and state timing issues. Additionally, CI test routing for PRs to main lacks evolution/non-evolution awareness, and the SHARED_PATHS pattern is too broad.

## Requirements (from GH Issue #774)
1. Fix consistently failing E2E tests blocking mainToProd
2. Fix intermittently flaky E2E tests
3. Ensure only evolution tests run when only evolution code changes (and vice versa)
4. Narrow the SHARED_PATHS pattern so most src/lib/ changes don't trigger full test suites

## High Level Summary

### Data Source
Analyzed failure logs across 10 recent failed CI runs on the `deploy/main-to-production-mar21` branch. Every run classified as `path=full` because the main→production diff touches shared code (`src/lib/`), so both evolution and non-evolution E2E shards ran every time.

### Test Failure Taxonomy

**Category A — Deterministic Bugs (100% failure rate, already fixed in commit 67268356):**

| Test | Failures/10 | Root Cause | Fix Applied |
|---|---|---|---|
| import-articles "content under minimum length" | 10/10 | `clickProcess()` waits for preview, but validation errors stay in modal | Click button directly, wait for error |
| add-sources "failed source fetch" | 10/10 | `sources-failed-message` testid only in SourceList, not HomeSourcesRow | Removed assertion, failed chip suffices |
| search-generate "search from results page" | 10/10 | Uses `home-search-input` selector on results page (only has `search-input`) | Use nav variant selector |
| home-tabs "submit on button click" | 8/10 | `fill()` before React hydration — onChange never fires | Wait for `__reactFiber` props |
| action-buttons "preserve content toggling" | 8/10 | Reads content before textarea state propagates after toggle | Wait for textarea value |

**Category B — Consistently Failing, Not Yet Fixed:**

| Test | Failures/10 | Root Cause Hypothesis |
|---|---|---|
| admin-strategy-budget "budget cap input constraints" | 8/10 | Evolution admin page — likely selector/data seeding issue on new page |
| search-generate "should not submit empty query" | 8/10 | Same hydration race as home-tabs — SearchPage POM uses home selectors |

**Category C — Intermittently Flaky (appear in 2-6/10 runs):**

| Test | Failures/10 | Root Cause Pattern |
|---|---|---|
| admin-arena "topic list with summary cards" | 6/10 | Evolution E2E — data seeding or timing |
| admin-arena "prompt bank coverage grid" | 6/10 | Same root cause as above |
| tags "show management buttons when modified" | 6/10 | React state timing — tag modification not reflected before assertion |
| action-buttons "exit edit mode when done clicked" | 6/10 | Edit mode transition timing — button text change not awaited |
| smoke "home page loads and has search bar" | 6/10 | Server startup race — app not ready when test runs |
| tags "preserve tag state after refresh" | 4/10 | State persistence timing after page reload |
| admin-strategy-registry "Origin filter dropdown" | 4/10 | Evolution admin — new page, likely needs hydration wait |

**Category D — Rare Flakes (1-2/10 runs, likely CI resource pressure):**

| Test | Failures/10 |
|---|---|
| report-content "close modal when X clicked" | 2/10 |
| report-content "require reason before submission" | 2/10 |
| report-content "modal z-index" | 2/10 |
| tags "open tag input when add clicked" | 2/10 |
| tags "display removed tags with minus" | 2/10 |
| global-error "no error boundary when no error" | 2/10 |
| library "search from library page" | 2/10 |
| viewing "save button state" | 1/10 |
| search-generate "display full content after streaming" | 2/10 |
| admin-variant-detail (2 tests) | 2/10 |

### Common Root Cause Patterns

**Pattern 1 — React Hydration Race (affects 6+ tests)**
Tests navigate to a page with `waitForLoadState('domcontentloaded')` but interact with inputs before React hydration completes. Playwright's `fill()` sets the DOM value but React's onChange never fires because event handlers aren't attached yet. The SearchPage POM's `navigate()` method correctly waits for `__reactFiber` props, but tests that navigate directly skip this.

**Pattern 2 — Wrong Selector for Page Context (affects 3+ tests)**
SearchPage POM uses `[data-testid="home-search-input"]` which only exists on the home page. The results page and other pages use a nav variant with `[data-testid="search-input"]`. Tests using SearchPage methods on non-home pages timeout.

**Pattern 3 — State Propagation After UI Transition (affects 4+ tests)**
Tests assert content/state immediately after a UI transition (format toggle, edit mode, tag modification) without waiting for React state updates to complete. The POM methods wait for the trigger element to change but not for dependent state.

**Pattern 4 — Server/Data Readiness (affects 3+ tests)**
Smoke tests and data-dependent tests occasionally fail because the Next.js server isn't fully ready or test data seeding hasn't completed before assertions run.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Testing Docs
- docs/docs_overall/testing_overview.md — CI workflow structure, test tiers, tag strategy
- docs/feature_deep_dives/testing_setup.md — Test configs, directory structure, mocking patterns

### Evolution Docs
- All 14 evolution docs in evolution/docs/evolution/

## Code Files Read

### CI & Config
- `.github/workflows/ci.yml` — Full CI workflow with change detection, job conditions, test routing
- `.github/workflows/e2e-nightly.yml` — Nightly production E2E
- `.github/workflows/post-deploy-smoke.yml` — Post-deploy smoke
- `jest.config.js` — Unit test config (covers both src/ and evolution/)
- `jest.integration.config.js` — Integration test config
- `playwright.config.ts` — E2E config with projects and tag filtering
- `package.json` — All test scripts

### Failing E2E Tests (read full files)
- `src/__tests__/e2e/specs/01-home/home-tabs.spec.ts`
- `src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts`
- `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts`
- `src/__tests__/e2e/specs/06-import/import-articles.spec.ts`
- `src/__tests__/e2e/specs/08-sources/add-sources.spec.ts`

### POMs & Helpers
- `src/__tests__/e2e/helpers/pages/SearchPage.ts`
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts`
- `src/__tests__/e2e/helpers/pages/ImportPage.ts`

### Components (verified selectors)
- `src/components/home/HomeSearchPanel.tsx` — `home-search-input`, `home-search-submit`
- `src/components/SearchBar.tsx` — `search-input` (nav variant)
- `src/components/home/HomeSourcesRow.tsx` — No `sources-failed-message`
- `src/components/sources/SourceList.tsx` — Has `sources-failed-message`
- `src/components/import/ImportModal.tsx` — `import-error` element

## CI Architecture Findings

### Change Detection (ci.yml detect-changes job)
- `SHARED_PATHS`: `package\.json|tsconfig|next\.config|playwright\.config|jest\.config|src/lib/|src/utils/|src/types/`
- `EVOLUTION_ONLY_PATHS`: `evolution|arena|strategy-resolution|manual-experiment|src/app/admin/quality/optimization/`
- Problem: `src/lib/` is too broad — treats 200+ files as shared when evolution only imports ~10

### mainToProd Always Runs Full Suite
The main→production diff always hits shared paths (accumulated changes across many PRs), so `path=full` triggers every time. This is correct behavior but means flaky tests block every deploy.

### Main Branch Lacks Bifurcation
PRs to main run `integration-critical` + `e2e-critical` regardless of `evolution-only` vs `non-evolution-only` path classification. Production PRs have proper routing.

## Open Questions
1. Should Category B tests be fixed with the same patterns as Category A, or do they need deeper investigation?
2. For Category C flakes, should we add retries, fix root causes, or both?
3. Should the SHARED_PATHS narrowing be part of this project or a separate follow-up?
