# Fix Failed Nightly Run Plan

## Background
The nightly E2E test run has failed for 2 consecutive days (Feb 28 and Mar 1) after 3 days of passing. All 26 failures are @skip-prod tagged AI suggestions tests that are running against the production URL but should either be skipped or the production environment no longer supports them. Additionally, 2 home-tabs search tests are flaky on Chromium (search button stays disabled). The root cause needs investigation — either the nightly workflow isn't filtering @skip-prod tests, the production deployment changed, or the tests themselves need updating.

## Requirements (from GH Issue #596)
1. Investigate why 26 @skip-prod AI suggestions tests are not being skipped in the nightly workflow
2. Determine if @skip-prod filtering was recently removed or never existed in e2e-nightly.yml
3. Fix the nightly workflow to properly skip @skip-prod tests, OR fix the tests to work against production
4. Investigate the 2 flaky home-tabs search tests (search button disabled timeout)
5. Fix the flaky tests or add proper waits/retries
6. Verify the fix by triggering a manual nightly run
7. Update testing documentation if workflow behavior changes

## Problem
PR #589 (merged Feb 27) moved @skip-prod test filtering from the nightly workflow CLI (`--grep-invert="@skip-prod"`) to `playwright.config.ts` (`grepInvert`). However, the nightly workflow YAML runs from `main` (GitHub Actions cron behavior) while test code is checked out from `production`. The `production` branch doesn't have the config-based `grepInvert` (30 commits behind), so 26 @skip-prod AI suggestion tests now run unfiltered against production and fail. Additionally, 2 home-tabs search tests have a race condition — they click the submit button before React enables it.

## Options Considered

### Option A: Add `--grep-invert` back to workflow CLI (belt-and-suspenders)
- **Pros:** Immediate fix, works regardless of production branch state, defense-in-depth
- **Cons:** Redundant with config-based approach once production catches up

### Option B: Release main to production
- **Pros:** Gets config-based filter deployed, resolves gap permanently
- **Cons:** Brings 30 unreleased commits, larger blast radius, doesn't prevent future gaps

### Option C: Both A + B
- **Pros:** Immediate fix AND long-term alignment
- **Cons:** Deployment overhead

### Recommended: Option A only (minimal fix on this branch)
Add `--grep-invert="@skip-prod"` back to the workflow CLI as belt-and-suspenders alongside the config-based approach. This ensures the nightly works regardless of which branch's config is checked out. The next regular production release will naturally bring the config change. Also fix the home-tabs flaky tests.

## Phased Execution Plan
[To be completed after plan review]

## Testing
[To be completed after plan review]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/testing_overview.md` - May need updates to nightly workflow behavior, @skip-prod tag documentation
- `docs/feature_deep_dives/testing_setup.md` - May need updates to test tagging strategy
- `docs/docs_overall/environments.md` - May need updates if environment config changes
- `docs/docs_overall/debugging.md` - No changes expected
