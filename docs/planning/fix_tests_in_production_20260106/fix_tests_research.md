# Fix Production E2E Tests Research

## Problem Statement
Production E2E tests (nightly workflow) are failing with ~72 test failures in Chromium. The tests run against `https://explainanything.vercel.app` but fail because mocking doesn't work in production.

## High Level Summary

### Root Cause Analysis

**Primary Issue:** AI suggestion tests use `mockAISuggestionsPipelineAPI()` which intercepts HTTP requests to `/api/runAISuggestionsPipeline`. However, in production:

1. **Missing env var**: `NEXT_PUBLIC_USE_AI_API_ROUTE=true` is set in `ci.yml` but NOT in the production Vercel build
2. **Server actions used instead**: Without this env var, the app uses Next.js server actions (not the API route)
3. **Can't mock server actions**: Playwright can only intercept HTTP requests, not RSC server actions

### Failed Test Breakdown

| Test Suite | Count | Error |
|------------|-------|-------|
| State Management Test | 18 | "Failed to generate suggestions" |
| Editor Integration Test | 15 | "Failed to generate suggestions" |
| Content Boundaries Test | 15 | "Failed to generate suggestions" |
| Save Blocking Test | 12 | "Failed to generate suggestions" |
| User Interactions Test | 6 | "Failed to generate suggestions" |
| AI Suggestions Pipeline Test | 3 | "Failed to generate suggestions" |
| Other | 3 | "An unexpected error occurred" |

**Total: ~72 test snapshots showing failures**

### Key Findings

1. **Seeding works**: `test-data-factory.ts` and `global-setup.ts` successfully create test explanations in production using service role
2. **RLS is not the issue**: Service role bypasses RLS; `explanations` table has no RLS; `topics` has RLS but service role bypasses it
3. **AI pipeline fails**: Real AI calls either:
   - Return validation errors: "Content too short: 42% of original (min 50%)"
   - Fail entirely: "Failed to generate suggestions"

### Environment Variable Analysis

```yaml
# ci.yml (local CI) - WORKS
NEXT_PUBLIC_USE_AI_API_ROUTE: 'true'

# e2e-nightly.yml (production) - MISSING
# This env var is NOT set, so production uses server actions
```

## Documents Read
- `/docs/docs_overall/project_workflow.md`
- `.github/workflows/ci.yml`
- `.github/workflows/e2e-nightly.yml`

## Code Files Read
- `src/__tests__/e2e/specs/06-ai-suggestions/*.spec.ts` - All AI suggestion test files
- `src/__tests__/e2e/helpers/api-mocks.ts` - Mock functions including `mockAISuggestionsPipelineAPI`
- `src/__tests__/e2e/helpers/test-data-factory.ts` - Test data creation (works in prod)
- `src/__tests__/e2e/setup/global-setup.ts` - Production seeding (works)
- `src/components/AIEditorPanel.tsx` - Uses `NEXT_PUBLIC_USE_AI_API_ROUTE` to decide API vs server action
- `src/lib/utils/supabase/server.ts` - Server client patterns
- `supabase/migrations/20251109053825_fix_drift.sql` - RLS configuration

## Options Considered

### Option 1: Add `@skip-prod` to AI suggestion tests
- **Pros**: Quick fix, no production changes needed
- **Cons**: Reduces test coverage in production

### Option 2: Set `NEXT_PUBLIC_USE_AI_API_ROUTE=true` in Vercel
- **Pros**: Enables mocking to work in production
- **Cons**: Requires Vercel config change, may have security implications

### Option 3: Rewrite tests for real AI (no mocking)
- **Pros**: Tests real production behavior
- **Cons**: Non-deterministic, slower, may hit rate limits

### Option 4: Hybrid approach
- Keep critical UI flow tests with lenient assertions for prod
- Skip tests that require specific mocked responses
- **Recommended approach**
