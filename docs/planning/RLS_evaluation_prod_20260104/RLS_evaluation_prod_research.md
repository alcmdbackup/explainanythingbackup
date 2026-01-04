# RLS Evaluation Production - Research

## Problem Statement
Verify that Phase 1A RLS policy fixes from staging (migration `20260104062824_fix_user_table_rls.sql`) have been correctly applied to the production Supabase instance.

## High Level Summary
This is a verification task to confirm production RLS policies match the expected state after Phase 1A fixes were applied on staging.

## Production Environment
- **Supabase Project ID**: `qbxhivoezkfbjbsctdzo`
- **Dashboard**: https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo
- **Access Method**: Supabase Dashboard SQL Editor (read-only)

## Reference: Staging Work
- **Project folder**: `docs/planning/RLS_evaluation_20260103/`
- **GitHub Issue**: https://github.com/Minddojo/explainanything/issues/141
- **Migration applied**: `supabase/migrations/20260104062824_fix_user_table_rls.sql`

---

## Verification SQL Queries

Run these in the **Production** Supabase Dashboard SQL Editor:

### Query 1: Full Policy Overview
```sql
SELECT tablename, policyname, cmd, qual, with_check, roles::text[]
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('userLibrary', 'userQueries', 'userExplanationEvents')
ORDER BY tablename, policyname;
```

### Query 2: userExplanationEvents SELECT Policy
```sql
SELECT policyname, roles::text[], qual
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'userExplanationEvents'
AND cmd = 'SELECT';
```

**Expected**:
- Policy name: `Enable users to view their own events only`
- Roles: `{authenticated}`
- Qual: `((SELECT auth.uid() AS uid) = userid)`

**Not Expected** (indicates fix not applied):
- Roles containing `public`
- Qual = `true`

### Query 3: userLibrary INSERT Policy
```sql
SELECT policyname, with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'userLibrary'
AND cmd = 'INSERT';
```

**Expected**:
- Policy name: `Enable insert for own user only`
- with_check: `((SELECT auth.uid() AS uid) = userid)`

**Not Expected** (indicates fix not applied):
- Policy name: `Enable insert for authenticated users only`
- with_check: `true`

### Query 4: userQueries INSERT Policies
```sql
SELECT policyname, with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'userQueries'
AND cmd = 'INSERT';
```

**Expected**:
- Single policy: `Enable insert for users based on user_id`
- with_check: `(auth.uid() = userid)`

**Not Expected** (indicates fix not applied):
- Two INSERT policies (duplicate)
- Any policy with with_check = `true`

---

## Query Results

### Query 1 Results (Full Policy Overview)
*Run on 2026-01-04*

| tablename | policyname | cmd | qual | with_check | roles |
|-----------|------------|-----|------|------------|-------|
| userExplanationEvents | Enable insert for authenticated users only | INSERT | null | true | ["authenticated"] |
| userExplanationEvents | Enable insert for users based on user_id | INSERT | null | ((SELECT auth.uid()) = userid) | ["authenticated"] |
| userExplanationEvents | Enable read access for all users | SELECT | true | null | ["public"] |
| userLibrary | Enable insert for authenticated users only | INSERT | null | true | ["authenticated"] |
| userLibrary | Enable users to view their own data only | SELECT | ((SELECT auth.uid()) = userid) | null | ["authenticated"] |
| userQueries | Enable insert for authenticated users only | INSERT | null | true | ["authenticated"] |
| userQueries | Enable insert for users based on user_id | INSERT | null | ((SELECT auth.uid()) = userid) | ["authenticated"] |
| userQueries | Enable users to view their own data only | SELECT | ((SELECT auth.uid()) = userid) | null | ["authenticated"] |

---

## Analysis

### Comparison: Expected vs Actual

| Table | Policy | Expected | Actual | Match? |
|-------|--------|----------|--------|--------|
| userExplanationEvents | SELECT | `auth.uid() = userid` for authenticated | `true` for public | ❌ NO |
| userExplanationEvents | INSERT | Single user-isolated policy | 2 policies (1 permissive) | ❌ NO |
| userLibrary | INSERT | `auth.uid() = userid` | `true` (permissive) | ❌ NO |
| userQueries | INSERT | Single policy with user check | 2 policies (1 permissive) | ❌ NO |

### Discrepancies Found

**Phase 1A migration was NOT applied to production.**

#### Issue 1: userExplanationEvents - Public Read Still Exists
- **Current**: `Enable read access for all users` with `qual=true` for `public` role
- **Risk**: Any anonymous user can read all user events (views, saves, etc.)
- **Fix needed**: Drop public policy, create authenticated user-isolated policy

#### Issue 2: userExplanationEvents - Duplicate INSERT Policies
- **Current**: Two INSERT policies exist
- **Risk**: Permissive `true` policy makes user check meaningless
- **Fix needed**: Drop permissive INSERT policy

#### Issue 3: userLibrary - Permissive INSERT
- **Current**: `Enable insert for authenticated users only` with `with_check=true`
- **Risk**: Any authenticated user can add items to any user's library
- **Fix needed**: Replace with user-isolated INSERT policy

#### Issue 4: userQueries - Duplicate INSERT Policies
- **Current**: Two INSERT policies (one permissive with `true`)
- **Risk**: Any authenticated user can insert queries for any user
- **Fix needed**: Drop permissive INSERT policy

---

## Post-Fix Verification (2026-01-04)

After applying migrations via `supabase db push` and manual fix:

| tablename | policyname | cmd | qual | with_check | roles |
|-----------|------------|-----|------|------------|-------|
| userExplanationEvents | Enable insert for users based on user_id | INSERT | null | ((SELECT auth.uid()) = userid) | ["authenticated"] |
| userExplanationEvents | Enable users to view their own events only | SELECT | ((SELECT auth.uid()) = userid) | null | ["authenticated"] |
| userLibrary | Enable insert for own user only | INSERT | null | ((SELECT auth.uid()) = userid) | ["authenticated"] |
| userLibrary | Enable users to view their own data only | SELECT | ((SELECT auth.uid()) = userid) | null | ["authenticated"] |
| userQueries | Enable insert for users based on user_id | INSERT | null | ((SELECT auth.uid()) = userid) | ["authenticated"] |
| userQueries | Enable users to view their own data only | SELECT | ((SELECT auth.uid()) = userid) | null | ["authenticated"] |

**All policies now correctly configured** - 6 policies total, all user-isolated with `auth.uid() = userid`.

---

## Documents Read
- `docs/planning/RLS_evaluation_20260103/RLS_evaluation_planning.md`
- `docs/planning/RLS_evaluation_20260103/RLS_evaluation_progress.md`
- `docs/docs_overall/environments.md`
- `supabase/migrations/20260104062824_fix_user_table_rls.sql`

## Code Files Read
- `src/__tests__/integration/rls-policies.integration.test.ts`
