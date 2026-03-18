# Fix Prod Evolution V2 Error Progress

## Phase 1: Fix experiments.ts + experimentActionsV2.ts
### Work Done
- Removed `status: 'pending'` from `createExperiment()` INSERT — DB default `'draft'` takes over
- Changed `'pending'` → `'draft'` in 2 status checks in `addRunToExperiment()` (line 74 condition, line 79 Supabase filter)
- Updated JSDoc comments in both `experiments.ts` and `experimentActionsV2.ts` from `pending→running` to `draft→running`

### Issues Encountered
None — straightforward string replacement.

### User Clarifications
None needed.

## Phase 2: Fix tests
### Work Done
- Updated default mock experiment status from `'pending'` to `'draft'`
- Changed `createExperiment` test assertion to verify status is NOT included in insert
- Updated `addRunToExperiment` test name and mock to use `'draft'`

### Issues Encountered
None.

## Phase 3: Verify
### Work Done
- Lint: passed (0 errors)
- tsc: passed (0 errors)
- Unit tests: 9/9 passed
- Build: succeeded
- Grep: confirmed only remaining `'pending'` is for `evolution_runs` (correct)
