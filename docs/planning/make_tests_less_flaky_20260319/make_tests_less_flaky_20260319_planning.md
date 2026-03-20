# Make Tests Less Flaky Plan

## Background
Reduce test flakiness across the codebase by identifying and fixing unreliable tests, improving test infrastructure, and adding better wait strategies and isolation patterns. This includes addressing race conditions, improving test data management, and ensuring deterministic test execution in both local and CI environments.

## Requirements (from GH Issue #NNN)
1. Audit all E2E tests for flakiness patterns (fixed sleeps, networkidle, missing waits)
2. Audit unit/integration tests for race conditions and shared state
3. Fix identified flaky tests with proper wait strategies
4. Improve test isolation (route cleanup, temp files, test data)
5. Add/update ESLint rules for flakiness prevention
6. Update testing documentation with findings

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
- `docs/docs_overall/testing_overview.md` - May need new rules or updated enforcement summary
- `docs/feature_deep_dives/testing_setup.md` - May need updated patterns, known issues, or utilities
- `docs/feature_deep_dives/testing_pipeline.md` - May need updated best practices
