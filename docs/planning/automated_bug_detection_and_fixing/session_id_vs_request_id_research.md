# Session ID vs Request ID: Research Document

> **Status**: Ready for Implementation
> **Last Updated**: 2024-12-24
> **Decisions Made**: Session timeout 30min fixed, flatten logs, same sessionId across tabs, SHA-256 for auth session derivation, client sends sessionId in API request body

## Executive Summary

This document analyzes adding `session_id` to complement existing `request_id` tracking. Key findings:

- **request_id**: Per-request tracing (works well, already implemented)
- **session_id**: Cross-request user journey tracking (proposed)

**Recommendation**: Implement hybrid approach - auth-derived session for logged-in users, client-generated for anonymous.

---

## Current State: Request ID Implementation

### What request_id Does Today

A `request_id` uniquely identifies a **single client-to-server request**.

| Aspect | Implementation |
|--------|----------------|
| **Scope** | One request (button click, API call) |
| **Lifetime** | Generated → Sent → Logged → Discarded |
| **Format** | `client-{timestamp}-{random6}` or `api-{uuid}` |
| **Storage** | `AsyncLocalStorage` (server), module var (client) |
| **Contains** | `{ requestId, userId }` |

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/requestIdContext.ts` | Context storage + propagation |
| `src/hooks/clientPassRequestId.ts` | Client-side generation + hook |
| `src/lib/serverReadRequestId.ts` | Server-side extraction wrapper |
| `src/lib/server_utilities.ts` | Auto-injects into logs |

### Propagation Flow

```
Client Component
  ↓ useClientPassRequestId() generates ID
  ↓ withRequestId() adds __requestId to payload
API/Server Action
  ↓ serverReadRequestId() extracts __requestId
  ↓ RequestIdContext.run() sets async context
  ↓ All downstream code inherits context
Logger
  ↓ addRequestId() auto-includes requestId + userId
```

---

## What session_id Would Add

A `session_id` tracks a **logical user session** spanning multiple requests.

### Semantic Difference

| Concept | Scope | Example |
|---------|-------|---------|
| **request_id** | Single API call | "Fetch explanation #42" |
| **session_id** | User activity window | "User's entire editing session" |

### Relationship Model

```
Session (sessionId: "auth-a1b2c3d4e5f6")
├── Request 1 (requestId: "client-001-xyz")
├── Request 2 (requestId: "client-002-abc")
├── Request 3 (requestId: "api-uuid-1")
└── Request 4 (requestId: "client-003-def")
```

### Extended Context Structure

```typescript
// Current:
{ requestId: string; userId: string }

// Extended:
{
  requestId: string;
  userId: string;
  sessionId: string;
  previousSessionId?: string;  // For auth transitions
}
```

---

## Recommended Implementation

### Design Principle: Separate Session ID Module

Create a new `src/lib/sessionId.ts` file for session ID logic. This:
- Keeps `requestIdContext.ts` focused on async context propagation
- Allows synchronous session ID generation (critical for avoiding 'pending' values in logs)
- Follows existing pattern of separate utility modules

### Session ID Generation

Use **hybrid approach**: synchronous anonymous session, async upgrade to auth-derived.

**Key insight**: Generate session ID synchronously on first render, then upgrade when auth resolves. This avoids `'pending'` values in logs.

```typescript
// src/lib/sessionId.ts - NEW FILE

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (fixed)
const SESSION_KEY = 'ea_session';

interface StoredSession {
  id: string;
  lastActivity: number;
}

/**
 * SYNCHRONOUS session ID for anonymous users.
 * Called immediately on render - no useEffect delay.
 *
 * SSR Safety: Returns 'ssr-pending' during server rendering.
 */
export function getOrCreateAnonymousSessionId(): string {
  if (typeof window === 'undefined') {
    return 'ssr-pending';
  }

  try {
    const stored = localStorage.getItem(SESSION_KEY);
    const now = Date.now();

    if (stored) {
      const { id, lastActivity } = JSON.parse(stored) as StoredSession;
      if (now - lastActivity < SESSION_TIMEOUT_MS) {
        // Refresh sliding window
        localStorage.setItem(SESSION_KEY, JSON.stringify({ id, lastActivity: now }));
        return id;
      }
    }

    // Create new session
    const newId = `sess-${generateUUID()}`;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: newId, lastActivity: now }));
    return newId;
  } catch {
    // localStorage unavailable (Safari private mode, quota exceeded, etc.)
    return `sess-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * Derive deterministic session ID from authenticated user using SHA-256.
 * Called AFTER auth resolves - takes userId directly (not session object).
 *
 * Why userId only (not full session):
 * - userId is constant for the entire auth session
 * - Avoids extra getSession() call - we already have userId from getUser()
 * - expires_at changes on token refresh (~hourly), would break continuity
 *
 * Why SHA-256 (not btoa):
 * - btoa is reversible base64 encoding, not a hash
 * - SHA-256 is a true one-way cryptographic hash
 * - Prevents userId exposure if logs are shared externally
 */
export async function deriveAuthSessionId(userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `auth-${hashHex.slice(0, 12)}`;
}

/**
 * Cross-browser UUID generation with fallback.
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * OPTIONAL: Get tab-specific ID for per-tab debugging.
 *
 * NOT included in core implementation - add only if needed for:
 * - Debugging multi-tab race conditions
 * - Distinguishing requests from different tabs in same session
 *
 * Usage: Add to __requestId payload if needed:
 *   __requestId: { requestId, userId, sessionId, tabId: getTabId() }
 */
export function getTabId(): string {
  if (typeof window === 'undefined') return 'ssr';

  try {
    let tabId = sessionStorage.getItem('ea_tabId');
    if (!tabId) {
      tabId = generateUUID().slice(0, 8);
      sessionStorage.setItem('ea_tabId', tabId);
    }
    return tabId;
  } catch {
    return `tab-${Date.now()}`;
  }
}

/**
 * Clear session on logout for privacy.
 */
export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore errors
  }
}
```

### Auth State Change Handler

Register the `onAuthStateChange` listener in `src/lib/supabase.ts` with a client-only guard:

```typescript
// src/lib/supabase.ts - ADD at bottom

import { clearSession } from './sessionId';

// Session management on auth state changes (client-only)
if (typeof window !== 'undefined') {
  supabase_browser.auth.onAuthStateChange((event, session) => {
    // Clear anonymous session on logout
    if (event === 'SIGNED_OUT') {
      clearSession();
    }

    // Note: SIGNED_IN is handled by useAuthenticatedRequestId's useEffect
    // which calls handleAuthTransition(). We don't duplicate that logic here
    // because React components need to update their state anyway.
    //
    // Auth events reference (from Supabase docs):
    // - SIGNED_IN: User signed in (new session)
    // - SIGNED_OUT: User signed out (session cleared)
    // - TOKEN_REFRESHED: Token was refreshed (~hourly)
    // - USER_UPDATED: User profile updated
    // - PASSWORD_RECOVERY: Password recovery initiated
  });
}
```

**Why this location:**
- `supabase.ts` is already imported by all auth-related code
- Listener is registered once on module load
- Client-guard prevents server-side execution

**Why SIGNED_IN isn't handled here:**
- React components using `useAuthenticatedRequestId` need to update their state
- The hook's `useEffect` already calls `getUser()` which triggers `handleAuthTransition()`
- Duplicating the logic here would cause race conditions with React state updates

### Server-Side Session ID (Webhooks, Cron, External APIs)

For requests without a client, generate deterministic server-side session IDs:

```typescript
// src/lib/serverSessionId.ts
import { createHash } from 'crypto';

/**
 * Generate session ID for server-originated requests (no client).
 * Used for webhooks, cron jobs, and external API integrations.
 */
export function getServerSessionId(request?: Request): string {
  // Webhooks: use webhook ID header for correlation
  const webhookId = request?.headers.get('x-webhook-id');
  if (webhookId) {
    return `webhook-${createHash('sha256').update(webhookId).digest('hex').slice(0, 12)}`;
  }

  // Cron jobs: use job name + date for daily grouping
  const cronJob = request?.headers.get('x-cron-job');
  if (cronJob) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `cron-${cronJob}-${today}`;
  }

  // Fallback: one-off server request
  return `server-${crypto.randomUUID().slice(0, 12)}`;
}
```

### Avoiding 'pending' Values in Logs

**Problem**: A naive `useSessionId()` hook would return `'pending'` on first render, resulting in useless log entries.

**Solution**: Use synchronous initialization with lazy state initializer:

```typescript
// src/hooks/clientPassRequestId.ts - MODIFY useAuthenticatedRequestId

import { getOrCreateAnonymousSessionId, deriveAuthSessionId } from '@/lib/sessionId';

export function useAuthenticatedRequestId() {
  const [userId, setUserId] = useState<string>('anonymous');
  // SYNCHRONOUS initial value - no 'pending' state ever
  const [sessionId, setSessionId] = useState<string>(() =>
    getOrCreateAnonymousSessionId()
  );

  useEffect(() => {
    async function fetchUser() {
      const { data } = await supabase_browser.auth.getUser();
      if (data?.user?.id) {
        setUserId(data.user.id);
        // Upgrade to auth-derived session
        setSessionId(deriveAuthSessionId(data.user.id));
      }
    }
    fetchUser();
  }, []);

  return useClientPassRequestId(userId, sessionId);
}
```

**Why this works:**
1. First render: `sessionId = 'sess-xxx'` (anonymous, synchronous from localStorage)
2. After auth resolves: `sessionId = 'auth-xxx'` (upgraded)
3. Logs show natural session transition - never `'pending'`

**SSR Hydration Warning**:
- During SSR, `getOrCreateAnonymousSessionId()` returns `'ssr-pending'`
- After hydration, it returns `'sess-xxx'` from localStorage
- **NEVER render `sessionId` in visible UI elements** - this causes React hydration mismatch errors
- `sessionId` is for logging/debugging only, not for display
- If you need to display session info in UI, use a client-only component with `useEffect`

### Handling Anonymous → Authenticated Transition

When user logs in mid-session, link the sessions. This function is called from `useAuthenticatedRequestId`'s `useEffect` after `getUser()` resolves:

```typescript
/**
 * Handle session transition from anonymous to authenticated.
 * Called in useAuthenticatedRequestId's useEffect after getUser() resolves.
 *
 * @param userId - The authenticated user's ID from getUser()
 * @returns The new auth session ID and optionally the previous anonymous session ID
 */
export async function handleAuthTransition(userId: string): Promise<{
  sessionId: string;
  previousSessionId?: string;
}> {
  const anonSession = localStorage.getItem(SESSION_KEY);  // Use SESSION_KEY constant
  const anonSessionId = anonSession ? JSON.parse(anonSession).id : null;
  const authSessionId = await deriveAuthSessionId(userId);  // Now async

  if (anonSessionId && anonSessionId !== authSessionId) {
    // Log linking event for journey reconstruction
    // Note: This runs client-side, use console.log or client logger
    console.log('[Session] Transition from anonymous to authenticated', {
      previousSessionId: anonSessionId,
      sessionId: authSessionId,
    });
    localStorage.removeItem(SESSION_KEY);
    return { sessionId: authSessionId, previousSessionId: anonSessionId };
  }

  return { sessionId: authSessionId };
}
```

---

## Integration Points

### 1. RequestIdContext Extension

```typescript
// src/lib/requestIdContext.ts

// Define the context data interface (add sessionId)
interface ContextData {
  requestId: string;
  userId: string;
  sessionId: string;
}

// Update the storage type to include sessionId
const storage = typeof window === 'undefined'
  ? new (require('async_hooks').AsyncLocalStorage<ContextData>)()
  : null;

// Update client-side default to include sessionId
let clientRequestId: ContextData = {
  requestId: 'unknown',
  userId: 'anonymous',
  sessionId: 'unknown'
};

// Update validation to include sessionId
function validateContextData(data: ContextData): void {
  if (!data) {
    throw new Error('RequestIdContext: data is required');
  }
  if (!data.requestId || data.requestId === '' || data.requestId === 'unknown') {
    throw new Error('RequestIdContext: requestId must be a valid non-empty string');
  }
  // sessionId can be 'unknown' during migration phase
}

export class RequestIdContext {
  // ... existing run(), setClient(), get() methods ...

  // Add new getter for sessionId
  static getSessionId(): string {
    return this.get()?.sessionId || 'unknown';
  }
}
```

**Note**: The `previousSessionId` is only used transiently during auth transitions and logged immediately. It doesn't need to be stored in the context.

### 2. Client Hook Update

```typescript
// src/hooks/clientPassRequestId.ts

import { getOrCreateAnonymousSessionId, deriveAuthSessionId } from '@/lib/sessionId';

// Extend base hook to accept sessionId
export function useClientPassRequestId(userId = 'anonymous', sessionId?: string) {
  const generateRequestId = useCallback(() =>
    `client-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    []
  );

  const withRequestId = useCallback(<T extends Record<string, any> = {}>(data?: T) => {
    const requestId = generateRequestId();
    const effectiveSessionId = sessionId ?? getOrCreateAnonymousSessionId();

    RequestIdContext.setClient({ requestId, userId, sessionId: effectiveSessionId });

    return {
      ...(data || {} as T),
      __requestId: { requestId, userId, sessionId: effectiveSessionId }
    } as T & { __requestId: { requestId: string; userId: string; sessionId: string } };
  }, [userId, sessionId, generateRequestId]);

  return { withRequestId };
}

// Updated authenticated hook with synchronous sessionId and auth transition handling
export function useAuthenticatedRequestId() {
  const [userId, setUserId] = useState<string>('anonymous');
  const [sessionId, setSessionId] = useState<string>(() =>
    getOrCreateAnonymousSessionId()  // Synchronous - no 'pending'!
  );

  useEffect(() => {
    async function fetchUser() {
      const { data } = await supabase_browser.auth.getUser();
      if (data?.user?.id) {
        // Call handleAuthTransition to link anonymous → auth session
        const transition = await handleAuthTransition(data.user.id);
        setUserId(data.user.id);
        setSessionId(transition.sessionId);
        // transition.previousSessionId is logged inside handleAuthTransition
      }
    }
    fetchUser();
  }, []);

  return useClientPassRequestId(userId, sessionId);
}
```

### 3. Server Extraction (Server Actions)

```typescript
// src/lib/serverReadRequestId.ts
import { RequestIdContext } from './requestIdContext';
import { randomUUID } from 'crypto';

export function serverReadRequestId<T extends (...args: any[]) => any>(fn: T): T {
  return (async (...args) => {
    const requestIdData = args[0]?.__requestId || {
      requestId: randomUUID(),
      userId: 'anonymous',
      sessionId: 'server-generated'  // Fallback for direct API/webhook calls
    };

    if (args[0]?.__requestId) {
      delete args[0].__requestId;
    }

    return RequestIdContext.run(requestIdData, async () => await fn(...args));
  }) as T;
}
```

**Note**: Session ID is client-generated and passed through. Server only extracts from payload - no server-side auth call needed.

### 3b. API Routes (Non-Server-Action Endpoints)

For API routes that don't use `serverReadRequestId` wrapper, the client must include `sessionId` in the request body:

```typescript
// Client-side: Include sessionId in API route requests
// Example: src/app/results/page.tsx or any component calling API routes

import { getOrCreateAnonymousSessionId } from '@/lib/sessionId';

// When making fetch calls to API routes:
const sessionId = getOrCreateAnonymousSessionId(); // Or from auth state

const response = await fetch('/api/fetchSourceMetadata', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url,
    __requestId: { requestId, userId, sessionId }
  })
});
```

```typescript
// Server-side: API route extracts sessionId from body
// Example: src/app/api/fetchSourceMetadata/route.ts

export async function POST(request: Request) {
  const body = await request.json();
  const { url, __requestId } = body;

  const requestIdData = __requestId || {
    requestId: `api-${randomUUID()}`,
    userId: 'anonymous',
    sessionId: 'unknown'  // Fallback if client didn't send
  };

  return await RequestIdContext.run(requestIdData, async () => {
    // All logs in this context will include sessionId
    logger.info('fetchSourceMetadata: Processing', { url });
    // ...
  });
}
```

**Migration note**: During migration, API routes without sessionId will log `sessionId: 'unknown'`. This is acceptable and distinguishes pre-migration requests in log analysis.

### 4. Logger Enhancement

**Important**: The current logger nests `requestId` inside an object. We're flattening this (breaking change approved).

Both console output and file logging now use flat structure with `requestId`, `userId`, `sessionId` at the top level:

```typescript
// src/lib/server_utilities.ts

// Helper to add context to console logs (UPDATED: now includes sessionId)
const addRequestId = (data: LoggerData | null) => ({
  requestId: RequestIdContext.getRequestId(),
  userId: RequestIdContext.getUserId(),
  sessionId: RequestIdContext.getSessionId(),
  ...(data || {})
});

// File logging with FLAT structure (breaking change from nested)
function writeToFile(level: string, message: string, data: LoggerData | null) {
  const timestamp = new Date().toISOString();

  const logEntry = JSON.stringify({
    timestamp,
    level,
    message,
    requestId: RequestIdContext.getRequestId(),
    userId: RequestIdContext.getUserId(),
    sessionId: RequestIdContext.getSessionId(),
    data: data || {}
  }) + '\n';

  try {
    appendFileSync(logFile, logEntry);
  } catch (error) {
    // Silently fail to avoid recursive logging
  }
}

// Logger methods (all use addRequestId for console, writeToFile for file)
const logger = {
  info: (message: string, data: LoggerData | null = null) => {
    console.log(`[INFO] ${message}`, addRequestId(data));
    writeToFile('INFO', message, data);
  },
  // ... debug, error, warn follow same pattern
};
```

**Note**: Console output and file format are now aligned. Both show flat structure with `requestId`, `userId`, `sessionId` at top level.

### 5. OpenTelemetry Attributes

```typescript
// In withTracing():
span.setAttribute('session.id', RequestIdContext.getSessionId());
```

---

## Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `src/lib/sessionId.ts` | **NEW** - Session ID generation (anon + auth-derived with SHA-256) | P0 |
| `src/lib/requestIdContext.ts` | Add sessionId to ContextData interface + `getSessionId()` | P0 |
| `src/lib/supabase.ts` | Add `onAuthStateChange` listener for session cleanup | P0 |
| `src/hooks/clientPassRequestId.ts` | Integrate sessionId with synchronous init + handleAuthTransition | P0 |
| `src/lib/serverReadRequestId.ts` | Extract sessionId from payload | P0 |
| `src/lib/server_utilities.ts` | Flatten log format + add sessionId to both console and file | P1 |
| `src/app/api/**/route.ts` | Update API routes to extract sessionId from request body | P1 |
| `src/lib/logging/server/automaticServerLoggingBase.ts` | Add span attribute | P2 |
| `instrumentation.ts` | Add sessionId to traces | P2 |

**Implementation notes:**
- `deriveAuthSessionId()` is now async (uses crypto.subtle.digest)
- `handleAuthTransition()` is now async (calls deriveAuthSessionId)
- Update `useAuthenticatedRequestId`'s useEffect to await these functions
- `getTabId()` is optional - only add if debugging multi-tab issues

**Removed from original plan:**
- `src/hooks/useSessionId.ts` - Not needed; session ID is generated synchronously in `useAuthenticatedRequestId()`
- `src/lib/serverSessionId.ts` - Only needed for webhooks/cron; can be added later if required

---

## Migration Strategy

### Phase 1: Add Optional sessionId

```typescript
interface RequestContext {
  requestId: string;
  userId: string;
  sessionId?: string;  // Optional during migration
}

// Logger handles missing sessionId gracefully:
const addRequestId = (data) => ({
  requestId: RequestIdContext.getRequestId(),
  userId: RequestIdContext.getUserId(),
  ...(RequestIdContext.getSessionId() && { sessionId: RequestIdContext.getSessionId() }),
  ...data,
});
```

### Phase 2: Client Integration

- Update `useAuthenticatedRequestId()` to include sessionId
- Update all API routes to propagate sessionId
- Monitor logs to verify propagation

### Phase 3: Make Required

```typescript
interface RequestContext {
  requestId: string;
  userId: string;
  sessionId: string;  // Now required
}
```

### Query Patterns for Mixed Logs

```sql
-- Handle logs from before migration
SELECT
  requestId,
  userId,
  COALESCE(sessionId, 'pre-migration') as sessionId
FROM logs
WHERE timestamp > '2024-12-01';
```

---

## Log Format

### Current (Nested - to be replaced)

```json
{
  "timestamp": "2024-12-24T10:30:45.123Z",
  "level": "INFO",
  "message": "Explanation generated",
  "data": {},
  "requestId": {
    "requestId": "client-1703416245-abc123",
    "userId": "user-uuid-456"
  }
}
```

### New (Flat - breaking change approved)

```json
{
  "timestamp": "2024-12-24T10:30:45.123Z",
  "level": "INFO",
  "message": "Explanation generated",
  "requestId": "client-1703416245-abc123",
  "userId": "user-uuid-456",
  "sessionId": "auth-a1b2c3d4e5f6",
  "data": {}
}
```

**Note**: This is a breaking change for any log parsers expecting the nested format.

---

## Query Patterns Enabled

```sql
-- Find all requests in a session
SELECT * FROM logs WHERE sessionId = 'auth-xyz' ORDER BY timestamp;

-- Count requests per session
SELECT sessionId, COUNT(*) as request_count FROM logs GROUP BY sessionId;

-- Find sessions with errors
SELECT DISTINCT sessionId FROM logs WHERE level = 'ERROR';

-- Trace user journey across auth transition
WITH linked AS (
  SELECT sessionId, previousSessionId FROM logs
  WHERE previousSessionId IS NOT NULL
)
SELECT * FROM logs
WHERE sessionId IN (SELECT sessionId FROM linked)
   OR sessionId IN (SELECT previousSessionId FROM linked)
ORDER BY timestamp;
```

---

## Privacy & Compliance

### Data Classification

- **sessionId**: Non-PII (random identifier, not tied to identity without userId)
- **Purpose**: Debugging and error correlation only

### Retention Policy

- Logs with sessionId: 30 days
- After 30 days: Aggregate/anonymize (remove sessionId)

### User Control

Session ID is cleared on:
- Logout (automatic via auth state change)
- Browser cache/localStorage clear
- 30-minute inactivity timeout

---

## Summary

| Aspect | request_id | session_id |
|--------|------------|------------|
| **Scope** | Single request | Multiple requests |
| **Lifetime** | Milliseconds | Minutes to hours |
| **Format** | `client-{ts}-{random}` | `auth-{hash}` or `sess-{uuid}` |
| **Storage** | AsyncLocalStorage | localStorage + context |
| **Use case** | Trace single call | Trace user journey |
| **Correlation** | Debug one error | Debug sequence of events |

---

## Existing Patterns

### Database session_id (Different Concept)

The `testing_edits_pipeline` table has a `session_id` column:

```sql
CREATE TABLE testing_edits_pipeline (
  session_id uuid,
  session_metadata jsonb,
  -- ...
);
```

**Important distinction:**
- **DB session_id**: Debug/test artifact identity (UUID format)
- **Logging sessionId**: User activity window (`auth-xxx` or `sess-xxx` format)

These are semantically different concepts that happen to share a name. The prefix format (`auth-`, `sess-`, `server-`) distinguishes logging session IDs from database UUIDs.

---

## Decisions Made

| Question | Decision |
|----------|----------|
| **Tab handling** | Same sessionId across tabs (via localStorage) |
| **Timeout duration** | 30 minutes fixed (not configurable) |
| **Anonymous tracking** | Yes - generates valuable debugging data |
| **Log format** | Flatten (breaking change accepted) |
| **Auth session hash** | SHA-256 via Web Crypto API (not btoa) |
| **API routes sessionId** | Client sends in request body via __requestId |
| **handleAuthTransition call site** | In useAuthenticatedRequestId's useEffect |
| **SIGNED_IN handling** | Via hook's useEffect (not onAuthStateChange) |
