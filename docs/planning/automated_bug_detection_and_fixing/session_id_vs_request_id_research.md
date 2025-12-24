# Session ID vs Request ID: Research Document

## Current State: Request ID Implementation

### What request_id Does Today

A `request_id` uniquely identifies a **single client-to-server request**. It's generated per action/API call.

| Aspect | Current Implementation |
|--------|------------------------|
| **Scope** | One request (e.g., one button click, one API call) |
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

## What session_id Would Represent

A `session_id` would track a **logical user session** spanning multiple requests.

### Semantic Difference

| Concept | Scope | Example |
|---------|-------|---------|
| **request_id** | Single API call | "Fetch explanation #42" |
| **session_id** | User activity window | "User's entire editing session on canvas X" |

### Candidate Session Boundaries

| Session Type | Start | End | Use Case |
|--------------|-------|-----|----------|
| **Auth session** | Login | Logout/expire | User accountability |
| **Tab session** | Page load | Tab close | Debug user journey |
| **Canvas session** | Open canvas | Close canvas | Track canvas lifecycle |
| **Browser session** | First visit | Browser close | General analytics |

---

## How session_id Would Fit Alongside request_id

### Extended Context Structure

```typescript
// Current:
{ requestId: string; userId: string }

// Extended:
{ requestId: string; userId: string; sessionId?: string }
```

### Relationship Model

```
Session (sessionId: "sess-abc123")
├── Request 1 (requestId: "client-001-xyz")
├── Request 2 (requestId: "client-002-abc")
├── Request 3 (requestId: "api-uuid-1")
└── Request 4 (requestId: "client-003-def")
```

Each request belongs to exactly one session. Multiple requests share the same session ID.

---

## Implementation Options

### Option A: Supabase Auth Session Token

Use Supabase's existing session token as `sessionId`.

**Pros:**
- Already exists (no new generation logic)
- Tied to authentication lifecycle
- Persists across page refreshes

**Cons:**
- Anonymous users have no session
- Token may be long/opaque
- Session = auth session (might be too coarse)

**Implementation:**
```typescript
// In useAuthenticatedRequestId():
const session = await supabase.auth.getSession();
const sessionId = session?.data?.session?.access_token?.slice(0, 16); // truncated
```

### Option B: Client-Generated Session ID

Generate a session ID on page load, store in sessionStorage.

**Pros:**
- Works for anonymous users
- Fresh per browser tab
- Simple to implement

**Cons:**
- Lost on page refresh (unless using localStorage)
- Not tied to auth

**Implementation:**
```typescript
// src/lib/sessionId.ts
export function getSessionId(): string {
  let sessionId = sessionStorage.getItem('sessionId');
  if (!sessionId) {
    sessionId = `sess-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    sessionStorage.setItem('sessionId', sessionId);
  }
  return sessionId;
}
```

### Option C: Hybrid Approach

Use auth session ID when authenticated, client-generated when anonymous.

**Pros:**
- Works for all users
- Maintains identity continuity for logged-in users

**Implementation:**
```typescript
export async function getSessionId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data?.session?.access_token) {
    // Hash or truncate to reasonable length
    return `auth-${hashFirst16Chars(data.session.access_token)}`;
  }
  return getClientGeneratedSessionId(); // Option B fallback
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
  sessionId?: string;  // NEW
}
```

### 2. Client Hook Update

```typescript
// src/hooks/clientPassRequestId.ts
export function useAuthenticatedRequestId() {
  const [userId, setUserId] = useState('anonymous');
  const [sessionId, setSessionId] = useState<string | undefined>();

  useEffect(() => {
    fetchUserid().then(setUserId);
    getSessionId().then(setSessionId);  // NEW
  }, []);

  return {
    withRequestId: <T>(data: T) => ({
      ...data,
      __requestId: {
        requestId: generateRequestId(),
        userId,
        sessionId,  // NEW
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
const addRequestId = (data) => ({
  requestId: RequestIdContext.getRequestId(),
  userId: RequestIdContext.getUserId(),
  sessionId: RequestIdContext.getSessionId(),  // NEW
  ...data,
});
```

### 5. OpenTelemetry Attributes

```typescript
// In withTracing():
span.setAttribute('session.id', RequestIdContext.getSessionId());
```

---

## Log Format Comparison

### Current Log Entry

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
  "sessionId": "sess-1703415000-xyz789"
}
```

---

## Query Patterns Enabled

### With request_id Only (Current)

```sql
-- Find all logs for a specific request
SELECT * FROM logs WHERE requestId = 'client-123-abc';
```

### With session_id Added

```sql
-- Find all requests in a session
SELECT * FROM logs WHERE sessionId = 'sess-xyz' ORDER BY timestamp;

-- Count requests per session
SELECT sessionId, COUNT(*) as request_count FROM logs GROUP BY sessionId;

-- Find sessions with errors
SELECT DISTINCT sessionId FROM logs WHERE level = 'ERROR';

-- User journey reconstruction
SELECT * FROM logs
WHERE sessionId = 'sess-xyz'
ORDER BY timestamp;
```

---

## Recommendations

### For Debugging Workflows

Use **Option B (client-generated session ID)** stored in `sessionStorage`:
- Simple to implement
- Works for anonymous debugging
- Natural per-tab isolation

### For Production Analytics

Use **Option C (hybrid approach)**:
- Auth session for logged-in users (accountability)
- Client session for anonymous (debugging)

### Implementation Priority

1. **Phase 1**: Add `sessionId` to context structure (minimal change)
2. **Phase 2**: Implement client-side session generation
3. **Phase 3**: Update all loggers to include sessionId
4. **Phase 4**: Add OpenTelemetry session attribute

---

## Existing Session Concepts in Codebase

Already found in `testing_edits_pipeline` table:

```sql
CREATE TABLE testing_edits_pipeline (
  session_id uuid,
  session_metadata jsonb,
  -- ...
);
```

This shows the pattern is already established for pipeline testing. Extending to request tracing follows the same concept.

---

## Summary Table

| Aspect | request_id | session_id |
|--------|------------|------------|
| **Scope** | Single request | Multiple requests |
| **Lifetime** | Milliseconds | Minutes to hours |
| **Cardinality** | High (per action) | Lower (per session) |
| **Storage** | AsyncLocalStorage | sessionStorage/cookie |
| **Use case** | Trace single call | Trace user journey |
| **Correlation** | Debug one error | Debug sequence of events |
