# Deleted Explanations in Search Explore Plan

## Background

The admin panel allows soft-deleting explanations by setting `is_hidden=true`. However, hidden explanations still appear in explore page and search results because:
1. Query filters don't exclude `is_hidden` content
2. Pinecone vectors aren't deleted when content is hidden

After brainstorming, we're implementing a **Two-Stage Soft Delete** system, but doing it incrementally: fix the bug first, then migrate to the full system.

**See:** [two_stage_delete_design.md](./two_stage_delete_design.md) for full design.

## Execution Strategy

```
Milestone 1: Fix the Bug (using existing is_hidden)
    ↓
Milestone 2: Add New Schema (alongside is_hidden)
    ↓
Milestone 3: Migrate Code (to delete_status)
    ↓
Milestone 4: Drop Old Columns (clean break)
    ↓
Milestone 5: Advanced Features (cron jobs, moderation queue)
```

---

## Milestone 1: Fix the Bug (Immediate)

**Goal:** Hidden content stops appearing in explore/search. Uses existing `is_hidden` field.

### Phase 1.1: Filter Explore Queries

**File:** `src/lib/services/explanations.ts`

Add `is_hidden` filter to BOTH query paths in `getRecentExplanationsImpl()`:

```typescript
// 'new' sort query (in the if (sort === 'new') block, after .eq('status', 'published'))
.eq('status', 'published')
.or('is_hidden.eq.false,is_hidden.is.null')  // ADD THIS

// 'top' sort query (in the else block where we fetch all published explanations)
// Around line 191-196 where we query for explanations to map view counts
.eq('status', 'published')
.or('is_hidden.eq.false,is_hidden.is.null')  // ADD THIS
```

**Note:** Both paths MUST be updated. The 'top' sort fetches all published explanations and sorts client-side by view count - without the filter, hidden content would appear in top rankings.

### Phase 1.2: Delete Vectors on Hide

**File:** `src/lib/services/adminContent.ts`

```typescript
import { deleteVectorsByExplanationId } from '@/lib/services/vectorsim';

// In _hideExplanationAction, after DB update succeeds (after logger.info):
try {
  const deletedCount = await deleteVectorsByExplanationId(explanationId);
  logger.info('Deleted vectors for hidden explanation', { explanationId, deletedCount });
} catch (vectorError) {
  logger.error('Failed to delete vectors', { explanationId, error: vectorError });
  // Note: We continue despite vector deletion failure - RLS will still protect
  // the content, and cleanup script can fix any orphaned vectors
}
```

**Atomicity Note:** There's a brief window between DB update and vector deletion where:
- DB says hidden, but vectors still exist in Pinecone
- `findMatches.ts:238-247` already handles this gracefully by catching RLS errors
- This is acceptable for Milestone 1; full consistency addressed in later milestones

### Phase 1.3: Re-create Vectors on Restore

**File:** `src/lib/services/adminContent.ts`

```typescript
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';

// In _restoreExplanationAction, after DB update succeeds (after logger.info):
try {
  const { data: explanation } = await supabase
    .from('explanations')
    .select('id, explanation_title, content, primary_topic_id')
    .eq('id', explanationId)
    .single();

  if (explanation) {
    const combinedContent = `# ${explanation.explanation_title}\n\n${explanation.content}`;
    // processContentToStoreEmbedding(markdown, explanation_id, topic_id, debug?, namespace?)
    // topic_id can be null - the function handles this
    await processContentToStoreEmbedding(
      combinedContent,
      explanation.id,
      explanation.primary_topic_id ?? 0  // Default to 0 if null
    );
    logger.info('Re-created vectors for restored explanation', { explanationId });
  }
} catch (vectorError) {
  logger.error('Failed to re-create vectors', { explanationId, error: vectorError });
  // Note: Content is visible but not searchable until vectors are created
  // Admin can re-run restore or wait for manual intervention
}
```

### Phase 1.4: Update Bulk Hide

**File:** `src/lib/services/adminContent.ts`

```typescript
// In _bulkHideExplanationsAction, after DB update succeeds:
// Delete vectors in parallel, log failures but don't block
await Promise.all(explanationIds.map(id =>
  deleteVectorsByExplanationId(id).catch(err =>
    logger.error('Failed to delete vectors in bulk hide', { id, error: err })
  )
));
```

### Phase 1.5: Cleanup Existing Hidden Content

**File:** `scripts/cleanup-hidden-vectors.ts`

```typescript
/**
 * One-time script to delete Pinecone vectors for already-hidden explanations.
 *
 * Usage:
 *   DRY_RUN=true npx tsx scripts/cleanup-hidden-vectors.ts  # Preview only
 *   npx tsx scripts/cleanup-hidden-vectors.ts                # Execute
 */
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { deleteVectorsByExplanationId } from '@/lib/services/vectorsim';

const DRY_RUN = process.env.DRY_RUN === 'true';

async function cleanupHiddenVectors() {
  const supabase = await createSupabaseServiceClient();

  const { data: hidden, error } = await supabase
    .from('explanations')
    .select('id, explanation_title')
    .eq('is_hidden', true);

  if (error) throw error;

  console.log(`Found ${hidden?.length || 0} hidden explanations`);

  if (DRY_RUN) {
    console.log('DRY RUN - would delete vectors for:', hidden?.map(e => e.id));
    return;
  }

  for (const exp of hidden || []) {
    try {
      const count = await deleteVectorsByExplanationId(exp.id);
      console.log(`Deleted ${count} vectors for explanation ${exp.id}: ${exp.explanation_title}`);
    } catch (err) {
      console.error(`Failed to delete vectors for ${exp.id}:`, err);
    }
  }
}

cleanupHiddenVectors();
```

### Milestone 1 Testing

**Unit Tests:**
- **File:** `src/lib/services/explanations.test.ts`
  - [ ] Test `getRecentExplanations` with 'new' sort excludes `is_hidden=true` records
  - [ ] Test `getRecentExplanations` with 'top' sort excludes `is_hidden=true` records

- **File:** `src/lib/services/adminContent.test.ts`
  - [ ] Test `hideExplanationAction` calls `deleteVectorsByExplanationId`
  - [ ] Test `restoreExplanationAction` calls `processContentToStoreEmbedding`
  - [ ] Test `bulkHideExplanationsAction` calls `deleteVectorsByExplanationId` for each ID

- **File:** `src/lib/services/vectorsim.test.ts`
  - [ ] Test `deleteVectorsByExplanationId` queries and deletes correct vectors
  - [ ] Test `deleteVectorsByExplanationId` handles no vectors found gracefully

**Integration Tests:**
- **File:** `src/__tests__/integration/hide-restore.integration.test.ts` (new)
  - [ ] Test full lifecycle: create → hide → verify not in explore → restore → verify in explore
  - [ ] Test vectors are deleted on hide, recreated on restore

**E2E Tests:**
- **File:** `e2e/explore-hidden-content.spec.ts` (new)
  - [ ] Test hidden explanation doesn't appear on /explore page
  - [ ] Test hidden explanation returns 404 on direct URL access

**Manual Verification:**
1. Hide explanation via admin → verify disappears from /explore (both 'new' and 'top' tabs)
2. Search for hidden content title → verify no results
3. Restore explanation → verify reappears in /explore and search

**Rollback Plan:**
- If vector deletion breaks: Revert adminContent.ts changes, run cleanup script later
- If query filter breaks explore: Revert explanations.ts changes (single line removal)

**Commit after Milestone 1** - Bug is fixed.

---

## Milestone 2: Add New Schema

**Goal:** Add `delete_status` and related columns alongside `is_hidden` (non-breaking).

### Phase 2.1: Migration - Add Columns

**File:** `supabase/migrations/YYYYMMDD_add_delete_status.sql`

```sql
-- Add new columns (non-breaking, is_hidden still works)
ALTER TABLE explanations ADD COLUMN delete_status TEXT DEFAULT 'visible';
ALTER TABLE explanations ADD COLUMN delete_status_changed_at TIMESTAMPTZ;
ALTER TABLE explanations ADD COLUMN delete_reason TEXT;
ALTER TABLE explanations ADD COLUMN delete_source TEXT DEFAULT 'manual';
ALTER TABLE explanations ADD COLUMN moderation_reviewed BOOLEAN DEFAULT FALSE;
ALTER TABLE explanations ADD COLUMN moderation_reviewed_by UUID REFERENCES auth.users;
ALTER TABLE explanations ADD COLUMN moderation_reviewed_at TIMESTAMPTZ;
ALTER TABLE explanations ADD COLUMN legal_hold BOOLEAN DEFAULT FALSE;

-- Indexes
CREATE INDEX idx_explanations_delete_status ON explanations(delete_status);
CREATE INDEX idx_explanations_delete_status_changed_at ON explanations(delete_status_changed_at);

-- Backfill from is_hidden (set NULL for delete_status_changed_at on visible content)
UPDATE explanations SET
  delete_status = CASE WHEN is_hidden = true THEN 'hidden' ELSE 'visible' END,
  delete_status_changed_at = CASE WHEN is_hidden = true THEN COALESCE(hidden_at, NOW()) ELSE NULL END,
  delete_source = 'manual',
  moderation_reviewed = CASE WHEN is_hidden = true THEN true ELSE false END;
```

### Milestone 2 Testing

- **File:** Run migration locally via `supabase db reset`
  - [ ] Migration runs without errors
  - [ ] Hidden content has `delete_status = 'hidden'`
  - [ ] Visible content has `delete_status = 'visible'`
  - [ ] Indexes created successfully
- **Manual:** App still works (no code changes yet, still using `is_hidden`)

**Commit after Milestone 2** - Schema ready.

---

## Milestone 3: Migrate Code

**Goal:** Update all code to use `delete_status` instead of `is_hidden`.

### Phase 3.1: Update Query Filters

**File:** `src/lib/services/explanations.ts`

```typescript
// Replace is_hidden filter with delete_status in BOTH query paths
.eq('status', 'published')
.eq('delete_status', 'visible')
```

### Phase 3.2: Update Admin Actions

**File:** `src/lib/services/adminContent.ts`

- Update `hideExplanationAction` to set `delete_status = 'hidden'`, `delete_status_changed_at = NOW()`
- Add optional parameters for `delete_reason`, `delete_source`
- Update `restoreExplanationAction` to set `delete_status = 'visible'`, clear `delete_status_changed_at`
- Update `bulkHideExplanationsAction` similarly
- Keep vector deletion/recreation logic from Milestone 1

### Phase 3.3: Update RLS Policy

**File:** `supabase/migrations/YYYYMMDD_update_rls_delete_status.sql`

```sql
-- Note: admin_users table has RLS allowing users to read their own row
-- The EXISTS check works because it only needs to find ONE matching row
DROP POLICY IF EXISTS "explanations_select_policy" ON explanations;

CREATE POLICY "explanations_select_policy" ON explanations FOR SELECT USING (
  delete_status = 'visible'
  OR EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
);
```

### Phase 3.4: Update Admin UI

**File:** `src/app/admin/` components

- Update to display `delete_status`, `delete_reason`, `delete_source`
- Show `delete_status_changed_at` for audit

### Milestone 3 Testing

- **File:** `src/lib/services/explanations.test.ts`
  - [ ] Update tests to use `delete_status` instead of `is_hidden`
- **File:** `src/lib/services/adminContent.test.ts`
  - [ ] Update tests to verify `delete_status` fields set correctly
- **File:** `src/__tests__/integration/rls-policies.integration.test.ts`
  - [ ] Test non-admin cannot see `delete_status != 'visible'` content
  - [ ] Test admin CAN see hidden content
- **Manual:** Full lifecycle test with new fields

**Commit after Milestone 3** - Code migrated.

---

## Milestone 4: Drop Old Columns

**Goal:** Clean break from `is_hidden`.

### Phase 4.1: Migration - Drop Columns

**File:** `supabase/migrations/YYYYMMDD_drop_is_hidden.sql`

```sql
-- Verify no code references is_hidden before running!
ALTER TABLE explanations DROP COLUMN IF EXISTS is_hidden;
ALTER TABLE explanations DROP COLUMN IF EXISTS hidden_at;
ALTER TABLE explanations DROP COLUMN IF EXISTS hidden_by;

-- Drop old index if exists
DROP INDEX IF EXISTS idx_explanations_is_hidden;
```

### Milestone 4 Testing

- **Bash:** `grep -r "is_hidden" src/ --include="*.ts" --include="*.tsx"` returns no matches
- **Manual:** App works without old columns
- [ ] All existing tests pass

**Commit after Milestone 4** - Clean break complete.

---

## Milestone 5: Advanced Features

**Goal:** Add automated moderation support.

### Phase 5.1: Cron Jobs

**File:** `src/lib/services/deletionJobs.ts`

```typescript
// Deletion Promoter - runs daily via Vercel cron or external scheduler
// Promotes: hidden → deleted after 30 days (if moderation_reviewed OR delete_source != 'automated')

// Purge Job - runs daily
// Purges: deleted → hard DELETE after 90 days (if legal_hold = false)
```

### Phase 5.2: Moderation Queue UI

**File:** `src/app/admin/moderation/page.tsx`

- List pending reviews (automated flags needing human review)
- Show countdown to auto-promotion
- Bulk actions: confirm delete, restore, legal hold

### Milestone 5 Testing

- **File:** `src/lib/services/deletionJobs.test.ts` (new)
  - [ ] Test promoter promotes after 30 days
  - [ ] Test promoter skips unreviewed automated flags
  - [ ] Test purge job deletes after 90 days
  - [ ] Test legal hold prevents purge
- **E2E:** `e2e/admin-moderation.spec.ts` (new)
  - [ ] Test moderation queue displays correctly
  - [ ] Test bulk actions work

**Commit after Milestone 5** - Full system complete.

---

## Summary

| Milestone | Goal | Risk | Dependencies |
|-----------|------|------|--------------|
| 1 | Fix bug | Low | None |
| 2 | Add schema | Low | M1 |
| 3 | Migrate code | Medium | M2 |
| 4 | Drop old columns | Low | M3 |
| 5 | Advanced features | Medium | M4 |

## Documentation Updates

- `docs/feature_deep_dives/admin_panel.md` - Document two-stage delete system
