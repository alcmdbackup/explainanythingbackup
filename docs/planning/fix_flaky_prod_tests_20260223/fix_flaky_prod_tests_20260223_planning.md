# Fix Flaky Prod Tests Plan

## Background
Want to diagnose all tests that are flaky. Ignore tests that are now permanently fixed.

## Requirements (from GH Issue #TBD)
1. Audit all test suites (unit, integration, E2E, smoke, nightly) to identify tests exhibiting flaky behavior
2. Review recent CI, nightly, and post-deploy smoke run history on GitHub Actions for patterns of intermittent failures
3. For each flaky test, determine root cause (timing issues, race conditions, external dependency instability, test isolation problems, etc.)
4. Categorize tests as: currently flaky vs. recently fixed — ignore tests that are now permanently fixed
5. Fix or stabilize each currently flaky test
6. Document per-test diagnosis and fix in progress doc

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/testing_overview.md` - May need updates to flakiness prevention rules or known issues
- `docs/feature_deep_dives/testing_setup.md` - May need updates to known issues section or test patterns
- `docs/docs_overall/environments.md` - May need updates if environment config contributes to flakiness
- `docs/feature_deep_dives/debugging_skill.md` - May need updates to debugging methodology for flaky tests
