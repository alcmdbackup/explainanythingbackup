# Deleted Explanations in Search Explore Research

## Problem Statement
Soft-deleted (hidden) explanations with `is_hidden=true` are still appearing in the explore page (`/explanations`) and can appear in search results.

## High Level Summary
The issue has two root causes:
1. **Explore page**: `getRecentExplanationsImpl()` filters by `status='published'` but doesn't filter by `is_hidden`
2. **Search results**: When an explanation is hidden via admin panel, its Pinecone vectors are not deleted, so it still appears in vector similarity search

## Documents Read
- `docs/docs_overall/architecture.md` - System design, data flow, search pipeline
- `docs/docs_overall/getting_started.md` - Documentation structure
- `docs/docs_overall/project_workflow.md` - Project workflow requirements
- `docs/feature_deep_dives/admin_panel.md` - Admin panel (placeholder)
- `docs/planning/create_admin_site_20260114/` - Admin site implementation history

## Code Files Read

### Soft Delete Implementation
- `supabase/migrations/20260115081312_add_explanations_is_hidden.sql` - Defines `is_hidden`, `hidden_at`, `hidden_by` columns and RLS policy
- `src/lib/services/adminContent.ts` - `hideExplanationAction()` (lines 128-173), `restoreExplanationAction()` (lines 179-224), `bulkHideExplanationsAction()` (lines 230-302)

### Explore Page
- `src/app/explanations/page.tsx` - Server component that calls `getRecentExplanations()`
- `src/lib/services/explanations.ts` - `getRecentExplanationsImpl()` (lines 114-218)
- `src/components/explore/ExploreGalleryPage.tsx` - Client component displaying results

### Search/Vector Pipeline
- `src/lib/services/vectorsim.ts` - `searchForSimilarVectorsImpl()` (lines 275-359), `deleteVectorsByExplanationIdImpl()` (lines 682-740)
- `src/lib/services/findMatches.ts` - `enhanceMatchesWithCurrentContentAndDiversityImpl()` (lines 220-300)
- `src/lib/services/returnExplanation.ts` - `returnExplanationLogic()` orchestration

## Key Findings

### 1. Database Schema
The `explanations` table has soft-delete support via:
- `is_hidden` BOOLEAN (DEFAULT FALSE)
- `hidden_at` TIMESTAMPTZ (nullable)
- `hidden_by` UUID FK to auth.users (nullable)

### 2. RLS Policy
```sql
CREATE POLICY "explanations_select_policy" ON explanations FOR SELECT USING (
  is_hidden = FALSE OR is_hidden IS NULL
  OR EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
);
```
This protects end users but server-side queries may bypass it.

### 3. Explore Page Gap
`getRecentExplanationsImpl()` at line 138 and 194 only filters:
```typescript
.eq('status', 'published')
```
Missing: `.or('is_hidden.eq.false,is_hidden.is.null')`

### 4. Vector Lifecycle Gap
- `hideExplanationAction()` sets `is_hidden=true` but doesn't delete Pinecone vectors
- `restoreExplanationAction()` sets `is_hidden=false` but doesn't re-create vectors
- `deleteVectorsByExplanationId()` exists and is exported but never called

### 5. Existing Infrastructure
The codebase already has:
- `deleteVectorsByExplanationId()` function ready to use
- `processContentToStoreEmbedding()` for re-creating vectors
- Graceful handling of inaccessible explanations in `findMatches.ts`
