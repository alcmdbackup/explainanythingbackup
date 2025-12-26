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
| `src/app/api/client-logs/route.test.ts` | Add RequestIdContext.run() verification |
| `src/app/api/test-cases/route.test.ts` | Add RequestIdContext.run() verification |
| `src/app/api/test-responses/route.test.ts` | Add RequestIdContext.run() verification |

---

## Implementation Complete (2024-12-24)

### Changes Made

#### 1. RequestIdContext Validation (`src/lib/requestIdContext.ts`)
- Added `validateContextData()` function that throws errors for invalid requestId
- `run()` and `setClient()` now reject:
  - `null` / `undefined` data
  - Empty string requestId
  - Literal `'unknown'` requestId
- **Note:** userId is NOT validated - `'anonymous'` remains a valid fallback for unauthenticated users

#### 2. Test Coverage Added
- `src/lib/requestIdContext.test.ts`: 9 new validation tests for requestId
- `src/app/api/client-logs/route.test.ts`: RequestIdContext.run() verification
- `src/app/api/test-cases/route.test.ts`: RequestIdContext.run() verification
- `src/app/api/test-responses/route.test.ts`: RequestIdContext.run() verification

### Test Results
- 2064 tests passing
- 76/77 test suites passing (1 unrelated timeout in ImportModal)

---

## Gaps Identified (Review Notes)

### 1. Missing API Routes Coverage

The plan only mentions 3 routes but there are **6 routes** using RequestIdContext:

| Route | In Plan | Has Tests | Notes |
|-------|---------|-----------|-------|
| `/api/client-logs` | ✅ | ✅ | Needs RequestIdContext verification |
| `/api/test-cases` | ✅ | ✅ | Needs RequestIdContext verification |
| `/api/test-responses` | ✅ | ✅ | Needs RequestIdContext verification |
| `/api/stream-chat` | ❌ | ✅ | Already has RequestIdContext tests (good pattern) |
| `/api/returnExplanation` | ❌ | ❌ | No test file exists |
| `/api/fetchSourceMetadata` | ❌ | ❌ | No test file exists |

**Decision needed:** Include the 3 missing routes or document why excluded.

### 2. Incomplete Validation Cases

Current plan proposes rejecting empty string. Missing:
- Reject `null`/`undefined` explicitly
- Reject the literal `'unknown'` (mentioned in Option A code but not in test cases)
- Define "valid" - just non-empty, or require UUID format?

### 3. userId Not Addressed

`getUserId()` has same fallback pattern (`'anonymous'`). Should validation apply to both?

### 4. Existing Patterns to Reference

- `src/app/api/stream-chat/route.test.ts` already has proper RequestIdContext mocking - use as pattern
- `src/__tests__/integration/logging-infrastructure.integration.test.ts` tests request ID preservation

### 5. Test Strategy Unclear

How to verify "never log with unknown":
- Runtime validation (throw if unknown)?
- Test assertion pattern only?
- Logger warning when fallback used?
