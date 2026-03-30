# Small Evolution Fixes Plan

## Background
Fix environment naming inconsistencies and incorrect env variable references across the codebase. The GitHub environment is called "Staging" but code and docs reference it as "Development". Also ensure we reference TEST_USER_EMAIL env variable consistently, not an admin email env variable.

## Requirements (from GH Issue #882)
1. Eliminate any reference to "Development environment" in GitHub Actions/secrets context — should be "Staging"
2. Ensure TEST_USER_EMAIL is used consistently, not admin email env variable — look for both of these across codebase

## Problem
The GitHub environment for CI is named "staging" but several workflow files and docs still reference it as "Development". Additionally, `ADMIN_TEST_EMAIL`/`ADMIN_TEST_PASSWORD` env vars existed as separate variables despite always being aliased to the same `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` secrets. This creates confusion about whether a separate admin account is needed and adds unnecessary indirection in CI workflows.

## Options Considered
- [x] **Option A: Find-and-replace across codebase**: Simple global rename of `environment: Development` → `environment: staging` and `ADMIN_TEST_EMAIL/PASSWORD` → `TEST_USER_EMAIL/PASSWORD` in all code, workflows, and docs (including historical planning docs). Chosen for simplicity and completeness.

## Phased Execution Plan

### Phase 1: Fix `environment: Development` → `environment: staging`
- [x] Update `.github/workflows/ci.yml` — change `environment: Development` to `environment: staging`
- [x] Update `docs/docs_overall/environments.md` — rename "Development Environment Secrets" heading and table references
- [x] Update `docs/docs_overall/testing_overview.md` — same rename
- [x] Update all historical planning docs referencing `environment: Development` or "Development environment" in GH context

### Phase 2: Replace `ADMIN_TEST_EMAIL/PASSWORD` with `TEST_USER_EMAIL/PASSWORD`
- [x] Remove `ADMIN_TEST_EMAIL`/`ADMIN_TEST_PASSWORD` env lines from `.github/workflows/ci.yml` (3 jobs)
- [x] Remove `ADMIN_TEST_EMAIL`/`ADMIN_TEST_PASSWORD` env lines from `.github/workflows/e2e-nightly.yml`
- [x] Update `src/__tests__/e2e/fixtures/admin-auth.ts` — replace all ADMIN_TEST refs with TEST_USER
- [x] Update `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` — same
- [x] Rewrite `scripts/seed-admin-test-user.ts` — remove duplicate variable declaration and dead self-comparison
- [x] Remove `ADMIN_TEST_EMAIL`/`ADMIN_TEST_PASSWORD` from `.env.example`
- [x] Update all historical planning docs and feature deep dives referencing ADMIN_TEST vars

## Testing

### Unit Tests
- [x] No new unit tests needed — changes are config/docs/env-var renames only, no logic changes

### Integration Tests
- [x] No new integration tests needed — no service logic changed

### E2E Tests
- [x] No new E2E tests needed — existing admin E2E tests will validate the env var rename works at runtime

### Manual Verification
- [x] `grep -r ADMIN_TEST_EMAIL --include='*.ts' --include='*.yml'` returns no results
- [x] `grep -r 'environment: Development' --include='*.yml'` returns no results

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes in this project

### B) Automated Tests
- [x] `npm run lint` — verify no lint errors introduced
- [x] `npx tsc --noEmit` — verify no new type errors (pre-existing ones acceptable)
- [x] `npm run build` — verify build succeeds

## Documentation Updates
The following docs were identified as relevant and updated:
- [x] `docs/docs_overall/environments.md` — renamed Development environment references to Staging
- [x] `docs/docs_overall/testing_overview.md` — renamed Development environment references to Staging
- [x] `docs/feature_deep_dives/testing_setup.md` — no changes needed (no Development environment refs in GH context)
- [x] `docs/feature_deep_dives/admin_panel.md` — replaced ADMIN_TEST_EMAIL/PASSWORD refs

## Review & Discussion
Simple find-and-replace project. No architectural decisions needed. All changes are mechanical renames.
