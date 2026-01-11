# Clean Up Production Articles Investigation Plan

## Background

E2E tests (nightly workflow and post-deploy smoke tests) run against the production Vercel deployment. These tests seed test data into production but `global-teardown.ts` is empty, so test content accumulates and is discoverable by real users.

## Problem

Test content pollutes production: Explore page, search, and related content all return test explanations.

---

## Critical Evaluation (2026-01-10)

### Finding: Progress Document Claims Don't Match Code

4 independent review agents verified that **Phase 2 implementation does NOT exist** despite progress doc claiming completion:

| Claimed in Progress Doc | Actual State |
|------------------------|--------------|
| `scripts/cleanup-test-content.ts` created | **Does NOT exist** |
| `[TEST]` prefix in `test-data-factory.ts` | **Not present** - still uses `test-${timestamp}` |
| `TEST_CONTENT_PREFIX` constant in `explanations.ts` | **Not present** |
| `.not('explanation_title', 'ilike', '[TEST]%')` filter | **Not present** |
| `[TEST]` cleanup in `global-teardown.ts` | **Not present** - only cleans `test-%` |

### Critical Gaps Identified

#### 1. Only 1 of 4 Discovery Paths Addressed
Original plan only mentioned Explore page. All 4 paths need filtering:

| Path | File | Status |
|------|------|--------|
| Explore page | `explanations.ts` | Not implemented |
| Vector search | `vectorsim.ts` | Not addressed in plan |
| Related content | `findMatches.ts` | Not addressed in plan |
| User query matching | `returnExplanation.ts` | Not addressed in plan |

#### 2. No Pinecone Cleanup
- No `deleteVectorsByExplanationId()` function exists
- Deleting from Supabase leaves orphan vectors in Pinecone
- Orphan vectors continue appearing in similarity searches

### Decisions Made

- ✅ Start fresh (don't investigate missing implementation)
- ✅ Use prefix filtering approach (not status field)
- ✅ Add Pinecone vector cleanup

---

## Revised Execution Plan

### Phase 1: Update Test Content Factories
**Goal**: All test content uses `[TEST]` prefix

1. **`src/__tests__/e2e/helpers/test-data-factory.ts`**
   - Add `TEST_CONTENT_PREFIX = '[TEST]'` constant
   - Update `createTestExplanation()` to use `[TEST] Title - ${timestamp}` format
   - Update `createTestTag()` and `createTestTopic()` similarly

2. **`src/__tests__/e2e/setup/global-setup.ts`**
   - Update `seedTestExplanation()` to use `[TEST]` prefix
   - Update `seedProductionTestExplanation()` to use `[TEST]` prefix

3. **`src/testing/fixtures/database-records.ts`**
   - Update `TEST_PREFIX` constant to `'[TEST] '`

### Phase 2: Add Discovery Filtering (ALL 4 Paths)
**Goal**: Test content excluded from all user-facing discovery

1. **`src/lib/services/explanations.ts`** - Explore page
   - Add `TEST_CONTENT_PREFIX` constant
   - Add `.not('explanation_title', 'ilike', '[TEST]%')` to `getRecentExplanationsImpl()` for both 'new' and 'top' modes

2. **`src/lib/services/findMatches.ts`** - Related content
   - Add `filterTestContent()` helper function
   - Filter AFTER `enhanceMatchesWithCurrentContentAndDiversity()` but BEFORE `findBestMatchFromList()`

3. **`src/lib/services/vectorsim.ts`** - Vector search
   - Add post-query filtering to `searchForSimilarVectorsImpl()` results
   - Filter by title prefix after Pinecone query

4. **`src/lib/services/returnExplanation.ts`** - User query matching
   - Apply `filterTestContent()` to enhanced matches before `findBestMatchFromList()`

### Phase 3: Add Pinecone Cleanup Function
**Goal**: Delete vectors when explanations are deleted

**`src/lib/services/vectorsim.ts`**:
```typescript
export async function deleteVectorsByExplanationId(explanationId: string): Promise<void> {
  return withLogging('deleteVectorsByExplanationId', async () => {
    const index = getPineconeClient().index(PINECONE_INDEX_NAME_ALL);

    // Query for all vectors with this explanation_id (serverless-compatible)
    const queryResult = await index.query({
      vector: new Array(1536).fill(0), // dummy vector for metadata-only query
      filter: { explanation_id: explanationId },
      topK: 10000,
      includeMetadata: false
    });

    if (queryResult.matches && queryResult.matches.length > 0) {
      const vectorIds = queryResult.matches.map(m => m.id);
      // Delete in batches of 1000 (Pinecone limit)
      for (let i = 0; i < vectorIds.length; i += 1000) {
        const batch = vectorIds.slice(i, i + 1000);
        await index.deleteMany(batch);
      }
    }
  });
}
```

**Note**: Pinecone serverless doesn't support metadata-filter deletion directly. Must query IDs first, then delete by ID.

### Phase 4: Enhance Global Teardown
**Goal**: Clean test content after E2E runs

1. **`src/__tests__/e2e/setup/global-teardown.ts`**
   - Add cleanup for `[TEST]%` prefixed explanations
   - Add cleanup for legacy patterns: `test-%`, `e2e-%`
   - Call `deleteVectorsByExplanationId()` for each deleted explanation
   - Add better error handling and logging

### Phase 5: Create Cleanup Script
**Goal**: One-time cleanup of existing test content

1. **Create `scripts/cleanup-test-content.ts`**
   - `--dry-run` flag to preview deletions
   - `--prod` flag with confirmation delay
   - Multi-pattern matching: `[TEST]%`, `test-\d{13}-%`, `e2e-%`
   - Respect FK constraint order (see Technical Details section)
   - Call Pinecone delete for each explanation
   - Log all deletions to local file

### Phase 6: Verification & Testing

1. **Unit tests**
   - Test `[TEST]%` filtering in explanations.ts
   - Test Pinecone delete function

2. **Integration test**
   - Create `[TEST]` content, verify not in Explore page
   - Create `[TEST]` content, verify not in vector search results

3. **Manual verification**
   - Run cleanup with `--dry-run` on dev
   - Run cleanup on dev, verify Explore page clean
   - Run cleanup with `--dry-run` on prod
   - Run cleanup on prod

---

## Test Impact Analysis (Updated 2026-01-10)

### Will Filtering Break Existing Tests?

**YES - 7+ tests will break.** Independent verification by 3 agents found the original analysis was incomplete.

### Critical Finding: Prefix Mismatch

**Current factory format:** `test-${timestamp}-${randomId}-${title}`
- Example: `test-1704067200000-xyz12-Library Test`

**Proposed filter:** `[TEST]%`

**These patterns DON'T MATCH.** The original analysis assumed `[TEST]%` prefix was in use, but it isn't.

### Tests That WILL Break

#### E2E Tests (3 tests) - Use Real Search UI

| File | Test | Tag | Issue |
|------|------|-----|-------|
| `search-generate.spec.ts` | Home page search | @critical | Searches for "quantum entanglement" via UI |
| `library.spec.ts:194-211` | Search from library | @critical | Searches for "quantum" from library page |
| `add-sources.spec.ts:165-197` | Sources + search | @critical | Searches "Explain quantum computing" |

These tests use **real search functionality**, not mocked responses. They expect search results to return.

#### Integration Tests (2 tests) - Direct Vector Search Calls

| File | Issue |
|------|-------|
| `vector-matching.integration.test.ts` | Directly calls `findMatchesInVectorDb()` 4+ times with mock data lacking `[TEST]%` |
| `explanation-generation.integration.test.ts` | Calls `returnExplanationLogic()` which internally does vector search |

#### Unit Tests (2 tests) - Mock Data Without Prefix

| File | Issue |
|------|-------|
| `findMatches.test.ts:354-408` | Mock explanations use title `'Test Explanation'` without `[TEST]%` |
| `explanations.test.ts:179-346` | Mock data titles like `'Explanation 1'` without prefix |

### Tests That ARE Safe (95%)

Most E2E tests use **direct ID navigation** (`/results?explanation_id=${id}`) and won't be affected:
- All 06-ai-suggestions/* specs (15 files, 60+ tests)
- viewing.spec.ts, action-buttons.spec.ts, tags.spec.ts
- regenerate.spec.ts, auth.spec.ts

### Required Test Infrastructure Updates

Before implementing discovery filtering, update these files:

#### Phase 1: Test Data Factory
**File:** `src/__tests__/e2e/helpers/test-data-factory.ts`
```typescript
// Add at top
export const TEST_CONTENT_PREFIX = '[TEST]';

// Change prefix format from:
//   `test-${timestamp}-${randomId}-${title}`
// To:
//   `[TEST] ${title} - ${timestamp}`
```

#### Phase 2: Unit Test Mocks
- `src/lib/services/findMatches.test.ts` - Update mock `explanation_title` to `'[TEST] Explanation'`
- `src/lib/services/explanations.test.ts` - Update mock titles to `'[TEST] Explanation 1'`

#### Phase 3: Integration Test Mocks
- `src/__tests__/integration/vector-matching.integration.test.ts` - Update mock Supabase responses (not Pinecone metadata)
- `src/__tests__/integration/explanation-generation.integration.test.ts` - Update mock responses

#### Phase 4: E2E Search Tests
Change to direct ID navigation instead of relying on search:
- `src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts`
- `src/__tests__/e2e/specs/03-library/library.spec.ts`
- `src/__tests__/e2e/specs/08-sources/add-sources.spec.ts`

#### Phase 5: Setup/Teardown
- `src/__tests__/e2e/setup/global-setup.ts` - Use `[TEST]` prefix in seeding
- `src/__tests__/e2e/setup/global-teardown.ts` - Target `[TEST]%` pattern

---

## Critical Files

### Test Infrastructure (Update FIRST - Before Filtering)

| File | Change |
|------|--------|
| `src/__tests__/e2e/helpers/test-data-factory.ts` | Add `[TEST]` prefix constant and update format |
| `src/testing/fixtures/database-records.ts` | Update TEST_PREFIX constant |
| `src/__tests__/e2e/setup/global-setup.ts` | Update seeding to use `[TEST]` prefix |
| `src/__tests__/e2e/setup/global-teardown.ts` | Target `[TEST]%` pattern for cleanup |
| `src/lib/services/findMatches.test.ts` | Update mock explanation titles |
| `src/lib/services/explanations.test.ts` | Update mock data titles |
| `src/__tests__/integration/vector-matching.integration.test.ts` | Update mock Supabase responses |
| `src/__tests__/integration/explanation-generation.integration.test.ts` | Update mock responses |

### Discovery Filtering (Update AFTER Test Infrastructure)

| File | Change |
|------|--------|
| `src/lib/services/explanations.ts` | Add `[TEST]%` filter to Explore |
| `src/lib/services/findMatches.ts` | Add `filterTestContent()` helper + post-enhance filter |
| `src/lib/services/vectorsim.ts` | Add delete function + post-query filter |
| `src/lib/services/returnExplanation.ts` | Apply filter before `findBestMatchFromList()` |

### New Files

| File | Purpose |
|------|---------|
| `scripts/cleanup-test-content.ts` | One-time cleanup script |

---

## Technical Details

### FK Cleanup Order

When deleting explanations, respect foreign key constraints:
1. `article_link_overrides`
2. `article_heading_links`
3. `article_sources`
4. `candidate_occurrences`
5. `link_candidates`
6. `explanation_tags`
7. `explanation_metrics`
8. `user_library`
9. `explanations` (last)

### Filter Implementation for findMatches.ts

Filter AFTER `enhanceMatchesWithCurrentContentAndDiversity()` but BEFORE `findBestMatchFromList()`:

```typescript
// In findMatches.ts - NEW helper function
export function filterTestContent<T extends { explanation_title?: string }>(
  matches: T[]
): T[] {
  return matches.filter(m => !m.explanation_title?.startsWith('[TEST]'));
}

// Usage in returnExplanation.ts (line ~557)
const enhancedMatches = await enhanceMatchesWithCurrentContentAndDiversity(matches);
const filteredMatches = filterTestContent(enhancedMatches);
const bestMatch = await findBestMatchFromList(filteredMatches);
```

### withLogging() Requirement

All new service functions MUST use the `withLogging()` wrapper for consistency.

### Protected Terms (Basic List)

Don't delete content about testing as a topic:
- test-driven, unit testing, integration testing
- a/b testing, load testing, performance testing

---

## Verification Checklist

### Phase 0: Test Infrastructure (Do FIRST)
- [ ] `test-data-factory.ts` uses `[TEST]` prefix
- [ ] `database-records.ts` TEST_PREFIX updated
- [ ] `global-setup.ts` seeds with `[TEST]` prefix
- [ ] `global-teardown.ts` targets `[TEST]%` pattern
- [ ] Unit test mocks use `[TEST]` prefixed titles
- [ ] Integration test mocks use `[TEST]` prefixed data
- [ ] E2E search tests use direct ID navigation
- [ ] `npm test` passes (unit tests)
- [ ] `npm run test:integration` passes
- [ ] `npm run test:e2e` passes

### Phase 1-5: Discovery Filtering & Cleanup
- [ ] Explore page excludes `[TEST]%` content
- [ ] Vector search excludes `[TEST]%` content
- [ ] Related content excludes `[TEST]%` content
- [ ] Pinecone delete function works
- [ ] Cleanup script works on dev with `--dry-run`
- [ ] Cleanup script works on dev (actual run)
- [ ] Cleanup script works on prod with `--dry-run`
- [ ] All tests still pass after filtering added
- [ ] Build passes

---

## Documentation Updates

- `docs/docs_overall/testing_overview.md` - Add test data management section

---

## Lower Priority / Future Enhancements

These items improve robustness but are not essential for the core fix:

### 1. Database Audit Table
Create `cleanup_audit_log` table for durable audit trail instead of local file logging.

### 2. PostgreSQL RPC Function
Create `delete_explanation_cascade` RPC for atomic deletion instead of sequential deletes.

### 3. Full Content Backup
Before deletion, backup complete content including all related tables (tags, sources, metrics, link_candidates, heading_links) for potential restore capability.

### 4. Two-Pass Cleanup
Run cleanup twice to catch content created during first pass (race condition mitigation).

### 5. Environment Verification
Add explicit environment verification (dev vs prod URL pattern matching) before running cleanup script.

### 6. Comprehensive Protected Terms
Expand protected terms list to cover all testing-related educational content:
- smoke testing, regression testing, acceptance testing
- testing framework, testing methodology, software testing
- beta testing, user testing, api testing, ui testing

### 7. PR Separation Enforcement
Split into separate PRs with explicit dependencies:
- PR 1: Test Infrastructure (merge first)
- PR 2: Discovery Filtering (depends on PR 1)
- PR 3: Cleanup Script (run after PR 2 deployed)
