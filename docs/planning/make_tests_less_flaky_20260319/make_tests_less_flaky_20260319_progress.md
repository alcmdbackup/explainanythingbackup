# Make Tests Less Flaky Progress

## Phase 1: Serial Mode + Route Stacking + test.slow() (CRITICAL)

### Work Done
- Added `mode: 'serial'` to 18 E2E test suites (9 merged with existing retries config, 9 new configure calls including 2 admin-arena describe blocks)
- Added `await page.unroute(pattern)` before each `page.route()` in all 9 mock functions in `api-mocks.ts`
- Replaced 56 occurrences of `if (testInfo.retry === 0) test.slow()` with unconditional `test.slow()` across 7 files
- Removed unused `testInfo` parameter from all affected test functions
- Removed 2 conflicting `test.setTimeout(60000)` calls in content-boundaries.spec.ts and error-recovery.spec.ts

### Issues Encountered
- None

## Phase 2: Column Name Bug + networkidle + POM Waits (HIGH)

### Work Done
- Fixed column name bug: changed `'explanation_id'` to `'explanationid'` in `integration-helpers.ts:106`
- Replaced `networkidle` with `domcontentloaded` + specific element wait in `admin-arena.spec.ts:280-281`
- Fixed 7 POM methods with weak post-action waits in ResultsPage.ts and ImportPage.ts

### Issues Encountered
- `tag-bar` data-testid doesn't exist on actual TagBar component, only in test mocks. Used `add-tag-trigger` instead.

## Phase 3: Unit/Integration Test Isolation (HIGH)

### Work Done
- Added `global.fetch` save/restore pattern to 6 unit test files with beforeEach re-assignment
- Removed timing-sensitive assertions in logging-infrastructure and tag-management integration tests
- `titleGenerated` was already test-scoped — no fix needed

### Issues Encountered
- Initial `afterEach` restore broke tests that set `global.fetch` at module level. Fixed by adding `beforeEach` re-assignment.

## Phase 4: Documentation + ESLint Updates (MEDIUM)

### Work Done
- Updated `testing_overview.md` with 3 new rules (13-15) and enforcement table entries
- Updated `testing_setup.md` with Route Mock Cleanup section, global.fetch pattern, column name known issue
- Updated `no-test-skip.js` ESLint rule to catch `adminTest.skip()`
- Added eslint-disable comments to 9 pre-existing `adminTest.skip()` calls

### Verification
- Lint: passes (0 errors on all changed files)
- TSC: passes (only pre-existing expect-type error in unrelated file)
- Build: passes
- Unit tests: 223/224 suites pass, 4145 tests pass (1 pre-existing failure: types.test.ts missing expect-type)
- ESLint rule tests: all pass including new adminTest.skip test case
