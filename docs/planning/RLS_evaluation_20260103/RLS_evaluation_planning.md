# RLS Evaluation Planning

## Background
Row-Level Security (RLS) is a critical security feature in Supabase/PostgreSQL that controls which rows users can access based on policies. Proper RLS configuration ensures data isolation between users and prevents unauthorized access.

## Problem
We need to verify that all RLS policies on the staging Supabase instance are correctly configured, don't have security gaps, and align with the application's access control requirements.

## Issues Found

### 🔴 Critical Issues

#### 1. Overly Permissive Admin Tables (DEFERRED)
The following tables allow ANY authenticated user to perform full CRUD operations:
- `link_whitelist`, `link_whitelist_aliases`, `link_whitelist_snapshot`
- `link_candidates`, `candidate_occurrences`
- `article_heading_links`, `article_link_overrides`
- `testing_edits_pipeline`

**Status**: Deferred for later implementation. Requires code changes to migrate services to `createSupabaseServiceClient()` before policies can be locked down.

#### 2. userExplanationEvents Publicly Readable
```sql
-- Current policy
SELECT qual FROM pg_policies WHERE tablename = 'userExplanationEvents' AND cmd = 'SELECT';
-- Returns: "true" for role "public"
```

**Risk**: Any anonymous user can read all user events (views, saves, etc.), which could leak user behavior patterns.

**Recommendation**: Make user-isolated (users can only see their own events). Public metrics like view counts should come from `explanationMetrics` table, which already exists and aggregates counts without exposing individual user data.

### 🟡 Medium Issues

#### 3. llmCallTracking Missing SELECT Policy
Users can INSERT but cannot read their own LLM call history.

**Impact**: Users can't view their usage/history if that feature is needed.

**Recommendation**: Add user-isolated SELECT if users should see their history, or document this is intentional (backend-only table).

#### 4. userQueries Has Duplicate INSERT Policies
```sql
-- Two INSERT policies exist:
"Enable insert for authenticated users only" -- with_check: "true"
"Enable insert for users based on user_id"   -- with_check: "(auth.uid() = userid)"
```

**Impact**: The permissive "true" policy makes the user_id check redundant. Any authenticated user can insert with any userid value.

**Recommendation**: Remove the overly permissive policy, keep only the user-isolated one.

#### 5. userLibrary Missing INSERT User Check
```sql
-- Current INSERT policy
with_check: "true"  -- allows any authenticated user to insert
```

**Risk**: User A could potentially add items to User B's library if they know User B's userid.

**Recommendation**: Add `(auth.uid() = userid)` check on INSERT.

### 🟢 Properly Configured Tables

#### Content Tables (Public Read is Intentional)
- `explanations` - ✅ Public read for SEO, auth write
- `topics` - ✅ Public read for SEO, auth insert
- `tags` - ✅ Public read, auth insert
- `explanation_tags` - ✅ Public read, auth insert
- `explanationMetrics` - ✅ Public read, auth insert

#### User-Isolated Tables
- `userLibrary` - ✅ SELECT properly isolated by userid (INSERT needs fix)
- `userQueries` - ✅ SELECT properly isolated by userid (INSERT has duplicate)

### 🔧 Non-RLS Security Issues (from Supabase Advisor)

1. **Function search_path mutable**: `increment_explanation_views`
   - ✅ Already fixed in migration `20251216143228_fix_rls_warnings.sql`

2. **Auth OTP expiry >1 hour**: Reduce to 60 minutes max
   - [Remediation docs](https://supabase.com/docs/guides/platform/going-into-prod#security)

3. **Leaked password protection disabled**: Enable in Auth settings
   - [Remediation docs](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

4. **Postgres version outdated**: Upgrade to get security patches
   - [Remediation docs](https://supabase.com/docs/guides/platform/upgrading)

## Pre-Execution Verification

Before running migrations, execute these verification steps:

### 1. Policy Name Verification
Run this query on staging to verify actual policy names match the DROP statements:

```sql
-- Verify policy names match exactly before running migrations
SELECT tablename, policyname, cmd, roles::text[]
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('userLibrary', 'userQueries', 'userExplanationEvents')
ORDER BY tablename, policyname;
```

**If policy names don't match the DROP statements:**
1. Update the migration SQL to use the actual policy names from the query result
2. `DROP POLICY IF EXISTS` silently succeeds if policy doesn't exist - this is dangerous
3. To verify DROP actually removed something, run the query again after migration
4. If policies remain after DROP, the names don't match - update and re-run

### 2. Column Verification
Verify required columns exist:

```sql
-- Confirm userid column exists on user tables
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name IN ('userLibrary', 'userQueries', 'userExplanationEvents')
AND column_name = 'userid';
```

## Execution Plan

### Phase 1A: Fix User Table RLS Issues (Safe - No Breaking Changes)
**Migration file**: `supabase/migrations/YYYYMMDDHHMMSS_fix_user_table_rls.sql`

Note: Use actual timestamp when creating file (format: `YYYYMMDDHHMMSS`).

```sql
-- Phase 1A: Fix user table RLS policies
-- This migration is safe and doesn't require code changes

BEGIN;

-- 1A.1 Fix userLibrary INSERT policy
-- Drop permissive INSERT policy
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public."userLibrary";

-- Create user-isolated INSERT policy
CREATE POLICY "Enable insert for own user only" ON public."userLibrary"
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = userid);

-- 1A.2 Fix userQueries duplicate INSERT policies
-- Drop the overly permissive INSERT policy (keep the user-isolated one)
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public."userQueries";
-- "Enable insert for users based on user_id" remains with proper check

-- 1A.3 Fix userExplanationEvents public visibility
-- Decision: Make user-isolated (users can only see their own events)
-- Drop public SELECT policy
DROP POLICY IF EXISTS "Enable read access for all users" ON public."userExplanationEvents";

-- Create user-isolated SELECT policy
CREATE POLICY "Enable users to view their own events only" ON public."userExplanationEvents"
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = userid);

COMMIT;
```

**Note**: Transaction wrapping ensures all-or-nothing application of policy changes.

### Phase 2: Fix Medium Issues
**Migration file**: `supabase/migrations/YYYYMMDDHHMMSS_fix_rls_medium_issues.sql`

#### 2.1 llmCallTracking - Document as backend-only

**Decision**: This table is intentionally backend-only. Users should not read their LLM call history directly (contains internal prompts/responses). No SELECT policy needed.

```sql
-- No changes needed - document this is intentional
-- Add comment for clarity
COMMENT ON TABLE public."llmCallTracking" IS 'Backend-only table for LLM usage tracking. No client SELECT access by design.';
```

### Phase 3: Dashboard Settings (not migrations)
These are Supabase Dashboard settings, not SQL migrations:

1. **OTP expiry**: Auth > Email > OTP Expiry → Set to 3600 seconds (1 hour)
2. **Leaked password protection**: Auth > Providers > Email → Enable "Leaked password protection"
3. **Postgres upgrade**: Settings > Infrastructure → Schedule upgrade

## Files Modified

### Migrations (new files)
- `supabase/migrations/YYYYMMDDHHMMSS_fix_user_table_rls.sql` - Phase 1A: user table fixes
- `supabase/migrations/YYYYMMDDHHMMSS_fix_rls_medium_issues.sql` - Phase 2: comments

### Tests (new files - must be created before execution)
- `src/__tests__/integration/rls-policies.integration.test.ts` - RLS policy verification tests

## Testing Plan

### Integration Tests

**File**: `src/__tests__/integration/rls-policies.integration.test.ts`

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createTestSupabaseClient, TEST_PREFIX } from '@/testing/utils/integration-helpers';

/**
 * Creates an anonymous Supabase client (uses anon key, no session)
 * This tests RLS policies for unauthenticated users
 */
function createAnonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing required environment variables');
  }

  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

describe('RLS Policies', () => {
  // Service role for setup/cleanup (bypasses RLS)
  let serviceClient: SupabaseClient;

  // Anonymous client (no auth - tests public access)
  let anonClient: SupabaseClient;

  beforeAll(async () => {
    serviceClient = createTestSupabaseClient();
    anonClient = createAnonClient();
  });

  describe('Anonymous user (anon key, no session)', () => {
    it('can read public explanations', async () => {
      const { data, error } = await anonClient.from('explanations').select('id').limit(1);
      expect(error).toBeNull();
      expect(data?.length).toBeGreaterThan(0);
    });

    it('cannot read user events after Phase 1A', async () => {
      const { data } = await anonClient.from('userExplanationEvents').select('id');
      // After Phase 1A: should return empty (no public access)
      expect(data?.length).toBe(0);
    });
  });

  describe('Service role (backend)', () => {
    it('has full access to user tables', async () => {
      const { error: eventsError } = await serviceClient.from('userExplanationEvents').select('id');
      expect(eventsError).toBeNull();
    });
  });
});
```

### Manual Verification Checklist

Before deploying to production:

**Phase 1A Verification**:
- [ ] Log in as test user on staging
- [ ] Save explanation to library → should succeed
- [ ] View library → should only show own items
- [ ] Try creating userQuery with different userid via API → should fail

**SQL Verification in Supabase Dashboard**:
```sql
-- Run in SQL Editor to verify policies
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('userLibrary', 'userQueries', 'userExplanationEvents')
ORDER BY tablename, policyname;
```

## Rollback Plan

### Phase 1A Rollback

```sql
-- Only run if Phase 1A causes issues

-- Restore userLibrary permissive INSERT
DROP POLICY IF EXISTS "Enable insert for own user only" ON public."userLibrary";
CREATE POLICY "Enable insert for authenticated users only" ON public."userLibrary"
  FOR INSERT TO authenticated WITH CHECK (true);

-- Restore userQueries duplicate (if needed)
CREATE POLICY "Enable insert for authenticated users only" ON public."userQueries"
  FOR INSERT TO authenticated WITH CHECK (true);

-- Restore userExplanationEvents public access
DROP POLICY IF EXISTS "Enable users to view their own events only" ON public."userExplanationEvents";
CREATE POLICY "Enable read access for all users" ON public."userExplanationEvents"
  FOR SELECT TO public USING (true);
```

### Emergency rollback steps:
1. Identify failing functionality from Supabase logs or user reports
2. Apply the rollback SQL via Supabase Dashboard SQL Editor
3. Investigate root cause before re-applying fixes

## Summary of Changes

| Phase | Table | Before | After |
|-------|-------|--------|-------|
| 1A | userExplanationEvents | Public read | User-isolated read |
| 1A | userLibrary | Permissive INSERT | User-isolated INSERT |
| 1A | userQueries | Duplicate INSERT policies | Single user-isolated INSERT |
| 2 | llmCallTracking | No SELECT | Documented as intentional |

## Execution Order

1. **Run pre-execution verification queries** - Confirm policy names and columns
2. **Deploy Phase 1A migration** - Safe, no code changes needed
3. **Verify on staging** - Run manual verification checklist
4. **Deploy Phase 2 migration** - Add table comment
5. **Update Supabase Dashboard settings** - OTP, password protection

## Deferred Work

### Admin Table Lockdown (Future)
The following is deferred for later implementation:
- Migrate `linkWhitelist.ts`, `linkCandidates.ts`, `linkResolver.ts`, `testingPipeline.ts` to use `createSupabaseServiceClient()`
- Lock down admin tables after code changes are deployed
- See GitHub issue #141 for tracking
