# Make Tests Less Flaky Research

## Problem Statement
Reduce test flakiness across the codebase by identifying and fixing unreliable tests, improving test infrastructure, and adding better wait strategies and isolation patterns. This includes addressing race conditions, improving test data management, and ensuring deterministic test execution in both local and CI environments.

## Requirements (from GH Issue #NNN)
1. Audit all E2E tests for flakiness patterns (fixed sleeps, networkidle, missing waits)
2. Audit unit/integration tests for race conditions and shared state
3. Fix identified flaky tests with proper wait strategies
4. Improve test isolation (route cleanup, temp files, test data)
5. Add/update ESLint rules for flakiness prevention
6. Update testing documentation with findings

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
- docs/feature_deep_dives/testing_pipeline.md

## Code Files Read
- [list of code files reviewed]
