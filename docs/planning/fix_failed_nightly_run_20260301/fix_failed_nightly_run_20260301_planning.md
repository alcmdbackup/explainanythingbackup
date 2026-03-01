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

### Phase 1: Fix nightly workflow (1 file)

**File:** `.github/workflows/e2e-nightly.yml` line 157

**Change:** Add `--grep-invert="@skip-prod"` back to the CLI command as belt-and-suspenders:
```yaml
# Before:
run: npx playwright test --project=${{ matrix.browser }}

# After:
run: npx playwright test --project=${{ matrix.browser }} --grep-invert="@skip-prod"
```

Also update the comment on line 156 to document the belt-and-suspenders approach:
```yaml
# Belt-and-suspenders: CLI filter ensures @skip-prod tests are skipped regardless
# of which branch's playwright.config.ts is checked out (main vs production).
# The config-based grepInvert in playwright.config.ts provides defense-in-depth.
```

### Phase 2: Fix flaky home-tabs tests (1 file)

**File:** `src/__tests__/e2e/specs/01-home/home-tabs.spec.ts`

**Test 1** (line 93-94): "should submit search on Enter key"
```typescript
// Before:
await searchInput.fill('quantum entanglement');
await searchInput.press('Enter');

// After:
await searchInput.fill('quantum entanglement');
await expect(page.locator('[data-testid="home-search-submit"]')).toBeEnabled();
await searchInput.press('Enter');
```

**Test 2** (line 114-115): "should submit search on button click"
```typescript
// Before:
await searchInput.fill('quantum entanglement');
await searchButton.click();

// After:
await searchInput.fill('quantum entanglement');
await expect(searchButton).toBeEnabled();
await searchButton.click();
```

### Phase 3: Update documentation (2 files)

**File 1:** `docs/docs_overall/testing_overview.md`
- Add `@skip-prod` to the E2E Test Tagging Strategy table (lines 163-171)
- Document belt-and-suspenders approach in nightly workflow section
- Document that nightly YAML runs from main but checks out production code
- Document the blocking pre-flight audit step

**File 2:** `docs/feature_deep_dives/testing_setup.md`
- Document `grepInvert` config-based filtering in CI/CD section
- Fix incorrect `E2E_TEST_MODE=true` reference (line 349)
- Document production secrets usage in nightly workflow

### Phase 4: Verify

- Run lint, tsc, build to ensure no regressions
- Trigger manual nightly run via `gh workflow run e2e-nightly.yml`
- Monitor the run to confirm @skip-prod tests are properly skipped

## Testing

### Automated verification
- `npm run lint` — ensure no linting issues in modified files
- `npx tsc --noEmit` — typecheck passes
- `npm run build` — build succeeds

### Manual verification
- Trigger nightly workflow: `gh workflow run e2e-nightly.yml`
- Verify test count matches pre-#589 levels (~101 passed, ~107 skipped, 0 failed)
- Verify @skip-prod tests appear in "skipped" category, not "failed"
- Verify home-tabs search tests pass without flakiness on both browsers

## Documentation Updates
The following docs were identified as relevant and need updates:
- `docs/docs_overall/testing_overview.md` — Add @skip-prod to tag table, document nightly branch behavior, document pre-flight audit, document belt-and-suspenders approach
- `docs/feature_deep_dives/testing_setup.md` — Document grepInvert config, fix E2E_TEST_MODE reference, document production secrets
- `docs/docs_overall/environments.md` — No changes needed (production secrets already documented)
- `docs/docs_overall/debugging.md` — No changes needed
