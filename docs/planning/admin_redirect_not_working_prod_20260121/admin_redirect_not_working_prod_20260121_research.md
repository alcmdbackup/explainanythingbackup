# Admin Redirect Not Working Prod Research

## Problem Statement
Admin users cannot access `/admin` on production (`explainanything.vercel.app`). When navigating to `/admin`, they are redirected to the home page (`/`) instead of seeing the admin dashboard.

## High Level Summary

**Root Cause**: The user `abecha@gmail.com` is not in the `admin_users` table on the **Production** Supabase database (`qbxhivoezkfbjbsctdzo`), but IS in the **Dev** database (`ifubinffdbyewoezcidz`).

**Why E2E tests didn't catch this**:
1. CI and nightly E2E tests run against the Dev database where the user IS an admin
2. The "non-admin redirect" test was explicitly skipped (commit `879b72d`) because the test user is an admin in Dev
3. Post-deploy smoke tests run against production but don't have admin test credentials configured (`TEST_USER_EMAIL`/`TEST_USER_PASSWORD` not in Production environment secrets)

## Technical Analysis

### Admin Authentication Flow
1. `src/app/admin/layout.tsx` calls `isUserAdmin()` from `adminAuth.ts`
2. `isUserAdmin()` checks the `admin_users` table for a record matching the user's ID
3. If no record exists, returns `false` → layout redirects to `/`
4. The code works correctly - the issue is missing data in production

### Environment Configuration
| Environment | Supabase Project | User in admin_users? |
|-------------|------------------|---------------------|
| Dev/Preview | `ifubinffdbyewoezcidz` | YES |
| Production | `qbxhivoezkfbjbsctdzo` | NO |

### Testing Gap Analysis
| Test Type | Runs Against | Admin Test Status |
|-----------|--------------|-------------------|
| CI E2E | Dev DB (local build) | Pass (user is admin) |
| Nightly E2E | Dev DB (local build) | Pass (user is admin) |
| Post-deploy smoke | Prod DB (live) | Skipped (no admin credentials) |

## Documents Read
- `docs/docs_overall/environments.md` - Environment configuration showing Dev vs Prod databases
- `docs/docs_overall/architecture.md` - System design and data flow
- `docs/docs_overall/project_workflow.md` - Project workflow documentation

## Code Files Read
- `src/app/admin/layout.tsx` - Admin layout with redirect logic (lines 16-19)
- `src/lib/services/adminAuth.ts` - `isUserAdmin()` function checking admin_users table
- `src/middleware.ts` - General auth middleware (doesn't block admin specifically)
- `src/lib/utils/supabase/middleware.ts` - Session handling and disabled user checks
- `src/__tests__/e2e/specs/09-admin/admin-auth.spec.ts` - Admin E2E tests
- `src/__tests__/e2e/fixtures/admin-auth.ts` - Admin test fixtures

## Commit History
- `879b72d` - "fix(e2e): skip admin redirect test - no non-admin test user" - This commit skipped the non-admin redirect test because `abecha@gmail.com` is an admin in Dev/staging
