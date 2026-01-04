# RLS Evaluation Production - Planning

## Background
Phase 1A RLS policy fixes were developed, tested, and applied to the staging Supabase instance (`ifubinffdbyewoezcidz`) via migration `20260104062824_fix_user_table_rls.sql`. This project verifies those same fixes are present on the production Supabase instance (`qbxhivoezkfbjbsctdzo`).

## Problem
We need to confirm that production RLS policies match the expected state after Phase 1A fixes. If discrepancies exist, we need to identify them and plan remediation.

## Options Considered

1. **Dashboard SQL Verification** (Selected)
   - Run read-only queries in Supabase Dashboard SQL Editor
   - Safest approach - no risk of accidental changes
   - Direct visibility into actual policy state

2. **Script-based verification**
   - Would require production service role key locally
   - More complex setup, higher risk

3. **Trust migration ran correctly**
   - No verification
   - Risk of undetected issues

## Verification Checklist

### Pre-Verification
- [ ] Access production Supabase dashboard
- [ ] Navigate to SQL Editor
- [ ] Confirm connected to production project (`qbxhivoezkfbjbsctdzo`)

### Policy Verification

#### userExplanationEvents
- [ ] Run Query 2 from research doc
- [ ] Confirm SELECT policy exists for `authenticated` role only
- [ ] Confirm qual contains `auth.uid() = userid`
- [ ] Confirm NO policy exists for `public` role

#### userLibrary
- [ ] Run Query 3 from research doc
- [ ] Confirm INSERT policy name is `Enable insert for own user only`
- [ ] Confirm with_check contains `auth.uid() = userid`
- [ ] Confirm NO policy with with_check = `true`

#### userQueries
- [ ] Run Query 4 from research doc
- [ ] Confirm only ONE INSERT policy exists
- [ ] Confirm policy has user-based check
- [ ] Confirm NO duplicate permissive INSERT policy

### Post-Verification
- [ ] Document all results in research file
- [ ] Update progress file with findings
- [ ] If all pass: close project as verified
- [ ] If failures: create remediation plan

## Expected Policy State (Phase 1A Applied)

### userExplanationEvents
| cmd | policyname | roles | qual |
|-----|------------|-------|------|
| SELECT | Enable users to view their own events only | {authenticated} | ((SELECT auth.uid()) = userid) |
| INSERT | Enable insert for authenticated users only | {authenticated} | - |

### userLibrary
| cmd | policyname | roles | with_check |
|-----|------------|-------|------------|
| SELECT | Enable select for users based on user_id | {authenticated} | - |
| INSERT | Enable insert for own user only | {authenticated} | ((SELECT auth.uid()) = userid) |

### userQueries
| cmd | policyname | roles | with_check |
|-----|------------|-------|------------|
| SELECT | Enable select for users based on user_id | {authenticated} | - |
| INSERT | Enable insert for users based on user_id | {authenticated} | (auth.uid() = userid) |

## Remediation Plan - REQUIRED

**Status**: Phase 1A was NOT applied to production. All 4 issues need fixing.

### Remediation SQL (Run in Production SQL Editor)

```sql
-- ============================================
-- PRODUCTION RLS FIX - Phase 1A
-- Run in Supabase Dashboard SQL Editor
-- Project: qbxhivoezkfbjbsctdzo (Production)
-- ============================================

BEGIN;

-- ============================================
-- Fix 1: userExplanationEvents SELECT
-- Remove public read, add user-isolated read
-- ============================================
DROP POLICY IF EXISTS "Enable read access for all users" ON public."userExplanationEvents";

CREATE POLICY "Enable users to view their own events only" ON public."userExplanationEvents"
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = userid);

-- ============================================
-- Fix 2: userExplanationEvents INSERT
-- Remove permissive INSERT (keep user-isolated)
-- ============================================
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public."userExplanationEvents";
-- "Enable insert for users based on user_id" remains with proper check

-- ============================================
-- Fix 3: userLibrary INSERT
-- Replace permissive INSERT with user-isolated
-- ============================================
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public."userLibrary";

CREATE POLICY "Enable insert for own user only" ON public."userLibrary"
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = userid);

-- ============================================
-- Fix 4: userQueries INSERT
-- Remove permissive INSERT (keep user-isolated)
-- ============================================
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public."userQueries";
-- "Enable insert for users based on user_id" remains with proper check

COMMIT;
```

### Post-Remediation Verification Query

After running the fix, run this to confirm:

```sql
SELECT tablename, policyname, cmd, qual, with_check, roles::text[]
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('userLibrary', 'userQueries', 'userExplanationEvents')
ORDER BY tablename, policyname;
```

**Expected result after fix**:
- userExplanationEvents: 2 policies (1 SELECT for authenticated, 1 INSERT with user check)
- userLibrary: 2 policies (1 SELECT with user check, 1 INSERT with user check)
- userQueries: 2 policies (1 SELECT with user check, 1 INSERT with user check)
- NO policies with `qual=true` or `with_check=true`
- NO policies for `public` role

## Testing (Post-Remediation Only)

If remediation is needed, verify with:
1. Re-run verification queries - all should match expected
2. Test on production (carefully):
   - Login as test user
   - Save to library → should work
   - View library → should only show own items

## Supabase CLI Setup for Production

### Step 1: Link to Production Project

```bash
# Link to production (will create .supabase/linked.toml)
supabase link --project-ref qbxhivoezkfbjbsctdzo

# You'll be prompted for the database password
# Get it from: Supabase Dashboard > Project Settings > Database > Connection string
```

### Step 2: Check Migration Status

```bash
# See which migrations have been applied to production
supabase migration list
```

### Step 3: Push Migrations to Production

```bash
# Apply all pending migrations
supabase db push

# Or dry-run first to see what will be applied
supabase db push --dry-run
```

## GitHub Integration Setup

### Required GitHub Secrets

Add these to your repository secrets (Settings > Secrets > Actions):

| Secret | How to Get |
|--------|------------|
| `SUPABASE_ACCESS_TOKEN` | Supabase Dashboard > Account > Access Tokens |
| `SUPABASE_DB_PASSWORD_STAGING` | Project Settings > Database > Password (Dev project) |
| `SUPABASE_DB_PASSWORD_PROD` | Project Settings > Database > Password (Prod project) |

### GitHub Workflow File

Create `.github/workflows/supabase-migrations.yml`:

```yaml
name: Deploy Supabase Migrations

on:
  push:
    branches:
      - main
    paths:
      - 'supabase/migrations/**'

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: Development
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Link to staging
        run: supabase link --project-ref ifubinffdbyewoezcidz
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD_STAGING }}

      - name: Push migrations to staging
        run: supabase db push
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD_STAGING }}

  deploy-production:
    runs-on: ubuntu-latest
    environment: Production
    needs: deploy-staging  # Only after staging succeeds
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Link to production
        run: supabase link --project-ref qbxhivoezkfbjbsctdzo
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD_PROD }}

      - name: Push migrations to production
        run: supabase db push
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD_PROD }}
```

## Files Modified

### This Project
- `docs/planning/RLS_evaluation_prod_20260104/RLS_evaluation_prod_research.md`
- `docs/planning/RLS_evaluation_prod_20260104/RLS_evaluation_prod_planning.md`
- `docs/planning/RLS_evaluation_prod_20260104/RLS_evaluation_prod_progress.md`

### New Files (for GitHub Integration)
- `.github/workflows/supabase-migrations.yml` - Auto-deploy migrations

### No Code Changes Expected
This is a verification project. Code changes only needed if discrepancies are found.
