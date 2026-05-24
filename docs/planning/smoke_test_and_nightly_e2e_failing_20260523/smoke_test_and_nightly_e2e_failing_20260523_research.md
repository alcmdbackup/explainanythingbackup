# smoke_test_and_nightly_e2e_failing_20260523 Research

## Problem Statement
I want to investigate why post-deploy smoke test and nightly E2E keep failing. Look at GH to figure out why.

## Requirements (from GH Issue #NNN)
I want to investigate why post-deploy smoke test and nightly E2E keep failing. Look at GH to figure out why.

## High Level Summary
[Populate after investigation. Pull recent runs of `e2e-nightly.yml` and `post-deploy-smoke.yml` via `gh run list` — classify failures, identify recurring vs flake, look for shared root cause (env var, secret, deploy-state, mock-dependency tag drift, hostname split fallout from the 20260522 evolution-split project, etc.).]

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md

## Code Files Read
- [Populate during investigation]
