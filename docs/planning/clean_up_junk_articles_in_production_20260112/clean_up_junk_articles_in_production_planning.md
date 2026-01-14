# Clean Up Junk Articles in Production Plan

## Background

The previous cleanup effort (2026-01-10) implemented the `[TEST]` prefix filtering system and cleaned 1017 articles from production. However, new junk articles are still being created because some test files don't follow the prefix convention. Articles like "Understanding React Hooks in Modern Web Development" and "Software Bug 1767854660739" have appeared in production, likely from E2E import tests and integration tests that create content without proper prefixes.

## Problem

Three sources are creating junk articles that bypass the existing `[TEST]` and `test-` prefix filters:

1. **E2E Import Tests** (`import-articles.spec.ts`): Send real content to LLM which generates unprefixed titles like "Understanding React Hooks in Modern Web Development"

2. **Integration Tests** (`tag-management.integration.test.ts`): Use `Test Topic` and `Test Explanation` (capital T with space) which don't match the filter patterns `[TEST]%` or `test-%`

3. **Existing Production Content**: Articles matching patterns like "React", "Software Bug", or other test-generated content from before the filtering system was implemented

## Options Considered

### Option A: Fix Test Files to Use Correct Prefix
- Update `tag-management.integration.test.ts` to use `[TEST]` or `test-` prefix
- Mock LLM responses in E2E import tests to return `[TEST]`-prefixed titles
- **Pros**: Addresses root cause, no filter changes needed
- **Cons**: Requires careful test updates, E2E mocking is complex

### Option B: Expand Filter Patterns
- Add `Test %` (capital T space) to filter patterns
- **Pros**: Quick fix
- **Cons**: Could accidentally filter legitimate content like "Testing Strategies"

### Option C: Combined Approach (Recommended)
- Fix test files to use correct conventions
- Add specific pattern cleanup for known junk (React Hooks, Software Bug)
- Run one-time migration on production
- **Pros**: Comprehensive, addresses root cause + existing data

## Phased Execution Plan

### Phase 1: Fix Integration Tests

**File**: `src/__tests__/integration/tag-management.integration.test.ts`

Change lines 48 and 58:

```typescript
// BEFORE (line 48)
topic_title: `Test Topic ${testId}-${Date.now()}`,

// AFTER
topic_title: `[TEST] Topic ${testId}-${Date.now()}`,
```

```typescript
// BEFORE (line 58)
explanation_title: `Test Explanation ${testId}-${Date.now()}`,

// AFTER
explanation_title: `[TEST] Explanation ${testId}-${Date.now()}`,
```

Also update tag creation (line 70):
```typescript
// BEFORE
tag_name: `${tagName}-${testId}-${Date.now()}`,

// AFTER
tag_name: `[TEST] ${tagName}-${testId}-${Date.now()}`,
```

### Phase 2: Fix E2E Import Tests

**File**: `src/__tests__/e2e/specs/06-import/import-articles.spec.ts`

Option 2A: Add cleanup in afterEach (Recommended)
```typescript
test.afterEach(async ({ authenticatedPage }) => {
  // Cleanup any articles created during this test
  // The global-teardown will also catch these, but this is belt-and-suspenders
});
```

Option 2B: Mark import test articles for cleanup by modifying the content
- Add `[TEST]` marker in the content that gets preserved through LLM reformatting
- This is fragile and not recommended

**Better approach**: The global-teardown already handles cleanup. Just ensure tests run with proper isolation and the teardown catches LLM-generated content by querying for recently-created articles by the test user.

### Phase 3: Production Migration - Clean Existing Junk

> **ONE-TIME CLEANUP (2026-01-12)**
>
> As of this date, there are **no real users on production**. All content is test-generated.
> This allows us to use broader deletion patterns safely. These patterns should NOT be used
> after real users start creating content.

Create migration script: `scripts/cleanup-specific-junk.ts`

```typescript
/**
 * One-time cleanup for specific junk patterns in production.
 * Targets articles that slipped through before prefix filtering was implemented.
 *
 * IMPORTANT: This script uses broad patterns that are ONLY safe because there are
 * no real users on production as of 2026-01-12. Do NOT reuse these patterns after
 * real users start creating content.
 */

const JUNK_PATTERNS = [
  // Broad patterns for test-generated content (safe only for one-time cleanup)
  '%react%',           // Any title containing "react" (case-insensitive via ilike)
  '%bug%',             // Any title containing "bug" (case-insensitive via ilike)
  // Generic test patterns that don't match [TEST] or test-
  'Test Topic %',
  'Test Explanation %',
];

// JUSTIFICATION FOR BROAD PATTERNS:
// 1. NO REAL USERS exist on production as of 2026-01-12
// 2. All content matching these patterns is test-generated junk
// 3. This is a ONE-TIME cleanup operation
// 4. After this cleanup, the [TEST] prefix convention will prevent future junk
// 5. DO NOT reuse these patterns once real users start creating content
```

**Migration steps**:
1. Run `--dry-run` to identify matching articles
2. Review the list manually
3. Run with `--prod` flag after confirmation
4. Delete from both Supabase AND Pinecone

### Phase 4: Enhance Global Teardown

**File**: `src/__tests__/e2e/setup/global-teardown.ts`

Add cleanup for articles created by test user during test runs, regardless of prefix:

```typescript
// In cleanupProductionData function:
// Delete ALL explanations created by test user after test start time
const testStartTime = /* read from temp file or env */;
const { data: testUserArticles } = await supabase
  .from('userLibrary')
  .select('explanationid')
  .eq('userid', testUserId)
  .gte('created_at', testStartTime);
```

### Phase 5: Fix debug-publish-bug.spec.ts

**File**: `src/__tests__/e2e/specs/debug-publish-bug.spec.ts`

This test runs on production nightly (not tagged `@skip-prod`) and creates real LLM-generated content via search queries like `publish bug test ${Date.now()}`. The LLM generates titles like "Bug Report 1768026914892".

**Fix**:
1. Add `[TEST]` prefix to search query
2. Add `trackExplanationForCleanup()` after explanation creation

```typescript
import { TEST_CONTENT_PREFIX, trackExplanationForCleanup } from '../helpers/test-data-factory';

// Use [TEST] prefix for easier detection and cleanup
const uniqueQuery = `${TEST_CONTENT_PREFIX} publish bug test ${Date.now()}`;

// After explanation_id appears in URL:
const explanationId = url.searchParams.get('explanation_id');
if (explanationId) {
  trackExplanationForCleanup(explanationId);
}
```

### Phase 6: Fix action-buttons.spec.ts

**File**: `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts`

This test runs on production nightly and creates explanations via search queries without tracking:
- `test query for save ${Date.now()}`
- `test disable save ${Date.now()}`

**Fix**: Same pattern as Phase 5 - add `[TEST]` prefix and tracking to both queries.

### Phase 7: Verify and Document

1. Run integration tests - verify no new `Test Topic` articles created
2. Run E2E tests - verify cleanup catches import test articles
3. Update `docs/docs_overall/testing_overview.md` with any new patterns

## Testing

### Unit Tests
- No new unit tests needed (filtering logic already tested)

### Integration Tests
- Run `npm run test:integration` - verify tag-management tests pass with new prefix
- Verify teardown cleans up `[TEST] Topic` and `[TEST] Explanation` patterns

### E2E Tests
- Run `npm run test:e2e` on dev
- Check database after run - no orphan articles with LLM-generated titles

### Manual Verification
1. Before migration: Query production for JUNK_PATTERNS count
2. After migration: Verify count is 0
3. Check Explore page shows no test content

## Documentation Updates

| File | Update |
|------|--------|
| `docs/docs_overall/testing_overview.md` | Add note about `Test Topic` vs `[TEST] Topic` pattern |
| Research doc | Update with findings from this planning |
| Progress doc | Track execution |

## Rollback Plan

If migration deletes legitimate content:
1. Check `scripts/cleanup-specific-junk-*.log` for deleted IDs
2. Restore from Supabase backup (daily backups retained 7 days)
3. Pinecone vectors would need to be re-generated

## Success Criteria

1. No new articles matching junk patterns created after test runs
2. Production cleaned of existing junk matching specific patterns
3. Explore page shows only legitimate content
4. E2E tests still pass with proper cleanup

---

## Status: COMPLETE ✅ (2026-01-13)

All phases executed successfully:

| Phase | Status | Details |
|-------|--------|---------|
| Phase 1: Fix Integration Tests | ✅ Complete | 6 files updated with `[TEST]` prefix |
| Phase 2: Fix E2E Import Tests | ✅ Complete | Auto-tracking cleanup system implemented |
| Phase 3: Production Migration | ✅ Complete | 71 junk articles deleted |
| Phase 4: Enhance Global Teardown | ✅ Complete | `cleanupAllTrackedExplanations()` added |
| Phase 5: Fix debug-publish-bug.spec.ts | ✅ Complete | `[TEST]` prefix + tracking added |
| Phase 6: Fix action-buttons.spec.ts | ✅ Complete | `[TEST]` prefix + tracking added (2 queries) |
| Phase 7: Verify and Document | ✅ Complete | Production verified clean |

**Production cleanup totals:**
- 53 React Hooks + Bug entries (cleanup script)
- 4 Bug Report/tracking entries (manual - protected terms)
- 14 Action Buttons Test entries (manual)
- **Total: 71 explanations deleted**
