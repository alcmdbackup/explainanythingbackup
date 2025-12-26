# Bug Investigation: Publish Broken After Streaming

**Date:** 2025-12-26
**Status:** In Progress - Phase 1 (Root Cause Investigation)

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

## Hypotheses

### Hypothesis 1: Non-Error Object Thrown
Something in the chain is throwing a non-Error object (string, object, or undefined). This is swallowed by the generic error handler.

### Hypothesis 2: Aborted Request
The `[Error: aborted]` in logs suggests the request might be getting cancelled. Possible causes:
- Client navigating away during streaming
- Timeout during embedding creation
- Race condition in streaming

### Hypothesis 3: Embedding/Pinecone Failure
The embedding step (`processContentToStoreEmbedding`) might be failing silently or throwing a non-Error.

## Files Involved

| File | Role |
|------|------|
| `src/app/results/page.tsx` | Client-side streaming handler |
| `src/app/api/returnExplanation/route.ts` | API route, SSE streaming |
| `src/lib/services/returnExplanation.ts` | Core generation logic |
| `src/lib/errorHandling.ts` | Error categorization |
| `src/actions/actions.ts` | `saveExplanationAndTopic()` |
| `src/lib/services/vectorsim.ts` | `processContentToStoreEmbedding()` |

## Next Steps

1. **Add detailed error logging** to catch the actual error before it's categorized
2. **Check for non-Error throws** in the generation/save chain
3. **Investigate `[Error: aborted]`** - is the streaming connection being closed prematurely?
4. **Test Pinecone/embedding** step in isolation
5. **Form hypothesis and test minimally**

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
