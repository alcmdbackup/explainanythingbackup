# Plan: Add Unit Tests Ensuring Request ID is Never Null When Logged

## Goal
Add comprehensive unit tests at both RequestIdContext and logger levels to ensure `requestId` is never `null` when logging.

## Current State
- `RequestIdContext.getRequestId()` returns `'unknown'` as fallback (line 41 of requestIdContext.ts)
- `RequestIdContext.getUserId()` returns `'anonymous'` as fallback (line 45)
- Logger's `addRequestId()` calls these methods and includes values in all logs
- Existing tests mock `getRequestId()` to return a fixed value, not testing null scenarios

## Files to Modify

### 1. `/src/lib/requestIdContext.test.ts`
Add tests verifying:
- `getRequestId()` never returns `null` or `undefined` (always returns string)
- `getRequestId()` returns `'unknown'` when storage returns `undefined`
- `getRequestId()` returns `'unknown'` when storage returns `null`
- `getUserId()` never returns `null` or `undefined`
- `getUserId()` returns `'anonymous'` when storage returns `undefined`/`null`

### 2. `/src/lib/server_utilities.test.ts`
Add test section verifying:
- All logger methods (info, error, warn, debug) always include non-null `requestId`
- When `RequestIdContext.getRequestId()` returns fallback value, logs still contain valid requestId
- `requestId` in file output is never `null`
- `requestId` in console output is never `null`

## Implementation Steps

1. Add new describe block in `requestIdContext.test.ts`:
   - "requestId null safety" tests for server-side
   - "requestId null safety" tests for client-side

2. Add new describe block in `server_utilities.test.ts`:
   - "requestId null safety in logs" with tests for each log level
   - Mock `RequestIdContext.getRequestId()` to return various edge cases

3. Run tests to verify they pass

## Test Cases Summary

### RequestIdContext Tests
```typescript
describe('null safety', () => {
  it('getRequestId should never return null')
  it('getRequestId should never return undefined')
  it('getRequestId should return "unknown" when context is empty')
  it('getUserId should never return null')
  it('getUserId should never return undefined')
  it('getUserId should return "anonymous" when context is empty')
})
```

### Logger Tests
```typescript
describe('requestId null safety in logs', () => {
  it('info logs should always have non-null requestId')
  it('error logs should always have non-null requestId')
  it('warn logs should always have non-null requestId')
  it('debug logs should always have non-null requestId when debug=true')
  it('file output should never contain null requestId')
})
```
