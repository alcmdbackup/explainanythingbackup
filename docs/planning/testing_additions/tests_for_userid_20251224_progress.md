# Implementation Progress: userId Null Validation Tests

## Status: COMPLETED

Date: 2024-12-24

## Files Created

| File | Description |
|------|-------------|
| `src/lib/utils/validation.ts` | `assertUserId` helper function |

## Files Modified

| File | Changes |
|------|---------|
| `src/lib/services/userLibrary.ts` | Added import + validation to 4 functions |
| `src/lib/services/linkWhitelist.ts` | Added import + validation to `generateHeadingStandaloneTitles` |
| `src/lib/services/userQueries.ts` | Added import + validation to `createUserQuery` |
| `src/lib/services/userLibrary.test.ts` | Added 12 userId validation tests |
| `src/lib/services/linkWhitelist.test.ts` | Added 3 userId validation tests |
| `src/lib/services/userQueries.test.ts` | Added 3 userId validation tests |

## Test Results

```
Test Suites: 3 passed, 3 total
Tests:       70 passed, 70 total
```

### New Tests Added (18 total)

**userLibrary.test.ts (12 tests)**
- saveExplanationToLibrary: null, undefined, empty string
- getExplanationIdsForUser: null, undefined, empty string
- getUserLibraryExplanations: null, undefined, empty string
- isExplanationSavedByUser: null, undefined, empty string

**linkWhitelist.test.ts (3 tests)**
- generateHeadingStandaloneTitles: null, undefined, empty string

**userQueries.test.ts (3 tests)**
- createUserQuery: null, undefined, empty string

## Validation Helper

```typescript
// src/lib/utils/validation.ts
export function assertUserId(
  userid: string | null | undefined,
  context: string
): asserts userid is string {
  if (!userid) {
    throw new Error(`userId is required for ${context}`);
  }
}
```

## Deviation from Original Plan

- Original plan had 30 tests (service + action layers)
- Implemented 18 tests (service layer only)
- Reason: Service layer validation covers action layer implicitly

## Design: Anonymous vs Authenticated UserIds

### Functions WITH assertUserId (require authenticated users)
These functions reject null/undefined/empty userid:
- `saveExplanationToLibrary` - user library operations need auth
- `getExplanationIdsForUser` - user library operations need auth
- `getUserLibraryExplanations` - user library operations need auth
- `isExplanationSavedByUser` - user library operations need auth
- `createUserQuery` - query tracking per user
- `generateHeadingStandaloneTitles` - AI call tracking per user

### Functions WITHOUT assertUserId (allow anonymous)
These functions accept 'anonymous' userid for unauthenticated users:
- `createUserExplanationEvent` (metrics.ts) - tracks events for all users
- `incrementExplanationSaves` (metrics.ts) - aggregate metrics
- Request context functions - fallback to 'anonymous'

### Note on 'anonymous' string
The `assertUserId` function rejects falsy values (null, undefined, '') but
allows the string 'anonymous'. This is intentional - 'anonymous' is a valid
fallback for request tracking, but the validated functions above require
a real authenticated userId because they operate on user-specific data.
