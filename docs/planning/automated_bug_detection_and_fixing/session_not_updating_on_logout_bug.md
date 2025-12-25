# Session ID Not Updating on Logout: Bug Investigation

> **Status**: Root Cause Identified
> **Last Updated**: 2024-12-24
> **Priority**: High - Breaks session tracking functionality

## Problem Statement

After implementing session_id tracking per `session_id_vs_request_id_research.md`, the session ID is not updating between logouts. The same session ID persists even after logout/login cycles.

---

## Root Cause Analysis

### The Bug: Server-Side SignOut Doesn't Trigger Client-Side Events

**The core issue**: When `signOut()` is called from a server action, it executes `supabase.auth.signOut()` on a **server-side Supabase client**, which:
1. Clears the server-side session cookies
2. Redirects to `/`
3. **Does NOT trigger `onAuthStateChange` events on the client-side browser Supabase client**

This is because the server and client Supabase clients are **completely separate instances** with no event bridging.

### Current Flow (Broken)

```
User clicks "Logout" (Navigation.tsx line 122)
    ↓
signOut() server action executes (app/login/actions.ts:134)
    ↓
Creates SERVER Supabase client (uses cookies, not localStorage)
    ↓
Calls supabase.auth.signOut() on SERVER client
    ↓
Server clears auth cookies and redirects to '/'
    ↓
Page loads at '/' with fresh React tree
    ↓
⚠️ CLIENT supabase_browser client initializes
    ↓
⚠️ Client's onAuthStateChange NEVER fires 'SIGNED_OUT' event
    ↓
⚠️ clearSession() in supabase.ts NEVER called
    ↓
⚠️ Hook's SIGNED_OUT handler NEVER called
    ↓
⚠️ Old session ID remains in localStorage!
```

### Why The Events Don't Fire

1. **Server and client are separate Supabase instances**:
   - Server client: `createServerClient()` uses cookies
   - Client client: `createBrowserClient()` uses localStorage
   - No communication between them

2. **Page navigation kills the old React tree**:
   - When `redirect('/')` happens, the entire React app unmounts
   - The `onAuthStateChange` subscription in `clientPassRequestId.ts` is destroyed
   - When the new page loads, a fresh subscription is created but the event already "happened" on the server

3. **Client doesn't know logout occurred**:
   - After redirect, client calls `getUser()` in `useAuthenticatedRequestId`'s useEffect
   - `getUser()` returns null because cookies are cleared
   - But this doesn't trigger `SIGNED_OUT` event - it's just a fetch that returns no user
   - The hook only sets `userId` to 'anonymous' via the SIGNED_OUT event handler, which never fires

### Evidence

Looking at `clientPassRequestId.ts:54-65`:
```typescript
useEffect(() => {
  async function fetchUser() {
    const { data } = await supabase_browser.auth.getUser();
    if (data?.user?.id) {
      // Only runs if user exists - never triggers logout logic
      const transition = await handleAuthTransition(data.user.id);
      setUserId(data.user.id);
      setSessionId(transition.sessionId);
    }
  }
  fetchUser();
  // ...
}, []);
```

**Critical bug**: If `getUser()` returns no user (logged out), the hook does nothing! The `else` branch is missing.

---

## What Happens In Each Scenario

### Same Account Login (Same Tab/Browser)

1. User logged out → old `auth-{hash}` session still in localStorage
2. User logs back in with same account
3. `handleAuthTransition(userId)` called
4. `deriveAuthSessionId(userId)` generates **same hash** (deterministic)
5. Since `anonSessionId === authSessionId`, no session linking happens
6. **Result**: Same session ID - appears correct but is actually stale

### Different Account Login (Same Tab/Browser)

1. User A logged out → old `auth-{hashA}` session still in localStorage
2. User B logs in
3. `handleAuthTransition(userIdB)` called
4. `deriveAuthSessionId(userIdB)` generates `auth-{hashB}`
5. But wait - localStorage has `auth-{hashA}`, not `sess-xxx`
6. `handleAuthTransition` checks if `anonSession` exists: **NO** (it was already cleared or never existed as anonymous)
7. Returns `auth-{hashB}` without linking
8. **Result**: Different session ID, but no linking to previous session

### Different Tab/Browser

1. Session is per-localStorage (per-browser)
2. Each browser maintains its own session
3. If User A logs out in Browser 1, Browser 2's session unaffected
4. **This is expected behavior** per the research doc design

---

## Why `clearSession()` Never Runs

Looking at `supabase.ts:22-40`:
```typescript
if (typeof window !== 'undefined') {
  supabase_browser.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      clearSession();  // <-- NEVER REACHED
    }
  });
}
```

This listener only fires for events that the **browser client observes**. Since signOut happens on the server, the browser client never sees a `SIGNED_OUT` event.

---

## The Missing Logic

### Current `fetchUser()` (Broken)
```typescript
async function fetchUser() {
  const { data } = await supabase_browser.auth.getUser();
  if (data?.user?.id) {
    const transition = await handleAuthTransition(data.user.id);
    setUserId(data.user.id);
    setSessionId(transition.sessionId);
  }
  // ❌ No else branch - logout case not handled!
}
```

### What Should Happen
```typescript
async function fetchUser() {
  const { data } = await supabase_browser.auth.getUser();
  if (data?.user?.id) {
    const transition = await handleAuthTransition(data.user.id);
    setUserId(data.user.id);
    setSessionId(transition.sessionId);
  } else {
    // ✅ Handle logged-out state
    clearSession();  // Clear any stale session from localStorage
    setUserId('anonymous');
    setSessionId(getOrCreateAnonymousSessionId());  // Fresh anonymous session
  }
}
```

---

## Supabase Auth Documentation Findings

### SignOut Scope (from Supabase docs)

| Scope | Behavior | SIGNED_OUT Event |
|-------|----------|------------------|
| `global` (default) | Terminates ALL sessions for user | Yes |
| `local` | Terminates current session only | Yes |
| `others` | Terminates all except current | **NO!** |

### Access Token Expiry Note

> "Access Tokens of revoked sessions remain valid until their expiry time. The user won't be immediately logged out and will only be logged out when the Access Token expires."

This explains why the client might still think it has a valid session briefly after server-side logout.

### Server vs Client Auth

The server-side `signOut()` clears:
- Server-side session cookies
- Server-side refresh tokens

The client-side `signOut()` clears:
- localStorage tokens
- Triggers `onAuthStateChange` events

**Our server action only does server-side logout.**

---

## Solutions

### Solution 1: Fix the `fetchUser()` Logic (Recommended)

Add `else` branch to handle logged-out state:

```typescript
// src/hooks/clientPassRequestId.ts

useEffect(() => {
  async function fetchUser() {
    const { data } = await supabase_browser.auth.getUser();
    if (data?.user?.id) {
      const transition = await handleAuthTransition(data.user.id);
      setUserId(data.user.id);
      setSessionId(transition.sessionId);
    } else {
      // User is not authenticated - ensure clean session state
      clearSession();  // Clear any stale auth session from localStorage
      setUserId('anonymous');
      setSessionId(getOrCreateAnonymousSessionId());
    }
  }
  fetchUser();
  // ... subscription code
}, []);
```

**Pros**:
- Simple fix
- Handles the case where page loads without auth
- Works with current server action pattern

**Cons**:
- Runs on every initial load (minor perf impact)

### Solution 2: Call Client SignOut Before Server Action

```typescript
// Navigation.tsx
<button
  onClick={async () => {
    await supabase_browser.auth.signOut();  // Client-side first
    await signOut();  // Then server action
  }}
>
  Logout
</button>
```

**Pros**:
- Triggers proper client-side events
- Clears localStorage immediately

**Cons**:
- Two network calls
- Race condition potential
- Requires changing Navigation to import supabase_browser

### Solution 3: Hybrid - Client SignOut Only

Since the server action primarily just redirects, we could do:

```typescript
// Navigation.tsx
<button
  onClick={async () => {
    await supabase_browser.auth.signOut();
    window.location.href = '/';  // Hard redirect
  }}
>
  Logout
</button>
```

**Pros**:
- Clean client-side event flow
- No server action needed

**Cons**:
- Hard redirect instead of Next.js navigation
- Need to ensure server-side session is also invalidated

### Solution 4: Add Manual Session Clear on Page Load

Check if we're in a "just logged out" state:

```typescript
// src/hooks/clientPassRequestId.ts

useEffect(() => {
  async function initSession() {
    // Check if there's a mismatch between localStorage session and auth state
    const { data } = await supabase_browser.auth.getUser();
    const storedSession = localStorage.getItem('ea_session');

    if (!data?.user?.id && storedSession) {
      // We have a stored session but no auth - user logged out
      const parsed = JSON.parse(storedSession);
      if (parsed.id.startsWith('auth-')) {
        // Was an auth session, now logged out - clear it
        clearSession();
      }
    }

    // ... rest of logic
  }
  initSession();
}, []);
```

---

## Recommended Fix

**Use Solution 1** with a small enhancement:

```typescript
// src/hooks/clientPassRequestId.ts

useEffect(() => {
  async function fetchUser() {
    const { data } = await supabase_browser.auth.getUser();
    if (data?.user?.id) {
      const transition = await handleAuthTransition(data.user.id);
      setUserId(data.user.id);
      setSessionId(transition.sessionId);
    } else {
      // Not authenticated - check if we need to clear stale auth session
      const storedSession = localStorage.getItem('ea_session');
      if (storedSession) {
        try {
          const parsed = JSON.parse(storedSession);
          if (parsed.id?.startsWith('auth-')) {
            // Had an auth session but now logged out - clear it
            clearSession();
          }
        } catch {
          // Invalid stored session, clear it
          clearSession();
        }
      }
      setUserId('anonymous');
      setSessionId(getOrCreateAnonymousSessionId());
    }
  }
  fetchUser();

  const { data: { subscription } } = supabase_browser.auth.onAuthStateChange(
    async (event, session) => {
      if (event === 'SIGNED_OUT') {
        clearSession();
        setUserId('anonymous');
        setSessionId(getOrCreateAnonymousSessionId());
      } else if (event === 'SIGNED_IN' && session?.user?.id) {
        const transition = await handleAuthTransition(session.user.id);
        setUserId(session.user.id);
        setSessionId(transition.sessionId);
      }
    }
  );

  return () => subscription.unsubscribe();
}, []);
```

This ensures:
1. On page load, if no user but stale auth session → cleared
2. On `SIGNED_OUT` event → cleared (for client-side signouts)
3. On `SIGNED_IN` event → proper transition handling

---

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/clientPassRequestId.ts` | Add else branch in `fetchUser()` to handle logged-out state |
| `src/lib/sessionId.ts` | Export `SESSION_KEY` constant for external access (optional) |

---

## Testing Checklist

- [ ] Logout → session clears from localStorage
- [ ] Logout → new anonymous session created on page load
- [ ] Login same account after logout → new session ID (not stale)
- [ ] Login different account after logout → new session ID + linking event
- [ ] Multi-tab: logout in tab 1 → tab 2 still has session until refresh
- [ ] Private/incognito mode works correctly

---

## Summary

| Question | Finding |
|----------|---------|
| Why doesn't sessionId reset on logout? | Server-side signOut doesn't trigger client-side `onAuthStateChange` events |
| What happens with same account? | Deterministic hash means same sessionId, but stale |
| What happens with different account? | New sessionId but no linking to stale session |
| Same vs different tab/browser? | Each browser has independent localStorage |
| Fix complexity | Low - add else branch in `fetchUser()` |
