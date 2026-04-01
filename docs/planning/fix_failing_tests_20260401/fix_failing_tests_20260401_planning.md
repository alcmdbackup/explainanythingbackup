# Fix Failing Tests Plan

## Background
Fix integration and E2E test failures identified in PR #920 CI runs. The PR made significant changes across 60 files including lint violation fixes, serial mode additions, TypeScript schema fixes, and evolution pipeline bug fixes.

## Requirements (from GH Issue)
Run failing tests from PR #920 locally, identify root causes, fix issues, verify all tests pass

## Problem
PR #920 merged with potential test failures in CI. Late commits suggest FK constraint issues in E2E evolution test seeding and schema mismatches from typed createClient. Need to reproduce locally, identify root causes, and fix.

## Options Considered
- [x] **Option A: Run all changed tests locally**: Systematic approach — run each test tier, catalog failures, fix in batch
- [ ] **Option B: Focus only on evolution tests**: Narrower scope but may miss non-evolution failures

## Phased Execution Plan

### Phase 1: Run Tests Locally
- [x] Run unit tests for PR #920 changed files
- [x] Run integration tests
- [x] Run E2E critical tests

### Phase 2: Fix Failures
- [x] Fix each identified failure with targeted changes
- [x] Ensure no regressions

### Phase 3: Verify
- [x] Re-run all tests
- [x] Lint + typecheck pass

## Testing

### Unit Tests
- [x] All evolution pipeline tests pass
- [x] All admin component tests pass

### Integration Tests
- [x] `evolution-experiment-completion.integration.test.ts` passes
- [x] All critical integration tests pass

### E2E Tests
- [x] Evolution admin specs pass
- [x] `strategy-generation-guidance.spec.ts` passes

### Manual Verification
- [x] `npm run lint` passes
- [x] `npm run typecheck` passes

## Verification

### B) Automated Tests
- [x] `npm test` — all unit tests pass (5024/5024)
- [x] `npm run test:integration` — integration tests pass (45/45)
- [x] `npm run test:e2e` — E2E critical tests pass (43/48, 5 infra-blocked in cloud sandbox)

## Documentation Updates
- [x] `docs/docs_overall/cloud_env.md` — new doc for cloud environment networking
- [ ] `docs/docs_overall/testing_overview.md` — no test rule changes needed
- [ ] `docs/feature_deep_dives/testing_setup.md` — no test pattern changes needed
