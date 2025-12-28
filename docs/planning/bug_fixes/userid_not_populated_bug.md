# Fix: Anonymous userId on Logged-In Pages

## Problem Summary

The log shows `userId: 'anonymous'` when creating embeddings on the `/results` page. This happens because:
1. API routes trust client-provided userId without server-side verification
2. Multiple fallbacks to 'anonymous' mask auth failures instead of surfacing them

## Root Cause

**Line 29 in `/src/app/api/returnExplanation/route.ts`:**
```typescript
userId: __requestId?.userId || userid || 'anonymous',
```

This falls back to 'anonymous' when auth state isn't properly passed, instead of failing with a clear error.

## Implementation Plan

### Step 1: Create Auth Validation Utility

**New file:** `/src/lib/utils/supabase/validateApiAuth.ts`

```typescript
import { createSupabaseServerClient } from './server';
import { logger } from '@/lib/server_utilities';

interface AuthResult {
  userId: string;
  sessionId: string;  // May be 'unknown' if client didn't provide
}

export async function validateApiAuth(
  clientRequestId?: { requestId?: string; userId?: string; sessionId?: string }
): Promise<{ data: AuthResult; error?: never } | { data?: never; error: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { error: 'User not authenticated' };
  }

  // Handle sessionId - warn if missing but proceed
  const sessionId = clientRequestId?.sessionId || 'unknown';
  if (sessionId === 'unknown') {
    logger.warn('Request missing sessionId', {
      userId: user.id,
      requestId: clientRequestId?.requestId
    });
  }

  return {
    data: {
      userId: user.id,
      sessionId
    }
  };
}
```

### Step 2: Update API Routes (All Routes)

**Routes requiring auth validation:**
- `/src/app/api/returnExplanation/route.ts` - Primary route causing the issue
- `/src/app/api/stream-chat/route.ts` - Chat streaming
- `/src/app/api/fetchSourceMetadata/route.ts` - Source fetching
- `/src/app/api/runAISuggestionsPipeline/route.ts` - AI suggestions (test route, but should validate)

**Routes to skip:**
- `/src/app/api/client-logs/route.ts` - Dev-only, already has env guard
- `/src/app/api/test-cases/route.ts` - Test infrastructure
- `/src/app/api/test-responses/route.ts` - Test infrastructure

**Change pattern for each route:**
```typescript
import { validateApiAuth } from '@/lib/utils/supabase/validateApiAuth';

export async function POST(request: NextRequest) {
  // 1. Parse request body first to get __requestId
  const { userInput, userid, __requestId, ... } = await request.json();

  // 2. Validate server-side auth (pass __requestId for sessionId validation)
  const authResult = await validateApiAuth(__requestId);
  if (authResult.error) {
    return NextResponse.json({
      error: 'Authentication required',
      redirectTo: '/login'
    }, { status: 401 });
  }

  // 3. Verify client-provided userId matches authenticated user
  if (userid && userid !== authResult.data.userId) {
    console.error(`UserId mismatch: client=${userid}, auth=${authResult.data.userId}`);
    return NextResponse.json({ error: 'Session mismatch' }, { status: 403 });
  }

  // 4. Use server-verified values
  const { userId: verifiedUserId, sessionId } = authResult.data;

  // 5. Set up RequestIdContext with verified values
  const requestIdData = {
    requestId: __requestId?.requestId || `api-${randomUUID()}`,
    userId: verifiedUserId,
    sessionId
  };

  return await RequestIdContext.run(requestIdData, async () => {
    // ... rest of route logic
  });
}
```

### Step 3: Remove 'anonymous' Fallbacks in Protected Contexts

**Files to update:**

1. `/src/app/api/returnExplanation/route.ts` line 29:
   ```typescript
   // FROM:
   userId: __requestId?.userId || userid || 'anonymous',
   // TO:
   userId: verifiedUserId,
   ```

2. `/src/app/api/stream-chat/route.ts` line 19:
   ```typescript
   // FROM:
   userId: __requestId?.userId || userid || 'anonymous',
   // TO:
   userId: verifiedUserId,
   ```

3. `/src/app/api/fetchSourceMetadata/route.ts` line 42:
   ```typescript
   // FROM:
   userId: userid || 'anonymous',
   // TO:
   userId: verifiedUserId,
   ```

### Step 4: Update Client-Side Error Handling

**File:** `/src/app/results/page.tsx`

Add handler for 401 responses to redirect to login:
```typescript
// In the fetch call error handling
if (response.status === 401) {
  const data = await response.json();
  if (data.redirectTo) {
    window.location.href = data.redirectTo;
    return;
  }
}
```

### Step 5: Fix Race Condition on Page Load

**File:** `/src/app/results/page.tsx`

The existing `useUserAuth` hook loads async. Need to ensure actions wait for auth:

```typescript
// Add auth loading state tracking
const [authLoaded, setAuthLoaded] = useState(false);

useEffect(() => {
  fetchUserid().then(() => setAuthLoaded(true));
}, []);

// In handleUserAction, add check:
if (!authLoaded) {
  dispatchLifecycle({ type: 'ERROR', error: 'Loading authentication...' });
  return;
}
```

## Files to Modify

| File | Action |
|------|--------|
| `/src/lib/utils/supabase/validateApiAuth.ts` | CREATE |
| `/src/app/api/returnExplanation/route.ts` | Add auth validation, remove 'anonymous' fallback |
| `/src/app/api/stream-chat/route.ts` | Add auth validation, remove 'anonymous' fallback |
| `/src/app/api/fetchSourceMetadata/route.ts` | Add auth validation, remove 'anonymous' fallback |
| `/src/app/api/runAISuggestionsPipeline/route.ts` | Add auth validation |
| `/src/app/results/page.tsx` | Add 401 redirect handling, auth loading state |

## Execution Order

1. Create `validateApiAuth.ts` utility
2. Update `/api/returnExplanation/route.ts` (main issue source)
3. Update `/api/stream-chat/route.ts`
4. Update `/api/fetchSourceMetadata/route.ts`
5. Update `/api/runAISuggestionsPipeline/route.ts`
6. Update `/src/app/results/page.tsx` client-side handling
7. Run tsc + build
8. Run existing tests
9. Manual test: login and trigger embedding creation

## Expected Outcome

- API routes return 401 + redirect info when auth fails
- No more 'anonymous' userId in logs for authenticated pages
- Clear error surfacing instead of silent fallbacks
- User redirected to login on session expiry
- Warnings logged when sessionId is missing (for debugging)
