# Fix Broken Nightly E2E Tests Progress

## Phase 1: Investigation
### Work Done
- Analyzed nightly E2E test failures from Jan 11-14, 2026
- Examined Playwright report page snapshots showing error at ref=e28
- Traced error to `createUserExplanationEventAction` Server Action
- Identified the Server Action calling `incrementExplanationViewsImpl`
- Found root cause in migration `20251216143228_fix_rls_warnings.sql`

### Root Cause Identified
Migration incorrectly set `search_path = ''` on stored procedure functions that:
1. Are NOT `SECURITY DEFINER` (they use default `SECURITY INVOKER`)
2. Use unqualified table names like `"explanationMetrics"`

With empty search_path, PostgreSQL cannot resolve table names, causing function failures.

### Issues Encountered
- Error appeared intermittently in DOM alongside normal content
- Error message was sanitized (Next.js production mode)
- Had to trace through multiple layers: Server Action → metrics service → stored procedure → migration

## Phase 2: Fix Implementation
### Work Done
- Created migration: `supabase/migrations/20260114121410_fix_metrics_function_search_path.sql`
- Resets search_path on all 4 affected functions using `ALTER FUNCTION ... RESET search_path`
- Verified PostgreSQL syntax against official documentation
- Updated research and planning documents

### Migration Contents
```sql
ALTER FUNCTION public.increment_explanation_views RESET search_path;
ALTER FUNCTION public.increment_explanation_saves RESET search_path;
ALTER FUNCTION public.refresh_explanation_metrics RESET search_path;
ALTER FUNCTION public.refresh_all_explanation_metrics RESET search_path;
```

## Phase 3: Deployment (Pending)
### Next Steps
1. Push changes to repository
2. Deploy migration to production Supabase
3. Verify next nightly E2E test passes (Jan 15, 2026 at 6 AM UTC)

### Verification Checklist
- [ ] Migration pushed to repo
- [ ] Migration deployed to production
- [ ] Next nightly test passes
- [ ] No console 500 errors on draft explanation pages
