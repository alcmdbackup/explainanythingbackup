# Session ID vs Request ID: Research Document

> **Status**: Ready for Implementation
> **Last Updated**: 2024-12-24
> **Decisions Made**: Session timeout 30min fixed, flatten logs, same sessionId across tabs

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
 * Derive deterministic session ID from authenticated user.
 * Called AFTER auth resolves - takes userId directly (not session object).
 *
 * Why userId only (not full session):
 * - userId is constant for the entire auth session
 * - Avoids extra getSession() call - we already have userId from getUser()
 * - expires_at changes on token refresh (~hourly), would break continuity
 */
export function deriveAuthSessionId(userId: string): string {
  // Using btoa for browser compatibility (no crypto import needed)
  const hash = btoa(userId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  return `auth-${hash}`;
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
 * Optional: Get tab-specific ID for per-tab debugging.
 */
export function getTabId(): string {
  if (typeof window === 'undefined') return 'ssr';

  try {
    let tabId = sessionStorage.getItem('tabId');
    if (!tabId) {
      tabId = generateUUID().slice(0, 8);
      sessionStorage.setItem('tabId', tabId);
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

### Logout Handler Registration

Register the `onAuthStateChange` listener in `src/lib/supabase.ts` with a client-only guard:

```typescript
// src/lib/supabase.ts - ADD at bottom

import { clearSession } from './sessionId';

// Session cleanup on logout (client-only)
if (typeof window !== 'undefined') {
  supabase_browser.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      clearSession();
    }
  });
}
```

**Why this location:**
- `supabase.ts` is already imported by all auth-related code
- Listener is registered once on module load
- Client-guard prevents server-side execution

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

**Note**: Don't render `sessionId` in SSR-critical markup. It's for logging, not UI.

### Handling Anonymous → Authenticated Transition

When user logs in mid-session, link the sessions:

```typescript
export function handleAuthTransition(): {
  sessionId: string;
  previousSessionId?: string;
} {
  const anonSession = localStorage.getItem('session');
  const anonSessionId = anonSession ? JSON.parse(anonSession).id : null;
  const authSessionId = deriveAuthSessionId(currentSession);

  if (anonSessionId && anonSessionId !== authSessionId) {
    // Log linking event for journey reconstruction
    logger.info('Session transition', {
      previousSessionId: anonSessionId,
      sessionId: authSessionId,
    });
    localStorage.removeItem('session');
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
interface RequestContext {
  requestId: string;
  userId: string;
  sessionId: string;
  previousSessionId?: string;
}

// Add getter
static getSessionId(): string {
  return this.get()?.sessionId || 'unknown';
}
```

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

// Updated authenticated hook with synchronous sessionId
export function useAuthenticatedRequestId() {
  const [userId, setUserId] = useState<string>('anonymous');
  const [sessionId, setSessionId] = useState<string>(() =>
    getOrCreateAnonymousSessionId()  // Synchronous - no 'pending'!
  );

  useEffect(() => {
    async function fetchUser() {
      const { data } = await supabase_browser.auth.getUser();
      if (data?.user?.id) {
        setUserId(data.user.id);
        setSessionId(deriveAuthSessionId(data.user.id));
      }
    }
    fetchUser();
  }, []);

  return useClientPassRequestId(userId, sessionId);
}
```

### 3. Server Extraction

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

### 4. Logger Enhancement

**Important**: The current logger nests `requestId` inside an object. We're flattening this (breaking change approved).

```typescript
// src/lib/server_utilities.ts

// Helper to add context to console logs
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
```

### 5. OpenTelemetry Attributes

```typescript
// In withTracing():
span.setAttribute('session.id', RequestIdContext.getSessionId());
```

---

## Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `src/lib/sessionId.ts` | **NEW** - Session ID generation (anon + auth-derived) | P0 |
| `src/lib/requestIdContext.ts` | Add sessionId to context interface + `getSessionId()` | P0 |
| `src/lib/supabase.ts` | Add `onAuthStateChange` listener for cleanup | P0 |
| `src/hooks/clientPassRequestId.ts` | Integrate sessionId with synchronous init | P0 |
| `src/lib/serverReadRequestId.ts` | Extract sessionId from payload | P0 |
| `src/lib/server_utilities.ts` | Flatten log format + add sessionId | P1 |
| `src/lib/logging/server/automaticServerLoggingBase.ts` | Add span attribute | P2 |
| `instrumentation.ts` | Add sessionId to traces | P2 |

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
