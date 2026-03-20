# Make Tests Less Flaky Plan

## Background
Reduce test flakiness across the codebase by identifying and fixing unreliable tests, improving test infrastructure, and adding better wait strategies and isolation patterns. This includes addressing race conditions, improving test data management, and ensuring deterministic test execution in both local and CI environments.

## Requirements (from GH Issue #739)
1. Audit all E2E tests for flakiness patterns (fixed sleeps, networkidle, missing waits)
2. Audit unit/integration tests for race conditions and shared state
3. Fix identified flaky tests with proper wait strategies
4. Improve test isolation (route cleanup, temp files, test data)
5. Add/update ESLint rules for flakiness prevention
6. Update testing documentation with findings

## Problem
Tests fail intermittently due to 3 root causes: (1) 14 E2E test suites run tests in parallel via `fullyParallel: true` while sharing `beforeAll` state that gets mutated — 9 suites modify shared explanations (edit mode, diffs, tags) causing race conditions; (2) mock helper functions in api-mocks.ts register `page.route()` handlers without unrouting previous ones, causing non-deterministic handler stacking when tests re-mock within the same test; (3) unit/integration tests leak global state via unrestored `global.fetch` assignments and module-scoped variables. Secondary issues include 1 active `networkidle` call, 7 POM methods with weak post-action waits, timing-sensitive integration assertions, and a column name bug causing silent cleanup failures.

## Options Considered

### Serial Mode Strategy
- **Option A: Add serial mode to all 14 suites** — simplest, prevents all intra-suite parallelism. Slight CI slowdown but guarantees correctness.
- **Option B: Add serial mode only to 9 HIGH-risk suites** — preserves parallelism for read-only suites. Requires accurate risk classification.
- **Chosen: Option A** — the CI slowdown is negligible (tests already run with 2 workers across files, intra-file parallelism saves <10s per suite). Correctness over speed.

### Route Stacking Fix Strategy
- **Option A: Fix inside mock helpers** — add `await page.unroute(pattern)` before `page.route()` in each helper function in api-mocks.ts. Automatic, prevents future stacking.
- **Option B: Fix in spec files** — add explicit `page.unrouteAll()` before re-mocking. More visible intent.
- **Chosen: Option A** — prevents the class of bugs entirely. Callers shouldn't need to know about route cleanup internals.

### Timing Assertion Strategy
- **Option A: Remove timing assertions entirely** — they test performance, not correctness.
- **Option B: Use 10x generous thresholds** — keeps a sanity check without CI flakiness.
- **Chosen: Option A** — timing assertions are orthogonal to correctness and belong in dedicated perf benchmarks, not CI test suites.

## Rollback Strategy

Each phase is independently revertable via `git revert` on its commit. If a phase causes MORE flakiness:
1. Revert that phase's commit immediately
2. Investigate the regression in isolation
3. Do NOT revert unrelated phases

Serial mode changes (Phase 1a) are the lowest-risk — they only restrict parallelism, never enable it. Route unrouting (Phase 1b) could theoretically break tests that intentionally stack handlers — verify no spec explicitly depends on multiple handlers for the same URL.

## Deferred Items (Out of Scope)

The following research findings are acknowledged but deferred to a future project:
- **Finding 9: Fragile admin selectors** (`.first()`, text-based selectors) — medium priority, large surface area, not a root cause of current flakiness
- **Finding 10: Asymmetric test.slow() pattern** — see Phase 1c below for the interaction with serial mode
- **Finding 11: Missing post-action waits in 4 additional spec files** (search-generate, import, add-sources, client-logging) — medium priority, not yet confirmed as active flakiness sources

## Phased Execution Plan

### Phase 1: Serial Mode + Route Stacking + test.slow() (CRITICAL fixes)
**Goal:** Eliminate the two biggest flakiness sources and fix the timeout asymmetry that interacts with serial mode.

**1a. Add serial mode to E2E test suites with shared beforeAll state**

Add `test.describe.configure({ mode: 'serial' })` (or merge with existing configure call).

**CI impact note:** Serial mode only affects intra-file test ordering. With `workers: 2`, tests across DIFFERENT files still run in parallel. Estimated CI impact: <10s slowdown per suite (most suites have 3-8 tests running ~5s each). Total estimated impact: ~1-2 minutes added to full E2E run.

HIGH-risk (confirmed to modify shared state — MUST have serial mode):
- `src/__tests__/e2e/specs/06-ai-suggestions/suggestions.spec.ts` — merge into existing `{ retries: 2 }` → `{ retries: 2, mode: 'serial' }`
- `src/__tests__/e2e/specs/06-ai-suggestions/editor-integration.spec.ts` — same
- `src/__tests__/e2e/specs/06-ai-suggestions/state-management.spec.ts` — same
- `src/__tests__/e2e/specs/06-ai-suggestions/user-interactions.spec.ts` — same
- `src/__tests__/e2e/specs/06-ai-suggestions/error-recovery.spec.ts` — same
- `src/__tests__/e2e/specs/06-ai-suggestions/content-boundaries.spec.ts` — same
- `src/__tests__/e2e/specs/06-ai-suggestions/save-blocking.spec.ts` — same
- `src/__tests__/e2e/specs/04-content-viewing/tags.spec.ts` — merge into existing `{ retries: 1 }` → `{ retries: 1, mode: 'serial' }`
- `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` — same

LOW-risk (read-only shared state, add for safety/consistency):
- `src/__tests__/e2e/specs/04-content-viewing/viewing.spec.ts`
- `src/__tests__/e2e/specs/04-content-viewing/report-content.spec.ts`
- `src/__tests__/e2e/specs/04-content-viewing/hidden-content.spec.ts`
- `src/__tests__/e2e/specs/02-search-generate/regenerate.spec.ts`

Admin specs (ALL confirmed to have adminTest.beforeAll with shared state):
- `src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts` — confirmed beforeAll at lines 184, 601
- `src/__tests__/e2e/specs/09-admin/admin-content.spec.ts` — confirmed beforeAll at line 17
- `src/__tests__/e2e/specs/09-admin/admin-reports.spec.ts` — confirmed beforeAll at line 19
- `src/__tests__/e2e/specs/09-admin/admin-strategy-budget.spec.ts` — confirmed beforeAll at line 165
- `src/__tests__/e2e/specs/09-admin/admin-strategy-registry.spec.ts` — confirmed beforeAll at line 71

**1b. Fix route handler stacking in api-mocks.ts**

Add `await page.unroute(pattern)` before each `page.route()` call in all 9 mock functions. The existing fixture teardown (base.ts:41, auth.ts:143, admin-auth.ts:155) already handles between-test cleanup via `page.unrouteAll()`. This fix addresses within-test stacking when a mock helper is called multiple times in the same test (confirmed in 5 tests across 3 spec files). Adding unroute to all 9 functions is safe and preventive — each mock helper fully owns its route pattern.

```typescript
// Before (current):
export async function mockAISuggestionsPipelineAPI(page: Page, options: ...) {
  await page.route('**/api/runAISuggestionsPipeline', async (route) => { ... });
}

// After (fixed):
export async function mockAISuggestionsPipelineAPI(page: Page, options: ...) {
  await page.unroute('**/api/runAISuggestionsPipeline');
  await page.route('**/api/runAISuggestionsPipeline', async (route) => { ... });
}
```

Functions to fix (all in `src/__tests__/e2e/helpers/api-mocks.ts`):
1. `mockReturnExplanationAPI` (line ~41) — pattern: `'**/api/returnExplanation'`
2. `mockReturnExplanationAPIError` (line ~63) — same pattern
3. `mockReturnExplanationAPISlow` (line ~81) — same pattern
4. `mockUserLibraryAPI` (line ~244) — pattern: `'**/userlibrary'`
5. `mockExplanationByIdAPI` (line ~265) — pattern: `'**/api/getExplanation**'`
6. `mockReturnExplanationValidationError` (line ~283) — same as #1
7. `mockReturnExplanationTimeout` (line ~302) — same as #1
8. `mockReturnExplanationStreamError` (line ~314) — same as #1
9. `mockAISuggestionsPipelineAPI` (line ~367) — pattern: `'**/api/runAISuggestionsPipeline'`

**1c. Fix asymmetric test.slow() timeout pattern**

56 AI suggestion tests use `if (testInfo.retry === 0) test.slow()` giving 180s on first attempt but only 60s on retries. With serial mode (Phase 1a), a timeout-induced retry failure now blocks all subsequent tests in the suite. Fix by applying test.slow() unconditionally:

```typescript
// Before:
if (testInfo.retry === 0) test.slow();

// After:
test.slow();
```

Also fix 2 tests with conflicting `test.slow()` + `test.setTimeout(60000)` — remove the `test.setTimeout()` since `test.slow()` already handles the timeout:
- `src/__tests__/e2e/specs/06-ai-suggestions/content-boundaries.spec.ts:160-161`
- `src/__tests__/e2e/specs/06-ai-suggestions/error-recovery.spec.ts:238-239`

**Verification:**
- Run lint, tsc, build
- Run unit tests
- Run E2E critical tests
- Run ALL 9 HIGH-risk spec files individually to confirm serial mode works correctly
- Run the 3 route-stacking-affected spec files (error-recovery, user-interactions, state-management) to confirm stacking is resolved
- Create a draft PR and run full CI pipeline to measure actual CI time impact

### Phase 2: Column Name Bug + networkidle + POM Waits (HIGH fixes)

**2a. Fix column name bug in integration-helpers.ts**

```typescript
// File: src/testing/utils/integration-helpers.ts:106
// Before:
await supabase.from('userLibrary').delete().in('explanation_id', explanationIds);
// After:
await supabase.from('userLibrary').delete().in('explanationid', explanationIds);
```

**2b. Replace last active networkidle call**

```typescript
// File: src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts:280-281
// Before:
// eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
await adminPage.waitForLoadState('networkidle');

// After (data-testid confirmed to exist in admin-arena.spec.ts):
await adminPage.waitForLoadState('domcontentloaded');
await adminPage.locator('[data-testid="leaderboard-table"]').waitFor({ state: 'visible', timeout: 10000 });
```

Remove the eslint-disable comment since the violation is fixed.

**2c. Fix 7 POM methods with weak/missing post-action waits**

Each method must wait for a SPECIFIC observable state change (Rule 12), not generic `domcontentloaded`. Read each method's surrounding code to determine the correct wait target.

In `src/__tests__/e2e/helpers/pages/ResultsPage.ts`:

1. `clickRewriteWithTags()` (line 367) — wait for TagBar to appear: `await this.page.locator('[data-testid="tag-bar"]').waitFor({ state: 'visible', timeout: 5000 });`
2. `clickEditWithTags()` (line 373) — wait for TagBar to appear: same as above
3. `clickChangesPanelToggle()` (line 709) — wait for changes panel to toggle visibility: `await this.page.locator('[data-testid="changes-panel"]').waitFor({ timeout: 5000 });` (check current vs toggled state)
4. `clickEditButton()` (line 555) — wait for edit mode indicator: `await this.page.locator('[data-testid="done-editing-button"]').waitFor({ state: 'visible', timeout: 5000 });`
5. `clickPublishButton()` (line 576) — wait for publish confirmation or API response: `await this.page.waitForResponse(resp => resp.url().includes('/explanations') && resp.status() === 200, { timeout: 10000 });`
6. `selectMode()` (line 598) — wait for mode dropdown to close and mode indicator to update: `await this.page.locator('[role="listbox"]').waitFor({ state: 'hidden', timeout: 5000 });`

In `src/__tests__/e2e/helpers/pages/ImportPage.ts`:

7. `selectSource()` (line 56) — wait for listbox to close after option click: `await this.page.locator('[role="listbox"]').waitFor({ state: 'hidden', timeout: 5000 });`

**Note:** The exact selectors above are best-guesses from research. During implementation, read the actual component code to verify the correct data-testid or element to wait for. If a data-testid doesn't exist, add one to the component.

**Verification:** Run lint, tsc, build. Run unit tests. Run integration tests. Run E2E critical tests.

### Phase 3: Unit/Integration Test Isolation (HIGH fixes)

**3a. Fix unrestored global.fetch in 6 unit test files**

For each file, add the `sourceFetcher.test.ts` pattern:

```typescript
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
```

Files:
- `evolution/src/services/evolutionRunClient.test.ts`
- `src/app/api/traces/route.test.ts`
- `src/lib/tracing/__tests__/fetchWithTracing.test.ts`
- `src/lib/logging/client/__tests__/remoteFlusher.test.ts`
- `src/lib/sessionId.test.ts`
- `src/app/api/monitoring/route.test.ts`

**3b. Fix titleGenerated module-scoped flag**

```typescript
// File: src/__tests__/integration/explanation-generation.integration.test.ts
// Move titleGenerated inside test scope, or reset it in beforeEach:
beforeEach(() => {
  // ... existing setup ...
  titleGenerated = false; // Reset module-scoped flag
});
```

**3c. Remove timing-sensitive integration assertions**

- `src/__tests__/integration/logging-infrastructure.integration.test.ts:146` — remove `expect(avgTimePerCall).toBeLessThan(100)` or change to `toBeLessThan(1000)` (10x)
- `src/__tests__/integration/tag-management.integration.test.ts:213` — remove `expect(duration).toBeLessThan(15000)` or change to `toBeLessThan(60000)` (4x)

**Verification:** Run lint, tsc, build. Run full unit test suite. Run integration tests.

### Phase 4: Documentation + ESLint Updates (MEDIUM)

**4a. Update testing_overview.md**
- Add Rule 12 enforcement note: serial mode is now applied to all beforeAll suites
- Update enforcement summary table with new patterns
- Document the route unrouting pattern as standard practice
- Note the column name convention difference (userLibrary uses `explanationid`, explanation_tags uses `explanation_id`)

**4b. Update testing_setup.md**
- Add "Route Mock Cleanup" section documenting the unroute-before-route pattern
- Update Known Issues: remove items that have been fixed
- Add global.fetch restoration pattern to test utilities section

**4c. Update ESLint rule for adminTest.skip()**

The `no-test-skip` rule only catches `test.skip()` but 9 `adminTest.skip()` calls bypass it. Update `eslint-rules/no-test-skip.js` to also catch `adminTest.skip()` patterns:

```javascript
// In the MemberExpression visitor, also check for adminTest.skip
if (
  (node.object.name === 'test' || node.object.name === 'adminTest') &&
  node.property.name === 'skip'
) { ... }
```

**Verification:** Run lint, tsc, build. Run `npm run test:eslint-rules`. Run unit tests.

## Testing

### Per-Phase Verification
Each phase has its own verification gate (see "Verification" under each phase). Do NOT proceed to the next phase until the current phase's verification passes.

### Full Verification (after all phases)
- **Unit tests:** Full suite (`npm test`) — verify no regressions from global.fetch restoration and timing assertion changes
- **Integration tests:** Full suite (`npm run test:integration`) — verify column name fix works (query for orphaned `[TEST]` records in `userLibrary` to confirm cleanup now succeeds), titleGenerated fix, timing assertion changes
- **E2E critical:** `npm run test:e2e:critical` — verify serial mode and route unrouting don't break test execution
- **E2E full (9 HIGH-risk suites):** Run each of the 9 HIGH-risk spec files individually to confirm serial mode and route stacking fixes work correctly
- **ESLint rule tests:** `npm run test:eslint-rules` — verify updated no-test-skip rule catches adminTest.skip
- **CI dry-run:** Create a draft PR to main and verify the full CI pipeline passes before requesting review. Measure actual CI time to confirm serial mode impact is within the estimated ~1-2 minute range. If serial mode adds >3 minutes to CI, investigate which suites are disproportionately slow and consider splitting them into smaller spec files.

### Manual Verification
- Run admin-arena.spec.ts to confirm networkidle replacement works
- Spot-check 2-3 POM method fixes by running their associated spec files

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/testing_overview.md` - Update enforcement summary, add serial mode rule, route cleanup pattern
- `docs/feature_deep_dives/testing_setup.md` - Add route mock cleanup section, update known issues, global.fetch pattern
- `docs/feature_deep_dives/testing_pipeline.md` - No changes needed (AI suggestion A/B testing infrastructure not affected)
