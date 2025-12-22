# E2E Test Flakiness Analysis - December 22, 2025 (Part 2)

## Summary

Two merge failures on main branch identified and fixed:

| Run ID | Commit | Failed Test | Root Cause | Fix Applied |
|--------|--------|-------------|------------|-------------|
| 20440696808 | a4db8d6 | E2E: `should preserve query in URL after generation` | URL check raced with page transitions | Added retry pattern with `toPass()` |
| 20440534679 | d16603d | Integration: `should handle adding multiple tags efficiently` | Race condition in parallel tag creation | Changed to sequential tag creation |

---

## Failure 1: Integration Test - Bulk Tag Operations

### File
`src/__tests__/integration/tag-management.integration.test.ts:206`

### Error
```
One or more tags not found
at addTagsToExplanation (src/lib/services/explanationTags.ts:47:11)
```

### Root Cause

The test used `Promise.all` to create 5 tags in parallel:

```typescript
const tags = await Promise.all(
  Array.from({ length: 5 }, (_, i) => createTagInDb(`tag-${i}`))
);
```

When `addTagsToExplanation` called `getTagsById(tagIds)` to validate the tags, some tags weren't yet visible to the query. This is a database consistency issue:

1. **Connection pooling**: `createSupabaseServerClient()` may use different connections
2. **Transaction isolation**: Parallel inserts may not be immediately visible to subsequent reads
3. **Eventual consistency**: Supabase may have slight read delays after writes

### Fix Applied

Changed to sequential tag creation:

```typescript
const tags = [];
for (let i = 0; i < 5; i++) {
  tags.push(await createTagInDb(`tag-${i}`));
}
```

### Lesson Learned

**Avoid parallel database writes when subsequent operations depend on all writes being visible.** Use sequential operations or add explicit verification steps.

---

## Failure 2: E2E Test - Query Preservation

### File
`src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts:190`

### Error

Page snapshot showed the test was on "Edit article" modal instead of verifying URL. The test flow was:

```typescript
await resultsPage.navigate(query);
await resultsPage.waitForCompleteGeneration();
const urlQuery = await resultsPage.getQueryFromUrl();  // Failed - page had transitioned
```

### Root Cause

The SSE mock completed too quickly and the page transitioned to the edit modal before the URL check. This is a continuation of known SSE mock timing issues documented in `failing_e2e_tests_research.md`.

### Fix Applied

Check URL immediately after navigation with retry pattern:

```typescript
await resultsPage.navigate(query);

// Check URL immediately - use retry to handle timing variations
await expect(async () => {
  const urlQuery = await resultsPage.getQueryFromUrl();
  expect(urlQuery).toBe(query);
}).toPass({ timeout: 10000 });

// Then verify generation completes
await resultsPage.waitForCompleteGeneration();
```

### Lesson Learned

**URL assertions should happen immediately after navigation, not after async operations complete.** The URL is set during navigation, not after content loads.

---

## Pattern: When to Use Retry Assertions

Use Playwright's `toPass()` retry pattern when:
1. Asserting on URL state that may have timing variations
2. Waiting for elements that appear asynchronously
3. Any assertion that may fail due to race conditions

```typescript
// Good: retry pattern for flaky assertions
await expect(async () => {
  const value = await page.locator('.dynamic').textContent();
  expect(value).toBe('expected');
}).toPass({ timeout: 10000 });
```

---

## Files Modified

| File | Change |
|------|--------|
| `src/__tests__/integration/tag-management.integration.test.ts` | Sequential tag creation |
| `src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts` | URL check with retry pattern |
