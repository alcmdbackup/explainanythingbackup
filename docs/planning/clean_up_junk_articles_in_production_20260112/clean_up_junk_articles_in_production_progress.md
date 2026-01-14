# Clean Up Junk Articles in Production Progress

## Research Phase (Complete)
### Work Done
1. Spawned 5 parallel agents to investigate:
   - Explanation data model and schema
   - Content generation pipeline
   - Quality/moderation systems
   - Pinecone vector integration
   - Database operations patterns

2. Identified 3 sources of junk articles:
   - **E2E Import Tests** (`import-articles.spec.ts`): Sends real content to LLM which generates unprefixed titles like "Understanding React Hooks in Modern Web Development"
   - **Integration Tests** (`tag-management.integration.test.ts`): Uses `Test Topic` and `Test Explanation` (wrong prefix pattern)
   - **Existing Production Content**: Legacy junk from before filtering was implemented

3. Key findings documented in research.md:
   - `[TEST]` and `test-` prefixes are filtered from display but data remains in DB
   - `deleteExplanation` does NOT automatically clean Pinecone vectors
   - Existing cleanup script at `scripts/cleanup-test-content.ts`
   - No minimum content length for generated content

### Reference
- Previous investigation: `docs/planning/clean_up_production_articles_investigation_20260110/`
- 1017 articles cleaned from production on 2026-01-10

## Planning Phase (Complete)
### Work Done
1. Created 5-phase execution plan in planning.md:
   - Phase 1: Fix integration tests (change `Test Topic` → `[TEST] Topic`)
   - Phase 2: Fix E2E import tests (enhance cleanup)
   - Phase 3: Production migration (one-time cleanup)
   - Phase 4: Enhance global teardown
   - Phase 5: Verify and document

2. Launched 3-agent critical review:
   - Security Agent: Flagged broad patterns as HIGH risk
   - Architecture Agent: Flagged patterns as dangerous
   - Testing Agent: Noted missing test coverage

### User Clarifications
**Q**: Review agents flagged `%react%` and `%bug%` patterns as too broad

**A**: "Currently we don't have any real users on prod yet. Let's do a one time delete matching those exact patterns."

### Resolution
- Updated planning.md to document this as ONE-TIME cleanup
- Added prominent warning that patterns are only safe because no real users exist
- Added justification comments in code sample

## Execution Phase 1: Fix Integration Tests (Complete)
### Work Done
Fixed 6 integration test files to use `[TEST] ` prefix convention:

| File | Changes | Lines Fixed |
|------|---------|-------------|
| `tag-management.integration.test.ts` | `Test Topic` → `[TEST] Topic`, `Test Explanation` → `[TEST] Explanation`, added prefix to tag names | 48, 58, 70 |
| `explanation-update.integration.test.ts` | `test-topic-` → `[TEST] topic-`, `test-explanation-` → `[TEST] explanation-` | 113, 125 |
| `metrics-aggregation.integration.test.ts` | `test-topic-` → `[TEST] topic-`, `test-explanation-` → `[TEST] explanation-` | 43, 54 |
| `auth-flow.integration.test.ts` | `test-topic-` → `[TEST] topic-`, `test-explanation-` → `[TEST] explanation-` | 10 instances |
| `explanation-generation.integration.test.ts` | `${testId}-existing-topic` → `[TEST] ${testId}-existing-topic`, etc. | 189, 202, 371, 531 |
| `import-articles.integration.test.ts` | `${testId}-xxx` → `${TEST_PREFIX}${testId}-xxx` for all 15 test cases | 92, 135, 154, 179, 201, 226, 241, 257, 270, 284, 299, 319, 347, 378, 379 |

### Additional Fix: import-articles.integration.test.ts (Session 2)
Discovered junk on staging like `1768161207452-9maxoavhy-existing-explanation` traced to `import-articles.integration.test.ts` which was NOT using the `[TEST]` prefix.

**Root Cause:** The file imported `TEST_PREFIX` but wasn't using it in title generation.

**Fixed patterns:**
- `${testId}-import-test-title` → `${TEST_PREFIX}${testId}-import-test-title`
- `${testId}-source-test-${source}` → `${TEST_PREFIX}${testId}-source-test-${source}`
- `${testId}-link-test` → `${TEST_PREFIX}${testId}-link-test`
- ... and 12 more similar patterns

### Verification
- ESLint: ✅ Passed (0 warnings)
- TypeScript: ✅ Passed (no errors)
- Integration tests: ✅ 131/132 passed (1 pre-existing failure unrelated to changes)

## Execution Phase 2: Create Cleanup Script (Complete)
### Work Done
Created `scripts/cleanup-specific-junk.ts` with:

**Junk Patterns (ILIKE):**
- `%react%` - Catches "Understanding React Hooks..." etc.
- `%bug%` - Catches "Software Bug 1767854660739" etc.
- `Test Topic %` - Catches integration test junk
- `Test Explanation %` - Catches integration test junk

**Junk Patterns (REGEX) - Added Session 2:**
- `^[0-9]{13}-[a-z0-9]{9,}-.*` - Catches timestamp-random test content like `1768161207452-9maxoavhy-existing-explanation`

**Protected Terms** (won't be deleted):
- `debugging`, `bugfix`, `bug report`, `bug tracking`

**How Pinecone Cleanup Works:**
1. Query Pinecone with dummy vector + `explanation_id` metadata filter
2. Get all matching vector IDs
3. Delete vectors in batches of 1000
4. Then delete Supabase records in FK order

**How Regex Matching Works:**
Since Supabase JS client doesn't support PostgreSQL `~` operator directly, we:
1. Query explanations starting with digits (`gte('0')`, `lte('9z')`)
2. Apply JavaScript regex filter client-side
3. This catches titles like `1768161207452-9maxoavhy-existing-explanation`

**Dev Database Test:**
- Found 264 junk explanations matching patterns
- Script successfully parses and runs

### Usage
```bash
# Preview what would be deleted
npx tsx scripts/cleanup-specific-junk.ts --dry-run

# Run on dev database
npx tsx scripts/cleanup-specific-junk.ts

# Run on production (15-second safety delay)
npx tsx scripts/cleanup-specific-junk.ts --prod
```

## Execution Phase 3: Database Cleanup (Dev Complete, Prod Pending)

### Dev Database Cleanup (Complete)
**Dry-run Results:**
- Initial dry-run found 264 junk explanations
- False positive identified: "Bug Tracking System" (ID: 8759)
- Added `bug tracking` to protected terms
- Re-ran dry-run: 263 items

**Cleanup Execution:**
```
📊 Summary:
   Explanations deleted: 263
   Vectors deleted: 261
   Errors: 0

✅ Cleanup complete!
```

**Verification:**
```
✅ No junk content found matching patterns. Database is clean!
```

### Environment Note
- Dev database: `ifubinffdbyewoezcidz` (configured in `.env.local`)
- Prod database: `qbxhivoezkfbjbsctdzo` (only on Vercel)
- The `--prod` flag adds a 15-second safety delay but does NOT switch databases
- To run on production, must update `.env.local` or run via Vercel

### Staging Cleanup (Pending)
Additional junk discovered on staging with timestamp-random format:
- Pattern: `1768161207452-9maxoavhy-existing-explanation`
- Source: `import-articles.integration.test.ts` (now fixed)
- Cleanup script updated with regex pattern to catch these

### Production Cleanup (Pending)
1. Switch environment to production/staging credentials
2. Run dry-run: `npx tsx scripts/cleanup-specific-junk.ts --dry-run --prod`
3. Review dry-run output (now includes timestamp-random patterns)
4. Execute cleanup: `npx tsx scripts/cleanup-specific-junk.ts --prod`
5. Verify and document results

## Execution Phase 4: Fix E2E Import Test (In Progress)

### Gap Identified
During verification audit on 2026-01-13, confirmed `import-articles.spec.ts` creates orphaned junk:

| Issue | Details |
|-------|---------|
| **LLM-generated titles** | Calls real OpenAI API, generates titles like "Understanding React Hooks" |
| **No [TEST] prefix** | Titles have no test marker |
| **Not in userLibrary** | `publishImportedArticle()` doesn't add to library junction table |
| **Global teardown fails** | Cleanup only finds explanations via userLibrary |
| **No per-test cleanup** | Test has no afterEach cleanup |

**Result:** Each CI run creates 2-3 orphaned explanations that persist.

### Fix Approach
Add per-test cleanup that captures explanation IDs from URL redirects and deletes them.

### Files to Modify
- `src/__tests__/e2e/specs/06-import/import-articles.spec.ts` - add afterEach cleanup
- `src/__tests__/e2e/helpers/test-data-factory.ts` - add deletion helper

### Implementation (Complete - Enhanced)

**Phase 1: Initial fix**
1. Added `deleteExplanationById()` helper to `test-data-factory.ts`:
   - Deletes Pinecone vectors for the explanation
   - Deletes from userLibrary, explanationMetrics, explanation_tags, link_candidates
   - Deletes the explanation itself

**Phase 2: Defense-in-depth auto-tracking system**
Added centralized tracking system that works across all Playwright workers:

1. **test-data-factory.ts** - New tracking functions:
   - `trackExplanationForCleanup(id)` - Registers ID to temp file `/tmp/e2e-tracked-explanation-ids.json`
   - `getTrackedExplanationIds()` - Reads all tracked IDs
   - `clearTrackedExplanationIds()` - Clears temp file
   - `cleanupAllTrackedExplanations()` - Cleans all tracked IDs and clears file

2. **createTestExplanation()** - Auto-tracks created explanations:
   - Calls `trackExplanationForCleanup(data.id)` automatically after creation
   - All tests using the factory now get automatic tracking

3. **import-articles.spec.ts** - Simplified:
   - Uses `trackExplanationForCleanup(explanationId)` instead of local array
   - Removed `afterEach` - cleanup handled by global teardown

4. **global-teardown.ts** - Defense-in-depth cleanup:
   - Calls `cleanupAllTrackedExplanations()` as Step 6
   - Catches any tracked explanations that weren't cleaned by other mechanisms

### How It Works
```
Test creates explanation → trackExplanationForCleanup(id) → writes to /tmp/e2e-tracked-*.json
                                                                      ↓
Global teardown → cleanupAllTrackedExplanations() → reads file → deletes each ID → clears file
```

This provides two layers of protection:
1. **[TEST] prefix filtering** - Prevents test content from appearing in discovery
2. **Auto-tracking cleanup** - Ensures orphaned content is deleted

## Execution Phase 5: Fix debug-publish-bug.spec.ts (Complete)

### Gap Identified (2026-01-13)
Found additional junk on production like "Bug Report 1768026914892" and "Bug tracking in software publishing". Investigation revealed:

| Test File | Issue |
|-----------|-------|
| `debug-publish-bug.spec.ts` | Creates real LLM-generated content via `publish bug test ${Date.now()}` query |

**Why this runs on production:**
- E2E nightly workflow runs ALL tests except `@skip-prod`
- This test is NOT tagged `@skip-prod`
- Creates content via real streaming, not mocks

### Fix Applied
1. Added `[TEST]` prefix to search query for easier detection
2. Added auto-tracking to ensure cleanup

**Changes to `src/__tests__/e2e/specs/debug-publish-bug.spec.ts`:**
```typescript
// Before:
const uniqueQuery = `publish bug test ${Date.now()}`;

// After:
import { TEST_CONTENT_PREFIX, trackExplanationForCleanup } from '../helpers/test-data-factory';
const uniqueQuery = `${TEST_CONTENT_PREFIX} publish bug test ${Date.now()}`;

// Added after explanation_id appears in URL:
const explanationId = url.searchParams.get('explanation_id');
if (explanationId) {
  trackExplanationForCleanup(explanationId);
}
```

### Verification
- ESLint: ✅ Passed
- TypeScript: ✅ Passed
- Build: ✅ Passed

## Production Cleanup (2026-01-13)

### Dev Database Cleanup
- Found 47 junk explanations (timestamp-random format)
- Deleted: 47 explanations, 1 vector

### Production Database Cleanup
- Found 53 junk explanations (React Hooks + Bug entries)
- Deleted: 53 explanations, 53 vectors

**Command used:**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://qbxhivoezkfbjbsctdzo.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<key> \
PINECONE_INDEX_NAME_ALL=explainanythingprodlarge \
npx tsx scripts/cleanup-specific-junk.ts --prod
```

## Execution Phase 6: Fix action-buttons.spec.ts (Complete)

### Gap Identified (2026-01-13)
Found 14 "Action Buttons Test" entries in production. Some with legacy `test-` prefix, others with `[TEST]` prefix. Investigation revealed:

| Test File | Issue |
|-----------|-------|
| `action-buttons.spec.ts` | Creates explanations via search queries without tracking |

**Problem queries:**
- `test query for save ${Date.now()}` → Creates untracked explanation
- `test disable save ${Date.now()}` → Creates untracked explanation

### Fix Applied
Same pattern as debug-publish-bug.spec.ts:
1. Added `[TEST]` prefix to search queries
2. Added `trackExplanationForCleanup()` after explanation creation

**Changes to `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts`:**
```typescript
// Added imports
import { TEST_CONTENT_PREFIX, trackExplanationForCleanup } from '../../helpers/test-data-factory';

// Updated queries (2 places)
const uniqueQuery = `${TEST_CONTENT_PREFIX} query for save ${Date.now()}`;

// Added tracking after streaming completes (2 places)
await authenticatedPage.waitForURL(/explanation_id=/, { timeout: 30000 });
const url = new URL(authenticatedPage.url());
const explanationId = url.searchParams.get('explanation_id');
if (explanationId) {
  trackExplanationForCleanup(explanationId);
}
```

### Additional Cleanup (2026-01-13)
Manually deleted remaining junk from production:
- 4 "Bug Report/tracking" entries (protected by `PROTECTED_TERMS`)
- 14 "Action Buttons Test" entries

**Production now clean:** ✅

---

## Final Summary

### All Phases Complete ✅

| Phase | Description | Status |
|-------|-------------|--------|
| Research | Identified 3 junk sources | ✅ Complete |
| Planning | Created 7-phase execution plan | ✅ Complete |
| Phase 1 | Fix integration tests (6 files) | ✅ Complete |
| Phase 2 | Create cleanup script | ✅ Complete |
| Phase 3 | Database cleanup (dev + prod) | ✅ Complete |
| Phase 4 | Fix E2E import test + auto-tracking | ✅ Complete |
| Phase 5 | Fix debug-publish-bug.spec.ts | ✅ Complete |
| Phase 6 | Fix action-buttons.spec.ts | ✅ Complete |

### Production Cleanup Summary

| Content Type | Count Deleted |
|--------------|---------------|
| React Hooks variants | 48 |
| Bug entries (script) | 5 |
| Bug Report/tracking (manual) | 4 |
| Action Buttons Test (manual) | 14 |
| **Total** | **71** |

### Defense-in-Depth Protection Layers

1. **[TEST] prefix filtering** - All 4 discovery paths filter `[TEST]%` content
2. **Auto-tracking system** - Factory functions register IDs to temp file
3. **Global teardown** - Cleans tracked IDs + pattern-matched content
4. **Cleanup script** - One-time/emergency cleanup tool available

### Files Modified

**Test Infrastructure:**
- `src/__tests__/e2e/helpers/test-data-factory.ts` - Auto-tracking system
- `src/__tests__/e2e/setup/global-teardown.ts` - Enhanced cleanup
- `src/__tests__/e2e/specs/debug-publish-bug.spec.ts` - [TEST] prefix + tracking
- `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` - [TEST] prefix + tracking
- `src/__tests__/e2e/specs/06-import/import-articles.spec.ts` - Tracking
- 6 integration test files - [TEST] prefix convention

**Scripts:**
- `scripts/cleanup-specific-junk.ts` - One-time cleanup tool

### Verification Command

```bash
# Check production for remaining junk
NEXT_PUBLIC_SUPABASE_URL=https://qbxhivoezkfbjbsctdzo.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<key> \
npx tsx -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function main() {
  const { data } = await supabase.from('explanations').select('id').or('explanation_title.ilike.[TEST]%,explanation_title.ilike.test-%');
  console.log('Test-prefixed remaining:', data?.length || 0);
}
main();
"
```

**Result:** `Test-prefixed remaining: 0` ✅
