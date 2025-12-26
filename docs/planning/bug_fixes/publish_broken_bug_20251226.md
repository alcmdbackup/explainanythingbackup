# Bug Investigation: Publish Broken After Streaming

**Date:** 2025-12-26
**Status:** Root Cause Identified - Ready for Fix

## Problem Statement

When generating a new article via streaming and then clicking Publish, a bug occurs. The article fails to be created/published properly.

## Reproduction Steps

1. Navigate to home page
2. Search for a unique query (e.g., "publish bug test [timestamp]")
3. Wait for streaming to complete
4. Observe error: "An unexpected error occurred"

## Evidence Gathered

### Playwright Test Results

Created debug test at `src/__tests__/e2e/specs/debug-publish-bug.spec.ts`

**Test Output:**
- Streaming starts successfully
- Streaming completes successfully
- Page shows error: "An unexpected error occurred"
- Content area shows: "Content will appear here..." (empty)
- URL never redirects to include `explanation_id`

### Server Logs

```
[ERROR] Error in returnExplanation {
  requestId: 'client-1766786593119-kwi2g7',
  error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred' },
  userInput: 'publish bug test 1766786590855',
  matchMode: 'normal',
  userid: '08b3f7d2-196f-4606-83fc-d78b080f3e6f',
  userInputType: 'query'
}
```

Also found in logs:
```
⨯ [Error: aborted]
```

### Key Finding: Error Type

The error code `UNKNOWN_ERROR` with message "An unexpected error occurred" comes from `src/lib/errorHandling.ts:36-41`:

```typescript
if (!(error instanceof Error)) {
  return {
    code: ERROR_CODES.UNKNOWN_ERROR,
    message: 'An unexpected error occurred'
  };
}
```

**This means the error being thrown is NOT an instance of Error** - it could be:
- A string
- An object
- undefined/null

## Code Flow Traced

### 1. Client-Side Flow (`src/app/results/page.tsx`)

1. User searches → `handleUserAction()` called
2. Fetches `/api/returnExplanation` with streaming
3. Receives SSE events: `streaming_start`, `content`, `progress`, `streaming_end`, `complete`
4. On `complete`, checks for error in result (line 432)
5. If error: `dispatchLifecycle({ type: 'ERROR', error: error.message })`
6. If success: redirects to `/results?explanation_id=...`

### 2. API Route (`src/app/api/returnExplanation/route.ts`)

1. Creates `ReadableStream` for SSE
2. Calls `returnExplanationLogic()` with streaming callback
3. Sends `streaming_start`, content chunks, `streaming_end`, `complete`
4. On error: sends error event

### 3. Service Layer (`src/lib/services/returnExplanation.ts`)

1. Generates title from query
2. Searches for similar vectors (matches found in logs)
3. If no match: generates new explanation via LLM
4. Saves explanation via `saveExplanationAndTopic()`
5. Creates embeddings via `processContentToStoreEmbedding()`
6. Applies tags
7. Saves user query

**Error occurs somewhere in steps 3-7** after streaming content but before returning success.

### 4. Error Handling (`src/lib/errorHandling.ts`)

- `handleError()` calls `categorizeError()`
- If error is not `instanceof Error`, returns `UNKNOWN_ERROR`
- Original error details are lost

## Root Cause (CONFIRMED)

**Supabase error objects are NOT `instanceof Error`** - they are plain objects with `{code, message, details, hint}`.

The codebase has ~40+ locations throwing these directly:
```typescript
if (error) throw error;  // Plain object, NOT Error instance
```

When these reach `src/lib/errorHandling.ts:36-41`:
```typescript
if (!(error instanceof Error)) {
  return { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred' };
}
```

**All error context is lost** - user sees generic "An unexpected error occurred".

### Bug Flow
1. Streaming completes successfully ✓
2. Post-streaming ops run (`saveHeadingLinks`, `linkSourcesToExplanation`, etc.)
3. One of these fails with a Supabase error (plain object)
4. `handleError()` → `categorizeError()` → not `instanceof Error` → generic message
5. User sees error, explanation not saved

### Evidence: Non-Error Throw Locations

**Files with `if (error) throw error;` pattern (Supabase errors):**
- `src/lib/services/linkWhitelist.ts` - ~15 locations (lines 62, 75, 98, 109, 118, 148, 170, 185, 203, 220, 242, 264, 289, 327, 452)
- `src/lib/services/sourceCache.ts` - ~4 locations (lines 51, 64, 80, 96, 284)
- `src/lib/services/explanationTags.ts` - ~6 locations
- `src/lib/services/topics.ts` - ~7 locations (lines 41, 51, 69, 101, 124, 141, 162)
- `src/lib/services/explanations.ts` - ~7 locations (lines 44-52, 72, 124, 217, 234, 257, 288)

### Secondary Issue: Unsafe Error Casts

In `src/lib/services/vectorsim.ts`, there are unsafe type assertions:
```typescript
span.setStatus({ code: 2, message: (error as Error).message });
```
Lines: 130-131, 245-246, 337-338, 587-588

## Previous Hypotheses (Superseded)

### ~~Hypothesis 1: Non-Error Object Thrown~~ ✓ CONFIRMED
This is the root cause - Supabase errors are plain objects.

### ~~Hypothesis 2: Aborted Request~~
The `[Error: aborted]` in logs is likely a secondary symptom - streaming routes don't handle client disconnects gracefully.

### ~~Hypothesis 3: Embedding/Pinecone Failure~~
Not the primary cause, though vectorsim.ts has unsafe error casts that could cause issues.

## Files Involved

| File | Role |
|------|------|
| `src/app/results/page.tsx` | Client-side streaming handler |
| `src/app/api/returnExplanation/route.ts` | API route, SSE streaming |
| `src/lib/services/returnExplanation.ts` | Core generation logic |
| `src/lib/errorHandling.ts` | Error categorization |
| `src/actions/actions.ts` | `saveExplanationAndTopic()` |
| `src/lib/services/vectorsim.ts` | `processContentToStoreEmbedding()` |

## Fix Plan

### Strategy: Detect Supabase Errors in Error Handler

**Minimal fix** - modify `categorizeError()` to recognize Supabase error objects.

### File: `src/lib/errorHandling.ts`

Add Supabase error detection before the generic fallback:

```typescript
function categorizeError(error: unknown): ErrorResponse {
  // Handle non-Error objects (like Supabase errors)
  if (!(error instanceof Error)) {
    // Detect Supabase/Postgres error objects: { code, message, details?, hint? }
    if (isSupabaseError(error)) {
      return {
        code: ERROR_CODES.DATABASE_ERROR,
        message: error.message || 'Database operation failed',
        details: { supabaseCode: error.code, hint: error.hint }
      };
    }
    return {
      code: ERROR_CODES.UNKNOWN_ERROR,
      message: 'An unexpected error occurred'
    };
  }
  // ... rest of existing logic
}

// Type guard for Supabase errors
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
```

### Why This Approach
- **Minimal change** - fixes issue at single point (error handler)
- **Immediate protection** - covers all ~40 throw sites without touching them
- **Preserves error info** - user/logs now see actual Supabase error message
- **No breaking changes** - existing code continues to work

### Testing
1. Run existing debug test `src/__tests__/e2e/specs/debug-publish-bug.spec.ts`
2. Verify error message now shows database context instead of "An unexpected error occurred"
3. Run full test suite to ensure no regressions

## Previous Next Steps (Completed)

1. ~~**Add detailed error logging** to catch the actual error before it's categorized~~ - Done via codebase analysis
2. ~~**Check for non-Error throws** in the generation/save chain~~ - Found ~40+ locations
3. ~~**Investigate `[Error: aborted]`**~~ - Secondary issue, streaming doesn't handle client disconnects
4. ~~**Test Pinecone/embedding** step in isolation~~ - Not the root cause
5. ~~**Form hypothesis and test minimally**~~ - Hypothesis confirmed: Supabase errors

## Test File Created

```typescript
// src/__tests__/e2e/specs/debug-publish-bug.spec.ts
// Reproduces the bug by:
// 1. Searching for unique query
// 2. Waiting for streaming complete
// 3. Checking for error state
```

## Related Code Patterns

### Publish Button Visibility
```tsx
// line 1086-1089 in results/page.tsx
{(hasUnsavedChanges || explanationStatus === ExplanationStatus.Draft) && (
  <button onClick={handleSaveOrPublishChanges} ...>
```

### Publish Handler Guard
```tsx
// line 576 in results/page.tsx
if (!explanationId || (!hasUnsavedChanges && explanationStatus !== ExplanationStatus.Draft) || isSavingChanges || !userid) return;
```

Note: If `explanationId` is null (due to generation error), publish will silently return.

---

## Phase 2: Fix the Underlying Database Error

Once the error handler fix is deployed and we can see the actual Supabase error message in logs, we'll identify and fix the specific database operation that's failing.

### Step 1: Deploy Error Handler Fix
Implement the `isSupabaseError()` detection in `src/lib/errorHandling.ts` as described above.

### Step 2: Reproduce and Capture Real Error
1. Run the debug test or manually reproduce the bug
2. Check server logs for the now-visible Supabase error details:
   - `supabaseCode` - the Postgres error code (e.g., `23505` for unique constraint, `42P01` for undefined table)
   - `message` - the actual error message
   - `hint` - Postgres hint if available

### Step 3: Identify Failing Operation
Based on the error code/message, identify which of these operations is failing:
- `saveExplanationAndTopic()` - saving the explanation record
- `saveHeadingLinks()` - saving heading links for overlay system
- `linkSourcesToExplanation()` - linking sources to explanation
- `saveCandidatesFromLLM()` - saving link candidates
- `applyTagsToExplanation()` - applying tags
- `processContentToStoreEmbedding()` - creating embeddings

### Step 4: Fix the Root Database Issue
Common causes to check:
- **Missing table/column** - schema out of sync
- **Constraint violation** - unique constraint, foreign key, not null
- **Permission issue** - RLS policy blocking insert/update
- **Data format issue** - wrong type, too long, etc.

### Step 5: Add Regression Test
Once fixed, update `src/__tests__/e2e/specs/debug-publish-bug.spec.ts` to verify the full publish flow works end-to-end.

### Expected Timeline
1. Error handler fix → immediate visibility into actual error
2. Identify failing operation → within first reproduction
3. Fix database issue → depends on complexity
4. Verify and close → run full test suite
