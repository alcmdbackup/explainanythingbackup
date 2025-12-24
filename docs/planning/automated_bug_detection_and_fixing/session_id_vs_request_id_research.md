# Session ID vs Request ID: Research Document

> **Status**: Draft - Needs implementation decisions
> **Last Updated**: 2024-12-24

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

### Session ID Generation

Use **hybrid approach** with auth sessions taking precedence:

```typescript
// src/lib/sessionId.ts
import { createHash } from 'crypto';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface StoredSession {
  id: string;
  lastActivity: number;
}

/**
 * Get or create session ID.
 * Auth sessions take precedence over anonymous.
 */
export async function getSessionId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();

  if (!error && data?.session) {
    return deriveAuthSessionId(data.session);
  }

  return getOrCreateAnonymousSessionId();
}

/**
 * Derive deterministic session ID from auth session.
 * Uses non-secret metadata (NOT access token).
 */
function deriveAuthSessionId(session: Session): string {
  // SECURITY: Never use access_token - it's a secret
  const input = `${session.user.id}-${session.created_at || session.expires_at}`;
  return `auth-${createHash('sha256').update(input).digest('hex').slice(0, 12)}`;
}

/**
 * Get or create anonymous session with timeout.
 * Uses localStorage for cross-tab persistence.
 */
function getOrCreateAnonymousSessionId(): string {
  const stored = localStorage.getItem('session');
  const now = Date.now();

  if (stored) {
    const { id, lastActivity } = JSON.parse(stored) as StoredSession;
    if (now - lastActivity < SESSION_TIMEOUT_MS) {
      // Refresh sliding window
      localStorage.setItem('session', JSON.stringify({ id, lastActivity: now }));
      return id;
    }
    // Session expired - will create new one below
  }

  // Create new session with full UUID (collision-safe)
  const newSession: StoredSession = {
    id: `sess-${crypto.randomUUID()}`,
    lastActivity: now,
  };
  localStorage.setItem('session', JSON.stringify(newSession));
  return newSession.id;
}

/**
 * Optional: Get tab-specific ID for per-tab debugging.
 */
export function getTabId(): string {
  let tabId = sessionStorage.getItem('tabId');
  if (!tabId) {
    tabId = crypto.randomUUID().slice(0, 8);
    sessionStorage.setItem('tabId', tabId);
  }
  return tabId;
}

/**
 * Clear session on logout for privacy.
 */
export function clearSession(): void {
  localStorage.removeItem('session');
  sessionStorage.removeItem('anonSessionId');
}

// Register logout handler
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    clearSession();
  }
});
```

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
export function useAuthenticatedRequestId() {
  const [userId, setUserId] = useState('anonymous');
  const [sessionId, setSessionId] = useState<string>('unknown');

  useEffect(() => {
    fetchUserid().then(setUserId);
    getSessionId().then(setSessionId);
  }, []);

  return {
    withRequestId: <T>(data: T) => ({
      ...data,
      __requestId: {
        requestId: generateRequestId(),
        userId,
        sessionId,
      },
    }),
  };
}
```

### 3. Server Extraction

```typescript
// src/lib/serverReadRequestId.ts
const { requestId, userId, sessionId } = data.__requestId;
return RequestIdContext.run({ requestId, userId, sessionId }, () => fn(...args));
```

### 4. Logger Enhancement

```typescript
// src/lib/server_utilities.ts
const addRequestId = (data: LoggerData | null) => ({
  requestId: RequestIdContext.getRequestId(),
  userId: RequestIdContext.getUserId(),
  sessionId: RequestIdContext.getSessionId(),
  ...data,
});
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
| `src/lib/sessionId.ts` | **NEW** - session management | P0 |
| `src/lib/requestIdContext.ts` | Add sessionId to context | P0 |
| `src/hooks/clientPassRequestId.ts` | Integrate getSessionId() | P0 |
| `src/lib/serverReadRequestId.ts` | Extract sessionId from payload | P0 |
| `src/lib/server_utilities.ts` | Add sessionId to logger | P1 |
| `src/app/api/stream-chat/route.ts` | Handle sessionId | P1 |
| `src/lib/logging/server/automaticServerLoggingBase.ts` | Add span attribute | P2 |
| `instrumentation.ts` | Add sessionId to traces | P2 |

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

### Current

```json
{
  "timestamp": "2024-12-24T10:30:45.123Z",
  "level": "INFO",
  "message": "Explanation generated",
  "requestId": "client-1703416245-abc123",
  "userId": "user-uuid-456"
}
```

### With session_id

```json
{
  "timestamp": "2024-12-24T10:30:45.123Z",
  "level": "INFO",
  "message": "Explanation generated",
  "requestId": "client-1703416245-abc123",
  "userId": "user-uuid-456",
  "sessionId": "auth-a1b2c3d4e5f6"
}
```

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

Already established in `testing_edits_pipeline` table:

```sql
CREATE TABLE testing_edits_pipeline (
  session_id uuid,
  session_metadata jsonb,
  -- ...
);
```

This confirms the session pattern is already used for pipeline testing.

---

## Open Questions

Before implementation, clarify:

1. **Tab handling**: Same sessionId across tabs, or per-tab?
2. **Timeout duration**: 30 minutes appropriate?
3. **Anonymous tracking**: Required, or only authenticated users?
