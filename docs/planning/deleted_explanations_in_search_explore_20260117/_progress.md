# Deleted Explanations in Search Explore Progress

## Milestone 1: Fix the Bug (Immediate)

### Phase 1.1: Filter Explore Queries
- [x] Add `is_hidden` filter to 'new' sort query in `explanations.ts`
- [x] Add `is_hidden` filter to 'top' sort query in `explanations.ts`

### Phase 1.2: Delete Vectors on Hide
- [x] Import `deleteVectorsByExplanationId` in `adminContent.ts`
- [x] Add vector deletion to `_hideExplanationAction`

### Phase 1.3: Re-create Vectors on Restore
- [x] Import `processContentToStoreEmbedding` in `adminContent.ts`
- [x] Add vector re-creation to `_restoreExplanationAction`

### Phase 1.4: Update Bulk Hide
- [x] Add vector deletion to `_bulkHideExplanationsAction`

### Phase 1.5: Cleanup Existing Hidden Content
- [x] Create `scripts/cleanup-hidden-vectors.ts`
- [ ] Run cleanup script (deferred to production deployment)

### Milestone 1 Testing
- [x] Unit test: `is_hidden` filter applied (tests updated and passing)
- [ ] Unit test: vector deletion on hide (adminContent.test.ts has pre-existing env var issue)
- [ ] Unit test: vector re-creation on restore
- [ ] Manual: hide → disappears from /explore
- [ ] Manual: search for hidden → no results
- [ ] Manual: restore → reappears

### Issues Encountered
- Test mocks needed to be updated to include `.or()` method in Supabase query chain
- adminContent.test.ts fails due to pre-existing issue with vectorsim.ts import (env vars)

---

## Milestone 2: Add New Schema

### Phase 2.1: Migration - Add Columns
- [x] Create migration file (`20260117173000_add_delete_status.sql`)
- [x] Add `delete_status` and related columns
- [x] Add indexes (`idx_explanations_delete_status`, `idx_explanations_delete_status_changed_at`)
- [x] Backfill from `is_hidden`
- [x] Add check constraints for valid enum values

### Milestone 2 Testing
- [ ] Migration runs without errors (pending deployment)
- [ ] Data backfilled correctly
- [ ] App still works (no code changes yet)

### Issues Encountered
None so far - migration created successfully

---

## Milestone 3: Migrate Code

### Phase 3.1: Update Query Filters
- [x] Replace `is_hidden` filter with `delete_status` in `explanations.ts` (both 'new' and 'top' sort)

### Phase 3.2: Update Admin Actions
- [x] Update `hideExplanationAction` to use `delete_status`
- [x] Add `delete_reason`, `delete_source` optional parameters
- [x] Update `restoreExplanationAction`
- [x] Update `bulkHideExplanationsAction`
- [x] Keep `is_hidden` for backwards compatibility until RLS migration deployed

### Phase 3.3: Update RLS Policy
- [x] Create migration `20260117174000_update_rls_delete_status.sql`

### Phase 3.4: Update Admin UI
- [ ] Display new fields in admin panel (deferred - optional enhancement)

### Milestone 3 Testing
- [x] All queries use `delete_status`
- [x] Admin actions set new fields
- [x] RLS policy migration created
- [ ] Full lifecycle test passes (pending deployment)

### Issues Encountered
- Tests needed updating to mock `.eq()` chain instead of `.or()` chain

---

## Milestone 4: Drop Old Columns

### Phase 4.1: Migration - Drop Columns
- [ ] Create migration to drop `is_hidden`, `hidden_at`, `hidden_by`
- [ ] Verify no code references old columns

### Milestone 4 Testing
- [ ] App works without old columns
- [ ] No references to `is_hidden` in codebase

### Issues Encountered
[To be filled during execution]

---

## Milestone 5: Advanced Features

### Phase 5.1: Cron Jobs
- [ ] Create `deletionJobs.ts`
- [ ] Implement deletion promoter (hidden → deleted after 30d)
- [ ] Implement purge job (deleted → hard delete after 90d)

### Phase 5.2: Moderation Queue UI
- [ ] Create `/admin/moderation` page
- [ ] List pending reviews
- [ ] Add bulk actions

### Milestone 5 Testing
- [ ] Cron jobs work correctly
- [ ] Legal hold prevents progression
- [ ] Moderation queue UI works

### Issues Encountered
[To be filled during execution]

---

## Final Verification (per milestone)
- [ ] Run lint
- [ ] Run tsc
- [ ] Run build
- [ ] Run unit tests
- [ ] Run integration tests
- [ ] Run e2e tests
