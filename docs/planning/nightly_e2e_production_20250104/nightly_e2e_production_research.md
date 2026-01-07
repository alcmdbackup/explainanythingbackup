# Nightly E2E Production Research

## Problem Statement

The current nightly E2E tests run against a locally-built dev environment with mocked AI responses (`E2E_TEST_MODE=true`). This doesn't validate the actual production deployment or real AI integration.

## High Level Summary

### Current Architecture

**Nightly Workflow (`e2e-nightly.yml`):**
- Runs daily at 6 AM UTC
- Builds app locally: `npm run build && E2E_TEST_MODE=true npm start`
- Uses `environment: staging` with dev Supabase secrets
- Tests Chromium + Firefox matrix
- `E2E_TEST_MODE` returns mock SSE streams instead of real AI

**Post-Deploy Smoke (`post-deploy-smoke.yml`):**
- Runs against live production URL via `github.event.deployment_status.target_url`
- Uses `environment: Production` with prod secrets
- Has Vercel bypass mechanism for deployment protection
- Only runs `@smoke` tagged tests

### Key Findings

1. **E2E_TEST_MODE Guard**: Code in `route.ts` blocks `E2E_TEST_MODE` in production (unless `CI=true`). For real AI testing, we should simply not set this variable.

2. **Data Cleanup**: `global-teardown.ts` already cleans up by `TEST_USER_ID`:
   - userLibrary, userQueries, userExplanationEvents, llmCallTracking
   - explanationMetrics, explanation_tags, link_candidates
   - explanations (with cascade)
   - Pattern-matches `test-*` prefixed topics/tags

3. **Vercel Bypass**: Fully implemented in `vercel-bypass.ts` - obtains cryptographic cookie for protected deployments.

4. **Test Data Factory**: Creates isolated test data with unique `test-{timestamp}-{random}` prefixes.

## Documents Read

- `docs/docs_overall/testing_overview.md`
- `docs/docs_overall/environments.md`
- `docs/docs_overall/project_workflow.md`

## Code Files Read

- `.github/workflows/e2e-nightly.yml` - Current nightly workflow
- `.github/workflows/post-deploy-smoke.yml` - Reference for prod targeting
- `playwright.config.ts` - Test configuration with timeout settings
- `src/__tests__/e2e/setup/global-setup.ts` - Seeds shared fixtures
- `src/__tests__/e2e/setup/global-teardown.ts` - Cleans up by TEST_USER_ID
- `src/__tests__/e2e/setup/vercel-bypass.ts` - Handles deployment protection
- `src/__tests__/e2e/fixtures/auth.ts` - Per-worker API authentication
- `src/__tests__/e2e/helpers/test-data-factory.ts` - Test data creation
- `src/app/api/returnExplanation/route.ts` - E2E_TEST_MODE guard
- `src/app/api/returnExplanation/test-mode.ts` - Mock SSE scenarios

## Key Decisions Made

| Question | Decision | Rationale |
|----------|----------|-----------|
| Replace or run alongside? | Replace | Avoid duplicate costs/complexity |
| Data handling | Dedicated prod test user | Full cleanup capability |
| AI responses | Real AI | Validate actual production behavior |
| Test scope | Full suite | Comprehensive validation |
