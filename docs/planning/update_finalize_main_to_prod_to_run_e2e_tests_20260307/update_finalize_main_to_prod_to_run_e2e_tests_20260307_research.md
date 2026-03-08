# Update Finalize Main To Prod To Run E2E Tests Research

## Problem Statement
Update the /finalize and /mainToProd skills to include E2E test execution as part of their workflow. Currently these skills run lint, tsc, build, unit, and integration tests but skip E2E tests, which means E2E regressions can slip through to main and production. Adding E2E test runs will catch browser-level issues before code is merged.

## Requirements (from GH Issue #NNN)
1. Update /finalize skill to run E2E tests (critical tagged) after unit/integration tests pass
2. Update /mainToProd skill to run full E2E suite before creating the PR to production
3. Handle E2E test failures gracefully — report results clearly and stop the workflow
4. Ensure tmux dev servers are properly managed during E2E runs within these skills
5. Performance research: benchmark E2E test execution time and resource usage on a GMKtec M6 Ultra (Ryzen 7640HS, 32GB RAM) to ensure it doesn't bottleneck the workflow
6. Determine optimal number of Playwright shards for local execution on this hardware
7. Update relevant documentation (testing_overview.md, environments.md) if needed

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/testing_overview.md
- docs/docs_overall/environments.md
- docs/docs_overall/debugging.md

## Code Files Read
- [list of code files reviewed]
