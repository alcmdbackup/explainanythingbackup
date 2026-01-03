# Smoke Test Bypass Deployment Protection - Progress

## Overall Status: Planning Complete ✓

Research and planning phases are complete. Ready for execution.

---

## Phase 1: Create vercel-bypass.ts Utility

**Status**: Not started

### Work Done
- (pending)

### Issues Encountered
- (pending)

---

## Phase 2: Integrate into Global Setup

**Status**: Not started

### Work Done
- (pending)

### Issues Encountered
- (pending)

---

## Phase 3: Fix Auth Fixture

**Status**: Not started

### Work Done
- (pending)

### Issues Encountered
- (pending)

---

## Phase 4: Update GitHub Workflow

**Status**: Not started

### Work Done
- (pending)

### Issues Encountered
- (pending)

---

## Phase 5: Cleanup and Gitignore

**Status**: Not started

### Work Done
- (pending)

### Issues Encountered
- (pending)

---

## Planning Notes

### Research Completed
- Analyzed 5 reverted commits to understand why previous approaches failed
- Verified `redirect: 'manual'` approach via Vercel and MDN documentation
- Identified critical gap: Supabase cookie also needs dynamic domain fix
- Confirmed `getSetCookie()` (Node 18+) is correct API for parsing Set-Cookie headers
- Determined cookie names vary: `_vercel_jwt` or `__Host-vercel-bypass`

### User Clarifications
- User confirmed `VERCEL_AUTOMATION_BYPASS_SECRET` is already in GitHub secrets
- User wants to continue using production domain (which IS protected under Standard Protection)
- User confirmed: Skip bypass for `chromium-unauth` project (unauth tests don't need protected routes)

### Critical Gaps Addressed in Plan
1. Set-Cookie parsing - use `getSetCookie()` not `get('set-cookie')`
2. Cookie structure transformation - manual parsing documented
3. Supabase cookie domain fix - both cookies need dynamic domain
4. Error handling - warnings and fallbacks added
5. chromium-unauth project - decision to skip
