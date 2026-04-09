# Find Fix Flaky Tests Plan

## Background
Main branch has gotten into a broken state where not all tests pass. A force merge was required to get code into main without all tests passing. This project will run the full local test suite (lint, typecheck, build, unit, ESM, integration, E2E critical) equivalent to /finalize checks, identify all failures, and fix them to restore CI health and developer confidence.

## Requirements (from GH Issue #TBD)
- Run the entire test suite that would run on merging into main locally (equivalent to /finalize)
- Fix everything that fails
- Main has somehow gotten into a broken state and had to force merge without all tests passing

## Problem
75 E2E critical tests were failing due to a combination of: (1) a React 18 strict mode bug in `useExplanationLoader` where `isMountedRef` was never reset to `true` after remount, silently killing all async `loadExplanation` calls; (2) Playwright test helpers constructing absolute URLs with hardcoded port fallbacks instead of using Playwright's `baseURL`; (3) POMs clicking elements before React hydration completed; (4) a missing catch-all route for evolution 404; (5) a Unicode ellipsis mismatch in a test string.

## Options Considered
- [x] **Option A: Fix root causes**: Identify and fix each distinct root cause rather than patching test timeouts
- [x] ~~**Option B: Increase timeouts only**: Would mask real bugs~~ (rejected)

## Phased Execution Plan

### Phase 1: Run Full Test Suite
- [x] Run lint, typecheck, build
- [x] Run unit tests
- [x] Run ESM tests
- [x] Run integration tests
- [x] Run E2E critical tests

### Phase 2: Fix Failures
- [x] Identify root cause of each failure
- [x] Apply targeted fixes
- [x] Re-run affected tests to verify

### Phase 3: Prevent Regressions
- [x] Add testing rules 17-18 to testing_overview.md
- [x] Create ESLint rule `no-hardcoded-base-url`
- [x] Create ESLint rule `require-hydration-wait`
- [x] Fix all existing lint violations from new rules
- [x] Add React strict mode guidance to testing config docs

## Testing

### Unit Tests
- [x] All existing unit tests pass (275 suites, 4991 passed)

### Integration Tests
- [x] All integration tests pass (36 suites, 254 passed)

### E2E Tests
- [x] All E2E critical tests pass (53 passed, 0 failed)

### Manual Verification
- [x] Full test suite green

## Verification

### B) Automated Tests
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`
- [x] `npm run test:esm`
- [x] `npm run test:integration`
- [x] `npm run test:e2e:critical`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/docs_overall/testing_overview.md` — added rules 17-18, React strict mode warning, enforcement table entries
- [x] `docs/feature_deep_dives/testing_setup.md` — no changes needed
- [x] `docs/docs_overall/environments.md` — no changes needed
- [x] `evolution/docs/architecture.md` — no changes needed
- [x] `docs/docs_overall/debugging.md` — no changes needed
- [x] `docs/feature_deep_dives/debugging_skill.md` — no changes needed

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
