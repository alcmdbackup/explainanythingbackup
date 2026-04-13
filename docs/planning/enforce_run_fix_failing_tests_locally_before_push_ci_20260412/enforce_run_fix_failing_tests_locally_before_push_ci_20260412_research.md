# Enforce Run Fix Failing Tests Locally Before Push CI Research

## Problem Statement
We want to save on wasteful CI usage during /finalize and /mainToProd. Currently, CI failures result in repeated pushes without local verification, wasting GitHub Actions minutes. We need to add evolution E2E tests to the local /finalize run, enforce local test verification after any CI failure before resubmitting, always fix flaky test root causes rather than applying surface-level fixes, and surface previously broken tests to the user for guidance.

## Requirements (from GH Issue #NNN)
- We want to save on wasteful CI usage during /finalize and /mainToProd
- Add evolution E2E tests to local run for /finalize
- In both /finalize and /mainToProd, for any CI failures
    - Fix the issue
    - Run the failing tests locally to verify they pass
    - Run all tests locally and verify they pass
    - Only then can submit to CI again
- For flaky tests, always fix the root cause, never do surface-level fixes
- For previously broken tests, always surface them to the user to ask what to do

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/environments.md
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/debugging_skill.md

## Code Files Read
- [list of code files reviewed]
