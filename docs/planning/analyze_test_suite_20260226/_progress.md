# Analyze Test Suite — Progress

## Phase 1: Quick Wins — Dead Code, Debug Cleanup, CI Hardening
### Work Done
- [ ] 1a. Delete dead code (3 items)
- [ ] 1b. Remove debug console.log statements (3 files)
- [ ] 1c. Add CI job timeouts (2 workflow files)
- [ ] 1d. Add Jest flags (package.json)
- [ ] 1e. Fix hardcoded credentials (2 files)

## Phase 2: E2E Flakiness — networkidle Migration (POMs)
- [ ] Migrate 29 networkidle calls in 6 admin POM files

## Phase 3: E2E Flakiness — networkidle (Specs) + POM Rule 12
- [ ] 3a. Spec networkidle removal
- [ ] 3b. Non-admin POM fixes

## Phase 4: E2E Tagging and Test Organization
- [ ] Fix @critical tag syntax
- [ ] Add grepInvert for @skip-prod
- [ ] Add @critical tags to auth/library specs

## Phase 5: Un-skip Tests
- [ ] Un-skip ~44 tests across 6 spec files

## Phase 6: Unit/Integration Flakiness Fixes
- [ ] 6a. Unit test flakiness
- [ ] 6b. Integration test flakiness
- [ ] 6c. vectorsim.ts lazy initialization
- [ ] 6d. Centralized mock cleanup

## Phase 7: Coverage Gaps — New Unit Tests
- [ ] linkCandidates.test.ts
- [ ] sourceSummarizer.test.ts

## Phase 8: Fragile Selectors — data-testid Migration
- [ ] Add data-testid attributes
- [ ] Migrate spec selectors

## Phase 9: Documentation Updates
- [ ] testing_overview.md
- [ ] testing_setup.md
- [ ] testing_pipeline.md

## Phase 10: CI Improvements
- [ ] Optional improvements
