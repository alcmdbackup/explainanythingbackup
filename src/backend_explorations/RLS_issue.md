# RLS (Row Level Security) Investigation - userExplanationEvents

**Date:** 2025-11-12
**Status:** Critical server-side authentication issue discovered

## Problem Statement

After enabling RLS on `userExplanationEvents` table in Supabase, events stopped saving when users view explanations.

## Investigation Findings

### 1. Immediate Issue - Fixed ✅

**Location:** `src/app/results/page.tsx:685`

**Problem:** Insufficient auth checking allowed anonymous users to attempt event creation.

```typescript
// BEFORE (buggy):
if (effectiveUserid) {
    await createUserExplanationEventAction({...});
}

// AFTER (fixed):
if (effectiveUserid && effectiveUserid !== 'anonymous' && effectiveUserid.length > 0) {
    await createUserExplanationEventAction({...});
}
```

**Why this was needed:**
- JavaScript truthy check passes for empty strings and 'anonymous'
- RLS policies require `authenticated` role
- Anonymous users should not create events per business requirements

### 2. Critical Server-Side Auth Issue Discovered ❌

**Symptom:** Even authenticated users cannot create events.

**Root Cause:** Server-side authentication is completely broken.

**Evidence from logs:**
```json
// Client-side (works correctly):
{"message": "User authenticated successfully: 6bb207e0-ec32-4a92-a166-c6a3494930c5"}

// Server-side (broken - ALL requests show anonymous):
{"userId": "anonymous"}
{"userId": "anonymous"}
{"userId": "anonymous"}
```

**Impact:**
- Client knows user is authenticated
- Server actions see ALL requests as anonymous
- RLS policies correctly block anonymous users
- Result: Even authenticated users cannot insert events

### 3. Authentication Flow Analysis

**Client → Server Flow:**
1. User logs in via `/login` page
2. `useUserAuth()` hook fetches user → `userid: "6bb207e0-ec32-4a92-a166-c6a3494930c5"`
3. Browser stores session successfully
4. Client-side checks pass ✅

**Server Action Flow:**
1. `createUserExplanationEventAction()` called from client
2. Uses `createSupabaseServerClient()` from `/src/lib/utils/supabase/server.ts`
3. Server client should read auth cookies
4. **FAILS:** Server sees `auth.uid() = NULL` (anonymous)
5. RLS policy blocks insert ✅ (correct behavior, wrong context)

### 4. RLS Policies on userExplanationEvents

From `/supabase/migrations/20251109053825_fix_drift.sql` lines 916-930:

```sql
-- Policy 1: Authenticated users only
CREATE POLICY "Enable insert for authenticated users only"
ON "public"."userExplanationEvents"
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy 2: User ID must match
CREATE POLICY "Enable insert for users based on user_id"
ON "public"."userExplanationEvents"
FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.uid() AS uid) = userid);
```

**Policy Status:** ✅ RLS is now ENABLED (as of 2025-11-12)
**Policy Logic:** ✅ Correct - should block anonymous users
**Policy Enforcement:** ✅ Working correctly
**Problem:** ❌ Server thinks all users are anonymous

## Testing Results

### Test 1: Anonymous User
- **Status:** ✅ PASS
- **Expected:** Should NOT create events
- **Actual:** No events created (blocked by client-side check)
- **Browser redirects:** `/results?explanation_id=1` → `/login?explanation_id=1`

### Test 2: Authenticated User
- **Status:** ❌ FAIL
- **Expected:** Should create events
- **Actual:** Client shows authenticated, but server-side fails
- **Console Error:** "Failed to track explanation loaded event"
- **Server Error:** 500 Internal Server Error
- **Root Cause:** Server sees user as anonymous

### Test 3: Server Logs
- **Status:** ❌ CRITICAL ISSUE
- **Finding:** ALL `userId` values in server.log show `"anonymous"`
- **Time Range Checked:** 2025-11-12T03:11:* to 2025-11-12T03:28:*
- **Operations Affected:** returnExplanation, generateNewExplanation, saveExplanationAndTopic, ALL server actions

## Root Cause Analysis

### The Chain of Failure

```
User logs in successfully
    ↓
Client-side auth works (useUserAuth shows real userid)
    ↓
User navigates to /results?explanation_id=1
    ↓
processParams() calls loadExplanation()
    ↓
Tries to create event via createUserExplanationEventAction()
    ↓
Server action uses createSupabaseServerClient()
    ↓
Server client FAILS to read auth session from cookies
    ↓
auth.uid() returns NULL
    ↓
RLS sees user as anonymous
    ↓
RLS policies correctly block insert
    ↓
Event creation fails with 500 error
```

### Suspected Issues

**File:** `/src/lib/utils/supabase/server.ts`

Potential problems:
1. Cookie configuration mismatch between client and server
2. Session not being persisted to cookies
3. Server client not reading cookies correctly
4. Cookie domain/path issues
5. Middleware not forwarding cookies properly

## Action Items

### Immediate (P0)
1. ❌ **Debug `createSupabaseServerClient()`**
   - Check cookie reading logic
   - Verify session extraction
   - Test auth.getUser() vs auth.getSession()

2. ❌ **Check cookie configuration**
   - Compare client vs server cookie settings
   - Verify cookie names match
   - Check domain/path/sameSite settings

3. ❌ **Review middleware**
   - Ensure auth cookies forwarded to server actions
   - Check if middleware strips auth headers

### Testing Needed
1. ❌ Add logging to server client creation
2. ❌ Log auth.getSession() in server actions
3. ❌ Verify cookies present in server action requests
4. ❌ Test if getUserId() works in server actions

### Code Fixed (Completed)
1. ✅ `src/app/results/page.tsx:685` - Added proper auth check
2. ✅ Linting passed
3. ✅ Type checking shows unrelated test errors (pre-existing)

## Files Involved

### Client-Side (Working)
- `/src/hooks/useUserAuth.ts` - Client auth hook ✅
- `/src/app/login/page.tsx` - Login UI ✅
- `/src/app/results/page.tsx:685` - Event trigger (FIXED) ✅

### Server-Side (Broken)
- `/src/lib/utils/supabase/server.ts` - Server client creation ❌
- `/src/actions/actions.ts:419` - createUserExplanationEventAction wrapper ❌
- `/src/lib/services/metrics.ts:38-79` - createUserExplanationEvent service ❌

### Database
- `userExplanationEvents` table - RLS enabled ✅
- RLS policies - Correctly configured ✅

## Business Rules Confirmed

**From user:** "There should be no user events for anonymous users. If there are, there is a bug. Everything should be logged in."

**RLS Policies:** ✅ Aligned with business rules
**Client Code:** ✅ Fixed to align with business rules
**Server Auth:** ❌ BROKEN - needs urgent fix

## References

- Previous investigation: This file (2025-11-11)
- Migration file: `/supabase/migrations/20251109053825_fix_drift.sql`
- Supabase Server Client Guide: https://supabase.com/docs/guides/auth/server-side
- Next.js Cookie Handling: https://nextjs.org/docs/app/api-reference/functions/cookies
