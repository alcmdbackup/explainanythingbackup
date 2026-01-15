# Fix Broken Nightly E2E Tests Research

## Problem Statement
Nightly E2E tests have been failing consistently since January 11, 2026 (4 consecutive failures: Jan 11-14). The tests run against production (https://explainanything.vercel.app) at 6 AM UTC.

## High Level Summary

### Error Observed
A "Server Components render" error appears in the production DOM alongside normal page content:
```
An error occurred in the Server Components render. The specific message is omitted
in production builds to avoid leaking sensitive details. A digest property is
included on this error instance which may provide additional details about the
nature of the error.
```

### Key Observations
1. **Error appears IN the DOM** - Not replacing content, but as a sibling element alongside normal page content
2. **Intermittent** - Same pages sometimes show error, sometimes work fine
3. **Production only** - This is a Next.js production error message (dev would show full stack trace)
4. **Pages affected** - Draft explanations accessed via direct URL navigation
5. **Error location** - Inside `main > div > div > div[error]` with content as sibling

### Pages Showing Error (from nightly report)
- "Test Query Handling" - ref e28
- "Disabling Save Features in Software" - ref e28
- "Save 1768372780794" - ref e28 (timestamp-based test content)

### Console Errors Observed (from live testing)
- `[ERROR] Failed to load resource: the server responded with a status of 500`
- `[ERROR] Failed to track explanation loaded event: {error: An error occurred in the Server Components render...}`

### Root Cause - CONFIRMED

**Migration `20251216143228_fix_rls_warnings.sql` broke the stored procedures by setting `search_path = ''`.**

The migration contains:
```sql
-- 2. Fix function search paths (security definer functions should set search_path)
alter function public.refresh_explanation_metrics set search_path = '';
alter function public.refresh_all_explanation_metrics set search_path = '';
alter function public.increment_explanation_views set search_path = '';
alter function public.increment_explanation_saves set search_path = '';
```

**The problem:**
1. The comment says "security definer functions" but these are NOT `SECURITY DEFINER` - they use default `SECURITY INVOKER`
2. Setting `search_path = ''` on these functions breaks them because the function bodies use **unqualified table names** like `"explanationMetrics"` instead of `public."explanationMetrics"`
3. With empty search_path, PostgreSQL cannot find the tables

**Error flow:**
1. User visits a draft explanation page
2. `createUserExplanationEventAction` is called to track the view
3. It inserts an event, then calls `incrementExplanationViewsImpl`
4. `incrementExplanationViewsImpl` calls the stored procedure `increment_explanation_views`
5. The stored procedure fails because it can't find `"explanationMetrics"` with empty search_path
6. Error bubbles up and appears in DOM

**Timing correlation:**
- Migration file date: December 16, 2025
- Migration files all show modification date: "Jan 11 10:04"
- Nightly test failures started: January 11, 2026
- This strongly suggests the migration was deployed to production on January 11

## Solution

**Option A (Quick fix):** Remove the search_path setting from these non-SECURITY DEFINER functions
```sql
ALTER FUNCTION public.increment_explanation_views RESET search_path;
ALTER FUNCTION public.increment_explanation_saves RESET search_path;
ALTER FUNCTION public.refresh_explanation_metrics RESET search_path;
ALTER FUNCTION public.refresh_all_explanation_metrics RESET search_path;
```

**Option B (Proper fix):** Update function bodies to use fully qualified table names (more work but follows best practices)

**Recommendation:** Option A - it's a simpler fix and restores the original behavior.

## Documents Read
- `.github/workflows/e2e-nightly.yml` - Nightly E2E workflow config
- `docs/docs_overall/testing_overview.md` - Testing infrastructure docs
- Downloaded Playwright report from failed run #20984887528
- `supabase/migrations/20251216143228_fix_rls_warnings.sql` - **THE BREAKING MIGRATION**
- `supabase/migrations/20251109053825_fix_drift.sql` - Original function definitions

## Code Files Read
- `src/app/results/page.tsx` - Results page with Server Action calls
- `src/lib/services/metrics.ts` - Metrics tracking service with `incrementExplanationViewsImpl`
- `src/actions/actions.ts` - Server Actions definitions
- `src/lib/serverReadRequestId.ts` - Request ID context wrapper
- `src/lib/utils/supabase/server.ts` - Supabase client creation
- `src/app/error.tsx` - Error boundary (not source of this error)
- `src/components/Navigation.tsx` - Navigation component
- `src/hooks/useExplanationLoader.ts` - Explanation loading hook

## Next Steps
1. ✅ Root cause identified
2. Create migration to reset search_path on affected functions
3. Deploy migration to production
4. Verify nightly tests pass
