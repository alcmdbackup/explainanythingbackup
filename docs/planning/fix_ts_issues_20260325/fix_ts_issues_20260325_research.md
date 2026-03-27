# Fix TS Issues Research

## Problem Statement
Fix all TypeScript strict-mode errors across the codebase and verify that existing rules and enforcement mechanisms are working correctly. Currently there are 363 tsc errors across 75 files, all in test files (production code is clean).

## Requirements (from GH Issue #NNN)
- Fix 363 tsc errors across 75 files
  - 188 TS2532 (Object is possibly 'undefined')
  - 110 TS18048 (Variable is possibly 'undefined')
  - 34 TS2345 (Argument type mismatch)
  - 17 TS2322 (Type assignment mismatch)
  - 8 TS2339 (Property doesn't exist on type)
  - 4 TS2741 (Missing property)
  - 2 TS2769 (No overload matches)
- All 363 errors are in test files — production code has 0 errors
- Verify enforcement rules are working as intended

## High Level Summary

### Critical Finding: CI Enforcement Gap
**CI does NOT check test files for TypeScript errors.** The CI workflow uses `tsconfig.ci.json` which explicitly excludes `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`, and `**/__tests__/**`. Only production code is type-checked in CI. This means test file TS errors accumulate silently.

### Error Distribution
| Area | Errors | % |
|------|--------|---|
| lib/services (unit tests) | 103 | 28% |
| __tests__/integration | 56 | 15% |
| evolution/services | 52 | 14% |
| editorFiles | 49 | 14% |
| evolution/lib/pipeline | 28 | 8% |
| app/admin/evolution | 17 | 5% |
| components | 13 | 4% |
| __tests__/e2e | 8 | 2% |
| Other | 37 | 10% |

### Root Cause Categories

**1. Record<string, T> return types (86 errors — fixable at 2 locations)**
- `mockSimpleChain()` in linkCandidates.test.ts returns `Record<string, jest.Mock>` → 37 TS18048 errors. Fix: add explicit interface.
- `AI_PIPELINE_FIXTURES` typed as `Record<string, Record<string, PipelineFixture>>` → ~49 TS18048 errors across 3 editor test files. Fix: add explicit interface.

**2. Array/object index access without null guard (~200 errors)**
- Accessing `result[0]`, `data[0]`, `matches[0]` etc. without `!` assertion
- Accessing `.single()` result properties without null check
- Regex match group access: `match[1]` without assertion
- All fixable with `!` non-null assertion operator

**3. Missing required ErrorResponse.code field (4 errors)**
- 3 test files create mock error objects `{ message: '...' }` but `ErrorResponse` requires `code: ErrorCode`
- Fix: add `code: 'NOT_FOUND'` or `code: 'UNKNOWN_ERROR'`

**4. Type mismatches in mock data (~26 errors)**
- Mock return values not matching expected types
- HTMLElement | undefined passed where HTMLElement expected
- number | undefined passed where number expected
- All fixable with `!` assertions or type casts

### High-Leverage Fixes (3 changes fix ~86 errors)
1. **mockSimpleChain interface** (linkCandidates.test.ts:71-85) → fixes 37 errors
2. **AI_PIPELINE_FIXTURES interface** (editor-test-helpers.ts:459) → fixes ~49 errors
3. **ErrorResponse mock objects** (3 page test files) → fixes 4 errors

### Remaining ~277 errors
All are individual `!` non-null assertion additions at call sites. Pattern: `result[0]!.property` or `data!.field`.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md — testing rules, test tiers
- docs/feature_deep_dives/testing_setup.md — mock patterns, test helpers

### Config Files
- tsconfig.json — `strict: true`, `noUncheckedIndexedAccess: true`, includes all TS files
- tsconfig.ci.json — excludes all test files from CI type checking
- .github/workflows/ci.yml — uses `tsconfig.ci.json` for tsc step

## Code Files Read
- src/lib/services/linkCandidates.test.ts — mockSimpleChain() definition (37 errors)
- src/testing/utils/editor-test-helpers.ts — AI_PIPELINE_FIXTURES definition (~49 errors)
- src/lib/errorHandling.ts — ErrorResponse type, ErrorCode enum (4 errors)
- evolution/src/testing/service-test-mocks.ts — createSupabaseChainMock, createTableAwareMock
- src/testing/mocks/@supabase/supabase-js.ts — legacy mock (do NOT modify)
- src/__tests__/e2e/helpers/api-mocks.ts — 1 TS18048 error
- src/__tests__/e2e/setup/global-setup.ts — 1 TS2532 error
- src/__tests__/e2e/setup/vercel-bypass.ts — 4 errors (regex/array access)
- src/__tests__/e2e/specs/09-admin/admin-evolution-experiment-wizard-e2e.spec.ts — 1 TS2322
- src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts — 2 TS2532
- src/app/admin/evolution/prompts/[promptId]/page.test.tsx — TS2741 missing code
- src/app/admin/evolution/strategies/[strategyId]/page.test.tsx — TS2741 missing code
- src/config/llmPricing.test.ts — 8 TS2532 errors
- 75 files total reviewed via tsc output

## Key Findings

1. **Production code is clean** — 0 tsc errors in non-test files
2. **CI doesn't catch test TS errors** — tsconfig.ci.json excludes all test files
3. **82% of errors are null-safety issues** (TS2532 + TS18048 = 298/363)
4. **Two type definition fixes cascade to 86 errors** (mockSimpleChain + AI_PIPELINE_FIXTURES)
5. **noUncheckedIndexedAccess** is the main driver — array `[0]` access requires non-null assertion
6. **No actual bugs found** — all errors are strict-mode nits, not runtime issues
7. **evolution/src/testing/service-test-mocks.ts** is high-leverage but changing mock types is complex

## Open Questions
1. Should CI be updated to also check test files? (Adds ~363 errors to CI gate now, but prevents future accumulation)
2. Should we add a separate CI step for test file type checking, or modify tsconfig.ci.json?
3. Is `noUncheckedIndexedAccess` intentional for test files, or should tests have relaxed checking?
