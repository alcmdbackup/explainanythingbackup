# Clean Up Production Articles Investigation Research

## Problem Statement

Test content may be appearing in the production database and becoming discoverable to users via search, explore page, and "related content" features. This research documents how content flows from creation to discovery, how environments are separated, and what mechanisms exist (or are missing) to prevent test content contamination.

## High Level Summary

### Key Findings

1. **Environment Separation IS Strong at Database Level**: Dev and Prod use COMPLETELY SEPARATE Supabase projects and Pinecone indexes. Test data in Dev cannot accidentally appear in Prod through normal operation.

2. **Test Content in Prod Comes From E2E Tests**: The `global-setup.ts` explicitly seeds test data into production for E2E nightly tests and smoke tests. This is intentional but lacks cleanup.

3. **No Cleanup Mechanism Exists**: `global-teardown.ts` is empty. Test data created during E2E runs against production accumulates indefinitely.

4. **No "Test" Content Flag**: The system only has `draft`/`published` status. There is no way to mark content as "test" to exclude it from discovery.

5. **All Published Content is Discoverable**: The Explore page and vector search return ALL content with `status='published'`. No filtering for test-prefixed titles exists.

## Environment Separation Architecture

### Database Separation (Complete)

| Environment | Supabase Project ID | Used By |
|-------------|---------------------|---------|
| **Dev** | `ifubinffdbyewoezcidz` | Local, CI tests, Vercel preview |
| **Prod** | `qbxhivoezkfbjbsctdzo` | Vercel production only |

### Pinecone Separation (Complete)

| Environment | Index Name | Namespace |
|-------------|------------|-----------|
| **Dev** | `explainanythingdevlarge` | `default` or `test` |
| **Prod** | `explainanythingprodlarge` | `default` |

### Configuration Sources

- `.env.local` → Local development (Dev database)
- `.env.test` → Integration tests (Dev database, `test` namespace)
- Vercel Preview → Dev database
- Vercel Production → Prod database

## How Test Content Reaches Production

### Path 1: E2E Nightly Tests (Primary Source)

**Location**: `.github/workflows/e2e-nightly.yml` runs full test suite against `https://explainanything.vercel.app`

**Seeding Mechanism** (`src/__tests__/e2e/setup/global-setup.ts`):
- Creates test explanations using service role key
- Uses titles like `Test Explanation - E2E - ${timestamp}`
- These are REAL entries in the production database

**Safety Checks That Exist**:
- `isProduction` detection via URL pattern (line 80)
- Skips fixture seeding if production detected (line 242)
- However, individual tests may still create data during execution

### Path 2: Post-Deploy Smoke Tests (Secondary Source)

**Location**: `.github/workflows/post-deploy-smoke.yml` runs `@smoke` tagged tests against production after deploy

**Uses Production Environment Secrets**:
- `TEST_USER_EMAIL`, `TEST_USER_PASSWORD` for production
- Any test data created persists in production

### Path 3: Manual Testing (Tertiary Source)

If developers run E2E tests locally with `BASE_URL` pointing to production, test data enters production database.

## Content Discovery Mechanisms (All Affected)

### 1. Explore Page
**File**: `src/lib/services/explanations.ts` (`getRecentExplanationsImpl`)
```typescript
.eq('status', 'published')  // Only filter - no test content exclusion
```
- Returns newest or top-viewed explanations
- Test content with `published` status appears here

### 2. Vector Search
**File**: `src/lib/services/vectorsim.ts`
- Searches Pinecone for similar content by embedding
- No metadata filtering for test content
- Test explanations stored in `explainanythingprodlarge` are searchable

### 3. Related Matches
**File**: `src/lib/services/findMatches.ts`
- Returns similar explanations to current view
- Uses vector search results enhanced with database content
- Test content appears as "related" if vector similarity is high

### 4. User Query Matching
**File**: `src/lib/services/returnExplanation.ts`
- When user searches, existing matches evaluated before generating new
- Test content can be returned as a match

## Content Status Controls (Current)

### Explanation Status (Only Control)

| Status | Visibility | Discovery |
|--------|------------|-----------|
| `published` | Everyone | Explore, Search, Related |
| `draft` | Creator only | Not discoverable |

**No "test" or "hidden" status exists.**

### Tag Soft-Delete (Unrelated)
- `explanation_tags.isDeleted` boolean for tag relationships
- Does not affect explanation visibility

### Link Candidate Status (Unrelated)
- `pending`, `approved`, `rejected` for link suggestions
- Does not affect explanation visibility

## Cleanup Infrastructure Gap

### What Exists

**Integration Tests** (`src/testing/utils/integration-helpers.ts`):
- `test-${timestamp}-${random}` pattern for test IDs
- `cleanupTestData()` deletes by test prefix
- Only covers 5 of 17 tables

**E2E Tests**:
- `global-setup.ts` seeds test data
- `global-teardown.ts` is **empty** - no cleanup

### Tables Missing from Cleanup

| Table | Impact | Current Cleanup |
|-------|--------|-----------------|
| `userQueries` | High | None |
| `userExplanationEvents` | High | None |
| `explanationMetrics` | High | None |
| `link_candidates` | Medium | None |
| `source_cache` | Medium | None |
| `article_sources` | Medium | None |
| `article_heading_links` | Medium | None (CASCADE) |

## Code References

### Content Creation Flow
- `src/app/api/returnExplanation/route.ts` - API endpoint
- `src/lib/services/returnExplanation.ts` - Main orchestration
- `src/lib/services/explanations.ts:createExplanation` - Database insert

### Environment Configuration
- `src/lib/utils/supabase/server.ts:17-35` - Supabase client (reads env vars)
- `src/lib/services/vectorsim.ts:17-19` - Pinecone client initialization

### Content Discovery
- `src/lib/services/explanations.ts:130` - Explore page query (`.eq('status', 'published')`)
- `src/lib/services/vectorsim.ts:275-360` - Vector search
- `src/lib/services/findMatches.ts:89-175` - Match enhancement

### E2E Test Infrastructure
- `src/__tests__/e2e/setup/global-setup.ts:179-242` - Production seeding
- `src/__tests__/e2e/setup/global-teardown.ts` - Empty file
- `src/__tests__/e2e/helpers/test-data-factory.ts` - Creates test explanations

## Historical Context (from planning docs)

### test_data_setup_and_cleanup_improvements.md
- Recommends Option 2 (Per-Test Data + Cleanup) or Option 5 (Hybrid)
- Documents that E2E cleanup infrastructure does not exist
- Lists all 17 tables that need cleanup
- Provides FK-respecting cleanup order

### fix_tests_in_production_20260106/fix_tests_research.md
- Documents that E2E tests seed data into production intentionally
- Notes that seeding works but mocking doesn't in production
- AI suggestion tests fail because they require mocking

## Summary: Why Test Content Appears in Production

```
E2E Nightly/Smoke Tests
        │
        ▼
global-setup.ts creates test explanations
        │
        ▼
Test explanations inserted into PROD database
with status='published'
        │
        ▼
global-teardown.ts is EMPTY (no cleanup)
        │
        ▼
Test content persists indefinitely
        │
        ▼
Explore page, Search, Related all return test content
```

## Test Infrastructure Analysis

### Do Tests Depend on Discovering Test Content?

**No.** All test types use direct ID navigation, not discovery:

| Test Type | Creates Test Data | Discovery Method | Would Break from Filtering? |
|-----------|------------------|------------------|----------------------------|
| **E2E (12+ specs)** | Yes | Direct URL: `/results?explanation_id=${id}` | **No** |
| **Integration (14 tests)** | Yes | Direct DB queries with service role | **No** |
| **Global Setup** | Yes | Stores IDs in files/variables | **No** |

### E2E Test Pattern (All 12+ Specs)

```typescript
test.beforeAll(async () => {
  testExplanation = await createTestExplanationInLibrary({
    title: 'Test Content',
    status: 'published',
  });
});

test('test case', async ({ page }) => {
  // Direct navigation - NOT via search/explore
  await page.goto(`/results?explanation_id=${testExplanation.id}`);
});

test.afterAll(async () => {
  await testExplanation.cleanup();
});
```

### Integration Test Pattern

- Uses service role key (bypasses all RLS and filters)
- Creates data via direct `.insert()`, references by returned ID
- Cleanup via `.ilike('explanation_title', 'test-%')`

### Key Files

| File | Purpose |
|------|---------|
| `src/__tests__/e2e/helpers/test-data-factory.ts` | E2E test data creation |
| `src/__tests__/e2e/setup/global-setup.ts` | E2E seeding (dev + prod) |
| `src/testing/utils/integration-helpers.ts` | Integration test utilities |

### Conclusion

**The `[TEST]%` filtering approach is safe to implement.** Tests are intentionally designed with direct ID navigation, making them decoupled from production filtering logic.

## Options Considered

### Option A: Immediate Cleanup - Delete Existing Test Content
**Approach**: Run a one-time script to identify and delete test content from production database and Pinecone index.

| Pros | Cons |
|------|------|
| Immediately removes visible test content | Doesn't prevent future contamination |
| Simple to implement | Need to identify all test content patterns |
| No schema changes needed | May miss some test content |

**Implementation**:
1. Query explanations where `explanation_title ILIKE '[TEST]%'` or legacy patterns
2. Delete from all related tables (respecting FK order)
3. Delete corresponding vectors from Pinecone by `explanation_id`

### Option B: Add `[TEST]` Prefix Convention + Filtering
**Approach**: All test explanations use `[TEST]` prefix in title. Discovery queries explicitly filter out titles starting with `[TEST]`.

| Pros | Cons |
|------|------|
| Defense in depth - works even if status fails | Relies on naming convention |
| Easy to identify test content visually | All discovery queries need updating |
| No schema change required | Prefix could be used maliciously |

**Implementation**:
1. Update test factories to use `[TEST]` prefix
2. Update `getRecentExplanationsImpl` to filter `.not('explanation_title', 'ilike', '[TEST]%')`
3. Update vector search post-processing to filter by title
4. Update match enhancement to filter results

### Option C: Add "test" Status Value
**Approach**: Add `test` as a valid status alongside `draft`/`published`, update all discovery queries to filter it out.

| Pros | Cons |
|------|------|
| Semantic clarity - test content marked as test | Schema change required |
| Discovery queries easily filter | Need to update existing test content |
| Allows keeping test content for debugging | All discovery queries need updating |

**Implementation**:
1. Migration: Add `'test'` to status CHECK constraint
2. Update `getRecentExplanationsImpl` to exclude `test` status
3. Update vector search to filter by status metadata
4. Update E2E factories to create with `status='test'`

### Option D: Implement global-teardown Cleanup
**Approach**: Actually implement cleanup in `global-teardown.ts` to remove test data after E2E runs.

| Pros | Cons |
|------|------|
| Prevents future contamination | Doesn't fix existing content |
| Standard testing practice | Need service role in teardown |
| Covers all 17 affected tables | Tests may fail before teardown runs |

**Implementation**:
1. Create cleanup function respecting FK order (see test_data_setup_and_cleanup_improvements.md)
2. Add service role client to teardown
3. Delete by test title pattern: `ILIKE '[TEST]%'`
4. Delete vectors from Pinecone by `explanation_id`

### Option E: Don't Seed Production at All (Long-term)
**Approach**: E2E tests against production should use existing real content, not create test data.

| Pros | Cons |
|------|------|
| No test contamination possible | Need to rethink production test strategy |
| Production stays clean | Some test scenarios impossible |
| Aligns with smoke test purpose | Requires test refactoring |

**Implementation**:
1. Smoke tests only verify: auth works, pages load, existing content displays
2. Remove `test-data-factory.ts` usage for production runs
3. Production-specific E2E specs that don't create data

## Recommended Approach

Combine Options A + B + C + D for defense in depth:

1. **Option A**: Clean up existing test content immediately
2. **Option B**: Add `[TEST]` prefix filtering as safety net
3. **Option C**: Add `test` status for semantic clarity
4. **Option D**: Implement global-teardown for future prevention

## Open Questions

1. **Scope of contamination**: How many test explanations currently exist in production?
2. **Identification pattern**: Do all test explanations follow `Test Explanation - E2E - *` pattern?
3. **Vector store cleanup**: Are test vectors in `explainanythingprodlarge` index?
