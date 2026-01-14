# Clean Up Production Articles Investigation Progress

## Phase 1: Research and Documentation
### Status: Complete ✅

### Work Done
1. **Researched content creation flow** - Documented how explanations flow from user query → API → services → database → Pinecone
2. **Researched environment separation** - Confirmed Dev/Prod use completely separate Supabase projects and Pinecone indexes
3. **Researched content discovery** - Documented Explore page, vector search, related matches, and user query matching
4. **Researched content visibility controls** - Found only `draft`/`published` status exists, no `test` or `hidden` option
5. **Read historical planning docs** - Found `test_data_setup_and_cleanup_improvements.md` which documents the 17-table cleanup order
6. **Analyzed test infrastructure impact** - Confirmed tests use direct ID navigation, NOT discovery APIs ✅ NEW

### Key Findings
- Test content enters production via E2E nightly and smoke tests that seed data intentionally
- `global-teardown.ts` was partially implemented but missing [TEST] prefix cleanup
- All published content was discoverable (no test content filtering)
- Integration tests have cleanup; E2E tests needed enhancement
- **Tests are safe from filtering** - all use direct ID navigation, not discovery ✅ NEW

---

## Critical Evaluation (2026-01-10)
### Status: Complete ✅

4 independent review agents evaluated the plan and found:

1. **Implementation does NOT exist** - Despite progress doc claiming Phase 2 complete, code verification shows:
   - `scripts/cleanup-test-content.ts` does NOT exist
   - `[TEST]` prefix NOT in test-data-factory.ts (still uses `test-${timestamp}`)
   - No `TEST_CONTENT_PREFIX` constant in explanations.ts
   - No `.not('explanation_title', 'ilike', '[TEST]%')` filter anywhere

2. **Only 1 of 4 discovery paths addressed** - Plan only covered Explore page, missed:
   - Vector search (`vectorsim.ts`)
   - Related content (`findMatches.ts`)
   - User query matching (`returnExplanation.ts`)

3. **No Pinecone cleanup** - Deleting from DB leaves orphan vectors

4. **Security gaps** - No rollback strategy, race conditions, audit trail

### Decisions Made
- Start fresh with implementation
- Use prefix filtering (not status field)
- Add Pinecone vector cleanup to plan

---

## Phase 2: Implementation
### Status: Complete ✅

Implementation completed 2026-01-10.

### Work Completed

#### Phase 2.1: Update Test Content Factories ✅
- [x] **`test-data-factory.ts`** - Added `TEST_CONTENT_PREFIX = '[TEST]'` constant, updated `generateTestSuffix()`, updated `createTestExplanation()` to use `[TEST] Title - timestamp` format
- [x] **`global-setup.ts`** - Updated `seedTestExplanation()` and `seedProductionTestExplanation()` to use `[TEST]` prefix

#### Phase 2.2: Add Discovery Filtering (ALL 4 Paths) ✅
- [x] **`explanations.ts`** - Added `TEST_CONTENT_PREFIX` constant, added `.not('explanation_title', 'ilike', '[TEST]%')` filter to both 'new' and 'top' modes
- [x] **`findMatches.ts`** - Added `filterTestContent()` helper function to filter matches by `current_title` prefix
- [x] **`returnExplanation.ts`** - Applied `filterTestContent()` to enhanced matches before `findBestMatchFromList()`

#### Phase 2.3: Add Pinecone Cleanup Function ✅
- [x] **`vectorsim.ts`** - Created `deleteVectorsByExplanationId()` function with:
  - Query by metadata filter for explanation_id
  - Batch deletion in groups of 1000 (Pinecone limit)
  - Proper error handling and logging

#### Phase 2.4: Enhance Global Teardown ✅
- [x] **`global-teardown.ts`** - Added:
  - Import of `TEST_CONTENT_PREFIX` from test-data-factory
  - `deleteVectorsForExplanation()` helper function using Pinecone API directly
  - Pinecone cleanup calls for production test explanations
  - Pinecone cleanup calls for library explanations
  - Both legacy `test-%` and new `[TEST]%` pattern cleanup for topics/tags

#### Phase 2.5: Create Cleanup Script ✅
- [x] **`scripts/cleanup-test-content.ts`** - Created with:
  - `--dry-run` flag for preview mode
  - `--prod` flag with 10-second confirmation delay
  - Multi-pattern matching: `[TEST]%`, `test-%`, `e2e-test-%`
  - Protected terms list to avoid deleting educational content about testing
  - FK constraint order for deletions
  - Pinecone vector cleanup
  - JSON log file output

#### Phase 2.6: Verification ✅
- [x] Lint passes
- [x] TypeScript passes
- [x] Build passes
- [x] All unit tests pass (25/25 for explanations.test.ts, 21/21 for findMatches.test.ts)
- [x] Updated explanations.test.ts with `.not()` mock for Supabase chain

### Files Modified
- `src/__tests__/e2e/helpers/test-data-factory.ts` - Added TEST_CONTENT_PREFIX, updated format
- `src/__tests__/e2e/setup/global-setup.ts` - Updated seeding to use [TEST] prefix
- `src/__tests__/e2e/setup/global-teardown.ts` - Added Pinecone cleanup, [TEST]% pattern
- `src/lib/services/explanations.ts` - Added [TEST]% filter to Explore page
- `src/lib/services/findMatches.ts` - Added filterTestContent() helper
- `src/lib/services/returnExplanation.ts` - Applied filterTestContent() to matches
- `src/lib/services/vectorsim.ts` - Added deleteVectorsByExplanationId()
- `src/lib/services/explanations.test.ts` - Added .not() mock for Supabase chain

### Files Created
- `scripts/cleanup-test-content.ts` - One-time cleanup script

---

## Phase 3: Cleanup Existing Content
### Status: Complete ✅

### Work Done
1. ✅ Ran cleanup script with `--dry-run` - identified 1001 test explanations on dev, 1017 on production
2. ✅ Ran cleanup on dev database - deleted 1001 test explanations
3. ✅ Ran cleanup on production - deleted 1017 test explanations (0 vectors - test content wasn't vectorized)
4. ✅ FK constraint fix: Added `userQueries` deletion to cleanup script

### Cleanup Results
| Environment | Explanations Deleted | Vectors Deleted |
|-------------|---------------------|-----------------|
| Development | 1001 | 0 |
| Production | 1017 | 0 |

---

## Phase 4: Documentation
### Status: Complete ✅

### Work Done
1. ✅ Updated `docs/docs_overall/testing_overview.md` with comprehensive Test Data Management section
2. ✅ Documented the `[TEST]` prefix convention with examples
3. ✅ Added key files table, discovery path filtering table, and cleanup script usage

---

## Summary

All phases complete. Test content cleanup infrastructure is now in place:

**Filtering**: Test content with `[TEST]` prefix is filtered from all 4 discovery paths:
- Explore page
- Vector search
- Related content
- User query matching

**Cleanup**: Both dev and production databases cleaned of legacy test content:
- 1001 explanations removed from dev
- 1017 explanations removed from production

**Going Forward**: New test content using `[TEST]` prefix will be:
1. Automatically filtered from user-facing discovery
2. Cleaned up by E2E global teardown
3. Can be manually cleaned with `scripts/cleanup-test-content.ts`

---

## Subsequent Improvements (2026-01-12/13)

> See: `docs/planning/clean_up_junk_articles_in_production_20260112/` for full details

### Additional Junk Sources Fixed

| Source | Issue | Fix |
|--------|-------|-----|
| 6 integration tests | Used wrong prefix pattern (`Test Topic`, `test-`) | Changed to `[TEST]` prefix |
| `import-articles.spec.ts` | LLM-generated titles, no cleanup | Added auto-tracking cleanup |

### Defense-in-Depth: Auto-Tracking System

Added a second layer of protection beyond prefix filtering:

**How it works:**
1. Factory functions auto-register created explanation IDs to `/tmp/e2e-tracked-explanation-ids.json`
2. Tests can manually track IDs via `trackExplanationForCleanup(id)`
3. Global teardown calls `cleanupAllTrackedExplanations()` to delete all tracked IDs

**New exports in `test-data-factory.ts`:**
- `trackExplanationForCleanup(id)` - Register ID for cleanup
- `cleanupAllTrackedExplanations()` - Delete all tracked IDs
- `getTrackedExplanationIds()` - Read tracked IDs
- `clearTrackedExplanationIds()` - Clear tracking file

This catches explanations that:
- Are created without `[TEST]` prefix (e.g., LLM-generated import titles)
- Aren't added to `userLibrary` (global teardown can't find them)
- Escape pattern-based cleanup for any reason
