# Fix Broken Nightly E2E Tests Plan

## Background
Nightly E2E tests have been failing consistently since January 11, 2026 (4 consecutive failures). The tests run against production at 6 AM UTC. The failure manifests as a "Server Components render" error appearing in the DOM alongside normal page content when viewing draft explanations.

## Problem
Migration `20251216143228_fix_rls_warnings.sql` incorrectly set `search_path = ''` on stored procedure functions that are NOT `SECURITY DEFINER`. These functions use unqualified table names like `"explanationMetrics"`, and with an empty search_path, PostgreSQL cannot resolve these table references. This causes the `increment_explanation_views` function to fail when tracking explanation view events.

## Root Cause
The original migration comment stated "security definer functions should set search_path" but the functions are actually `SECURITY INVOKER` (the default). Setting search_path on SECURITY INVOKER functions causes them to use the explicitly set search_path instead of inheriting from the session, breaking table resolution.

## Solution
Create a new migration that resets the search_path on all affected functions:
- `increment_explanation_views`
- `increment_explanation_saves`
- `refresh_explanation_metrics`
- `refresh_all_explanation_metrics`

## Implementation

### Migration Created
File: `supabase/migrations/20260114121410_fix_metrics_function_search_path.sql`

```sql
ALTER FUNCTION public.increment_explanation_views RESET search_path;
ALTER FUNCTION public.increment_explanation_saves RESET search_path;
ALTER FUNCTION public.refresh_explanation_metrics RESET search_path;
ALTER FUNCTION public.refresh_all_explanation_metrics RESET search_path;
```

## Testing
1. Deploy migration to production
2. Monitor next nightly E2E run (6 AM UTC)
3. Verify no more "Server Components render" errors in DOM

## Verification Steps
- [ ] Migration deployed to production
- [ ] Next nightly test passes (Jan 15)
- [ ] No 500 errors in console when viewing draft explanations
