# Bifurcate Test Set Evolution Vs Non Evolution Plan

## Background
E2E tests fail on every mainToProd attempt, blocking production deploys. Root causes fall into 4 patterns: React hydration races, wrong selectors, state propagation timing, and server readiness. Additionally, the CI lacks evolution/non-evolution test routing for PRs to main, and SHARED_PATHS is too broad.

## Requirements (from GH Issue #774)
1. Fix consistently failing E2E tests blocking mainToProd
2. Fix intermittently flaky E2E tests
3. Ensure only evolution tests run when only evolution code changes (and vice versa)
4. Narrow SHARED_PATHS so most src/lib/ changes don't trigger full test suites

## Problem
5 E2E tests fail 100% of the time in CI, causing every mainToProd PR to fail. Another 8 tests fail 40-80% of the time, making CI unreliable even when the deterministic bugs are fixed. The root causes are test-level bugs (wrong selectors, missing waits, incorrect POM usage), not application bugs. The CI also wastes resources running all tests for evolution-only or non-evolution-only changes.

## Options Considered

### For flaky test fixes
1. **Fix root causes only** — Address each test's specific bug. Most reliable but requires per-test investigation.
2. **Add retries** — Increase Playwright retries from 2 to 3. Masks problems, doesn't fix them.
3. **Fix root causes + add targeted waits** — Fix bugs and add hydration/state waits where needed. **(Chosen)**

### For CI bifurcation
1. **Narrow SHARED_PATHS only** — Replace `src/lib/` with specific bridge files. Simple, high impact.
2. **Add main branch routing** — Add evolution-aware jobs for PRs to main (like production has). More work.
3. **Both** — Narrow SHARED_PATHS AND add main branch routing. **(Chosen for later phase)**

## Phased Execution Plan

### Phase 1: Fix Deterministic Failures (DONE ✓)
Fixed in commit 67268356:
- home-tabs: React hydration wait before fill()
- search-generate: nav variant selector on results page
- action-buttons: wait for textarea value after format toggle
- import-articles: click button directly, not clickProcess()
- add-sources: remove sources-failed-message assertion

### Phase 2: Fix Category B — Consistently Failing
**admin-strategy-budget** "budget cap input constraints" (8/10 failures):
- Investigate: read test file, check what selector/assertion fails
- Likely: new evolution page needs data seeding or hydration wait

**search-generate** "should not submit empty query" (8/10 failures):
- Same hydration pattern as home-tabs — SearchPage.fillQuery() on home page without hydration wait
- Fix: the test uses SearchPage.navigate() which DOES wait for hydration, so investigate further

### Phase 3: Fix Category C — Intermittent Flakes
Priority order by failure frequency:

1. **admin-arena** (2 tests, 6/10) — topic list + prompt bank UI
2. **tags** "show management buttons" (6/10) — React state timing
3. **action-buttons** "exit edit mode" (6/10) — edit mode transition wait
4. **smoke** "home page loads" (6/10) — server readiness
5. **tags** "preserve state after refresh" (4/10) — reload timing
6. **admin-strategy-registry** "Origin filter" (4/10) — evolution admin timing

### Phase 4: CI Bifurcation (follow-up)
1. Narrow SHARED_PATHS: replace `src/lib/` with ~10 specific bridge files
2. Add main branch evolution-aware routing
3. Add `@evolution` tags to 3 missing E2E specs

## Testing
- Run full E2E suite locally after each phase
- Verify CI passes on PR to main
- Verify mainToProd succeeds after all fixes land

## Documentation Updates
The following docs may need updates:
- `docs/docs_overall/testing_overview.md` — Update CI workflow description if bifurcation changes
- `docs/feature_deep_dives/testing_setup.md` — Update test statistics, known issues section
