# Fix Flaky Prod Tests Research

## Problem Statement
Want to diagnose all tests that are flaky. Ignore tests that are now permanently fixed.

## Requirements (from GH Issue #TBD)
1. Audit all test suites (unit, integration, E2E, smoke, nightly) to identify tests exhibiting flaky behavior
2. Review recent CI, nightly, and post-deploy smoke run history on GitHub Actions for patterns of intermittent failures
3. For each flaky test, determine root cause (timing issues, race conditions, external dependency instability, test isolation problems, etc.)
4. Categorize tests as: currently flaky vs. recently fixed — ignore tests that are now permanently fixed
5. Fix or stabilize each currently flaky test
6. Document per-test diagnosis and fix in progress doc

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/environments.md
- docs/feature_deep_dives/debugging_skill.md

## Code Files Read
- [list of code files reviewed]
