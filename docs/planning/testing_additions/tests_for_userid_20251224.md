# Plan: Add Unit Tests for userId Null Validation

## Goal
Add unit tests ensuring userId is never null when passed to functions, with validation that throws errors.

## Scope

### Service Functions (6 total) - Validation Layer

| File | Function | Line | Current Behavior |
|------|----------|------|------------------|
| `userLibrary.ts` | `saveExplanationToLibrary(explanationid, userid)` | 21-47 | No null check |
| `userLibrary.ts` | `getExplanationIdsForUser(userid, getCreateDate)` | 62-89 | No null check |
| `userLibrary.ts` | `getUserLibraryExplanations(userid)` | 102-121 | No null check |
| `userLibrary.ts` | `isExplanationSavedByUser(explanationid, userid)` | 132-151 | No null check |
| `linkWhitelist.ts` | `generateHeadingStandaloneTitles(content, articleTitle, userid, debug?)` | ~481 | No null check |
| `userQueries.ts` | `createUserQuery(UserQueryInsertType)` | ~56 | No null check on userid field |

### Server Actions - NO validation needed
Since services validate, actions inherit validation via service calls. Removed from scope.

## Implementation

### Step 1: Add validation helper
Create `src/lib/utils/validation.ts`:
```typescript
export function assertUserId(userid: string | null | undefined, context: string): asserts userid is string {
  if (!userid) {
    throw new Error(`userId is required for ${context}`);
  }
}
```

### Step 2: Add validation to service functions

**File:** `src/lib/services/userLibrary.ts`
- Add `assertUserId(userid, 'functionName')` at start of all 4 functions

**File:** `src/lib/services/linkWhitelist.ts`
- Add `assertUserId(userid, 'generateHeadingStandaloneTitles')`

**File:** `src/lib/services/userQueries.ts`
- Add validation for `query.userid` inside `createUserQuery`

### Step 3: Extend existing test files

**File:** `src/lib/services/userLibrary.test.ts` (EXTEND - file already exists)
- Add 12 tests (4 functions x 3 null cases)

**File:** `src/lib/services/linkWhitelist.test.ts` (CREATE or EXTEND)
- Add 3 tests for `generateHeadingStandaloneTitles`

**File:** `src/lib/services/userQueries.test.ts` (EXTEND - file already exists)
- Add 3 tests for `createUserQuery` userid validation

## Test Cases Per Function

Each function needs 3 null-check tests:
```typescript
it('should throw error when userid is null', async () => {
  await expect(fn(null as any)).rejects.toThrow('userId is required');
});

it('should throw error when userid is undefined', async () => {
  await expect(fn(undefined as any)).rejects.toThrow('userId is required');
});

it('should throw error when userid is empty string', async () => {
  await expect(fn('')).rejects.toThrow('userId is required');
});
```

## Files to Modify

| File | Action |
|------|--------|
| `src/lib/utils/validation.ts` | CREATE |
| `src/lib/services/userLibrary.ts` | ADD validation |
| `src/lib/services/linkWhitelist.ts` | ADD validation |
| `src/lib/services/userQueries.ts` | ADD validation |
| `src/lib/services/userLibrary.test.ts` | EXTEND (exists) |
| `src/lib/services/linkWhitelist.test.ts` | CREATE/EXTEND |
| `src/lib/services/userQueries.test.ts` | EXTEND (exists) |

## Test Count

- 4 userLibrary functions x 3 tests = 12 tests
- 1 linkWhitelist function x 3 tests = 3 tests
- 1 userQueries function x 3 tests = 3 tests
- **Total: 18 service tests**
