# Fix TS Issues Plan

## Background
Fix all 363 TypeScript strict-mode errors across test files and remove the CI exemption so test files are type-checked going forward.

## Requirements
- Fix all 363 tsc errors across 75 test files
- Remove test file exclusions from tsconfig.ci.json so CI catches future errors
- Zero tsc errors across entire codebase

## Problem
The CI config (tsconfig.ci.json) excludes test files from type checking, allowing 363 strict-mode errors to accumulate silently. All errors are in test files — production code is clean. 82% are null-safety issues from `noUncheckedIndexedAccess`.

## Phased Execution Plan

### Phase 1: High-leverage type fixes (86 errors)
1. Add `MockChain` interface to `mockSimpleChain()` in linkCandidates.test.ts → fixes 37 errors
2. Add `AIFixtures` interface to `AI_PIPELINE_FIXTURES` in editor-test-helpers.ts → fixes ~49 errors

### Phase 2: ErrorResponse mock fixes (4 errors)
- Add missing `code` field to 3 page test files

### Phase 3: Bulk `!` assertion fixes (~277 errors)
- Fix by directory: lib/services → integration → evolution/services → editorFiles → components → e2e → rest

### Phase 4: CI enforcement
- Remove test file exclusions from tsconfig.ci.json
- Verify `npx tsc --noEmit` passes with 0 errors

## Testing
- `npx tsc --noEmit` must pass with 0 errors
- `npm test` must pass (unit tests still work after assertion additions)
- Build must pass
