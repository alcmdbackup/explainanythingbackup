# Plan: Add Unit Tests Ensuring Request ID is Never Null When Logged

## Goal
Add comprehensive unit tests at both RequestIdContext and logger levels to ensure `requestId` is never `null` when logging.

## Current State
- `RequestIdContext.getRequestId()` returns `'unknown'` as fallback (line 41 of requestIdContext.ts)
- `RequestIdContext.getUserId()` returns `'anonymous'` as fallback (line 45)
- Logger's `addRequestId()` calls these methods and includes values in all logs
- **Note:** `requestIdContext.test.ts` uses `setClient()` to set context; `server_utilities.test.ts` mocks `getRequestId()`

### Existing Test Coverage (avoid duplicating)
- `requestIdContext.test.ts` lines 81-85: Tests `getRequestId()` returns `'unknown'` when context not set
- `requestIdContext.test.ts` lines 89-93: Tests `getUserId()` returns `'anonymous'` when context not set
- `requestIdContext.test.ts` lines 233-243: Tests default values on fresh module load

### Console vs File Output Structure
- **Console**: `{ requestId, userId, ...data }` (flat structure)
- **File**: `{ ..., requestId: { requestId, userId } }` (nested under `requestId` property)

## Files to Modify

### 1. `/src/lib/requestIdContext.test.ts`
Add tests verifying (only what's NOT already covered):
- `getRequestId()` returns `'unknown'` when context has empty string `''`
- `getUserId()` returns `'anonymous'` when context has empty string `''`
- Type assertion that return value is always `string` (never null/undefined)

### 2. `/src/lib/server_utilities.test.ts`
Add test section verifying:
- All logger methods (info, error, warn, debug) include non-null `requestId` when using fallback values
- Console output structure: `{ requestId, userId, ...data }`
- File output structure: `{ ..., requestId: { requestId, userId } }`
- `requestId` in file output is never `null`

## Implementation Steps

1. Add new describe block in `requestIdContext.test.ts`:
   - "empty string fallback" tests (empty string → fallback value)

2. Add new describe block in `server_utilities.test.ts`:
   - "requestId null safety in logs" with tests for fallback scenarios
   - Mock `RequestIdContext.getRequestId()` to return `'unknown'` (the fallback)

3. Run tests to verify they pass

## Test Cases Summary

### RequestIdContext Tests (NEW - not duplicating existing)
```typescript
describe('empty string fallback', () => {
  it('getRequestId should return "unknown" when requestId is empty string')
  it('getUserId should return "anonymous" when userId is empty string')
})
```

### Logger Tests
```typescript
describe('requestId null safety in logs', () => {
  describe('with fallback values', () => {
    // Mock getRequestId to return 'unknown', getUserId to return 'anonymous'
    it('info logs should include fallback requestId in console output')
    it('error logs should include fallback requestId in console output')
    it('warn logs should include fallback requestId in console output')
    it('debug logs should include fallback requestId when debug=true')
  })

  describe('file output structure', () => {
    it('file output should have requestId nested under requestId property')
    it('file output requestId should never be null')
    it('file output userId should never be null')
  })
})
```
