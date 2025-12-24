# Plan: Ensure Request ID is Always Populated (Never Unknown)

## Goal
Ensure `requestId` is always populated with a real value - never falling back to `'unknown'`.

## Completed Fixes

The following API routes were missing `RequestIdContext` and have been fixed:

| Route | Fix Applied |
|-------|-------------|
| `/api/client-logs` | Added `RequestIdContext.run()` with UUID generation |
| `/api/test-cases` | Added `RequestIdContext.run()` with UUID generation |
| `/api/test-responses` | Added `RequestIdContext.run()` with UUID generation |

## Current Architecture

### How RequestId is Set
1. **Client-side**: `useClientPassRequestId` hook generates UUID and sets via `RequestIdContext.setClient()`
2. **Server-side**: API routes extract `__requestId` from request body or generate UUID

### Fallback Pattern (now only for edge cases)
- `getRequestId()` returns `'unknown'` if context not set

This fallback should now only trigger in truly exceptional circumstances (e.g., logging before context initialization).

## Test Plan

### 1. RequestIdContext Tests (`/src/lib/requestIdContext.test.ts`)

**Existing coverage (keep):**
- Lines 81-85: `getRequestId()` returns `'unknown'` when context not set

**Add tests to verify real values are always used:**
```typescript
describe('real value enforcement', () => {
  it('run() should reject empty string requestId')
  it('setClient() should reject empty string requestId')
})
```

### 2. Logger Tests (`/src/lib/server_utilities.test.ts`)

**Add tests verifying logs always have real requestId:**
```typescript
describe('requestId always populated', () => {
  it('should never log with requestId="unknown"')
  it('file output should always have valid UUID format requestId')
})
```

### 3. API Route Integration Tests

**Add tests for each API route:**
```typescript
describe('API routes always set RequestIdContext', () => {
  it('/api/client-logs should set context with valid requestId')
  it('/api/test-cases should set context with valid requestId')
  it('/api/test-responses should set context with valid requestId')
})
```

## Implementation Options

### Option A: Validation at Context Level (Recommended)
Add validation in `RequestIdContext.run()` and `setClient()` to reject empty/invalid values:
```typescript
static run<T>(context: RequestIdData, fn: () => T): T {
  if (!context.requestId || context.requestId === 'unknown') {
    throw new Error('requestId must be a valid non-empty string');
  }
  // ...
}
```

### Option B: Test-Only Enforcement
Keep current behavior but add tests that fail if fallbacks are ever used in production code paths.

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/requestIdContext.ts` | Add validation for empty/invalid requestId |
| `src/lib/requestIdContext.test.ts` | Add validation tests |
| `src/lib/server_utilities.test.ts` | Add tests verifying no "unknown" in logs |
