# MainToProd 20260224 Plan

## Background
Merge the main branch into the production branch, resolve any conflicts preferring main, run all checks, and create a PR to production.

## Requirements (from GH Issue #NNN)
1. Merge main into production (prefer main on conflicts)
2. Run lint, tsc, build
3. Run unit tests
4. Run integration tests
5. Run E2E tests
6. Fix any issues
7. Create PR to production

## Problem
The main branch has accumulated changes since the last production deployment. These need to be merged into production with all checks passing to ensure a safe release.

## Options Considered
- Direct merge of main into production with conflict resolution preferring main

## Phased Execution Plan
1. Merge main into production, resolve conflicts preferring main
2. Run lint, tsc, build
3. Run unit + integration tests
4. Run E2E tests
5. Fix any issues found
6. Create PR to production

## Testing
- Full lint, tsc, build checks
- All unit tests
- All integration tests
- Full E2E test suite

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/environments.md` - Update if environment config changed
- `docs/docs_overall/testing_overview.md` - Update if testing infrastructure changed
- `docs/feature_deep_dives/testing_setup.md` - Update if test setup changed
- `docs/docs_overall/instructions_for_updating.md` - Reference only
