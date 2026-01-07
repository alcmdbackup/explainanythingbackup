# Fix Production E2E Tests Progress

## Phase 1: Research & Analysis
### Work Done
- Analyzed workflow run 20739965699 failure logs
- Downloaded and examined Playwright report artifacts
- Identified 72 failing test snapshots across 6 AI suggestion test files
- Traced root cause to missing `NEXT_PUBLIC_USE_AI_API_ROUTE` env var in production
- Confirmed seeding and RLS work correctly (not the issue)

### Issues Encountered
- Initial assumption was seeding failure, but analysis showed seeding works
- Real issue is Playwright can't mock server actions

### User Clarifications
- User prefers investigating fixes rather than blanket skips
- User wants to understand if tests can work without mocking

## Phase 2: Implementation
### Work Done
- Added `@skip-prod` tag to 4 entire test files:
  - `editor-integration.spec.ts`
  - `content-boundaries.spec.ts`
  - `state-management.spec.ts`
  - `save-blocking.spec.ts`
- Created 3 `@prod-ai` tests that use real production AI:
  1. `suggestions.spec.ts`: Panel visibility test
  2. `suggestions.spec.ts`: Submit prompt and get success
  3. `user-interactions.spec.ts`: Accept/reject buttons appear after AI response
- Added `@skip-prod` to all mock-dependent tests in `suggestions.spec.ts` and `user-interactions.spec.ts`
- Updated `e2e-nightly.yml` audit step to check all 6 @skip-prod files
- Created PR #161: https://github.com/Minddojo/explainanything/pull/161
- Triggered manual workflow run 20753027975 against production

### Issues Encountered
None during implementation - all local tests passed.

## Phase 3: Validation (Workflow Run 20753027975)
### Results
- **Audit @skip-prod tags**: ✅ PASSED (all 6 files correctly tagged)
- **Run E2E Tests**: ❌ FAILED (both chromium and firefox)

### New Obstacles Discovered

#### Obstacle 1: Production AI Pipeline Failures
The `@prod-ai` tests submitted prompts successfully but received error responses:
```
Error: Failed to generate suggestions
```
- Page loaded correctly
- Edit mode entered ✓
- AI prompt "Add more details" submitted ✓
- Production AI returned error instead of suggestions

**Impact**: Our `@prod-ai` tests depend on production AI working reliably. Non-deterministic AI failures will cause test flakiness.

**Potential Solutions**:
1. Make `@prod-ai` tests more lenient (accept graceful error as valid outcome)
2. Add retry logic with longer timeouts
3. Reduce to 1 smoke test that only checks panel visibility (no AI call)
4. Investigate why production AI is failing

#### Obstacle 2: "An Unexpected Error Occurred" on Results Page
Multiple non-AI tests failing with generic error on Results page:
- `publish bug test` tests (4 occurrences)
- `test disable save` tests (2 occurrences)
- `test query for save` tests (1 occurrence)

**Impact**: This is a separate production bug unrelated to AI suggestions. Tests that previously passed are now failing.

**Root Cause**: Unknown - needs investigation. Possibly:
- RLS policy issues with test data
- Production deployment regression
- Test data factory creating invalid data

**Affected Test Files**: Likely `save-flow.spec.ts` or `publish.spec.ts`

### Next Steps
1. Decide on `@prod-ai` test strategy (lenient vs strict)
2. Investigate "unexpected error" production bug separately
3. Consider if workflow should pass when only non-AI tests fail

---

## Phase 4: Systematic Debugging (In Progress)

### Obstacle 2: "An Unexpected Error Occurred" - Root Cause Found

**Investigation Method**: Used systematic debugging skill (Phase 1: Root Cause Investigation)

**Finding**: The fix documented in `docs/planning/bug_fixes/publish_broken_bug_20251226.md` was **NEVER IMPLEMENTED**!

The bug report identified that Supabase errors are plain objects (NOT `instanceof Error`), causing all error context to be lost:
```typescript
// Before: All Supabase errors fell through to generic error
if (!(error instanceof Error)) {
  return { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred' };
}
```

**Fix Applied**: Implemented `isSupabaseError()` type guard in `src/lib/errorHandling.ts`:
```typescript
function isSupabaseError(error: unknown): error is { code: string; message: string; details?: string; hint?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof (error as any).code === 'string' &&
    typeof (error as any).message === 'string'
  );
}

// Now Supabase errors are properly categorized:
if (isSupabaseError(error)) {
  return {
    code: ERROR_CODES.DATABASE_ERROR,
    message: error.message || 'Database operation failed',
    details: { supabaseCode: error.code, hint: error.hint, rawDetails: error.details }
  };
}
```

**Tests Added**:
- `should handle Supabase error objects as DATABASE_ERROR`
- `should handle Supabase RLS policy error`

**Files Modified**:
- `src/lib/errorHandling.ts` - Added `isSupabaseError()` detection
- `src/lib/errorHandling.test.ts` - Added 2 new test cases

---

### Obstacle 1: AI Pipeline Error Logging Enhanced

**Investigation Method**: Traced error flow through pipeline

**Error Path**:
1. `AIEditorPanel` → `runAISuggestionsPipelineAction`
2. → `getAndApplyAISuggestions`
3. → `runAISuggestionsPipeline`
4. → `generateAISuggestionsAction` → `callOpenAIModel`

**Issue**: Error messages were losing context. Generic "Failed to generate AI suggestions" was thrown even when detailed error information was available.

**Fix Applied**: Enhanced error messages in `src/editorFiles/aiSuggestion.ts` to include error code and details:
```typescript
// Before:
throw new Error(suggestionsResult.error?.message || 'Failed to generate AI suggestions');

// After:
const errorCode = suggestionsResult.error?.code || 'UNKNOWN';
const errorMessage = suggestionsResult.error?.message || 'Failed to generate AI suggestions';
const errorDetails = suggestionsResult.error?.details ? ` (${JSON.stringify(suggestionsResult.error.details)})` : '';
throw new Error(`[${errorCode}] ${errorMessage}${errorDetails}`);
```

**Result**: Users will now see errors like:
- `[LLM_API_ERROR] Error communicating with AI service`
- `[TIMEOUT_ERROR] Request timed out!`
- `[DATABASE_ERROR] JSON object requested, multiple (or no) rows returned`

---

### Verification Pending
- [ ] Deploy to production
- [ ] Run nightly workflow again
- [ ] Verify actual LLM error is now visible in test failure output
- [ ] Verify Supabase errors now show database context
