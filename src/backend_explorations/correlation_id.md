# Correlation ID Implementation

## Files to Change

### New Files
- `src/lib/correlationContext.ts` - Provides AsyncLocalStorage context for storing/retrieving correlation data across async calls
- `src/lib/serverReadCorrelation.ts` - Wraps server actions to extract correlation data from client and set up server context
- `src/hooks/clientPassCorrelation.ts` - React hook that injects correlation data into server action calls

### Existing Files
- `src/lib/server_utilities.ts` - Update writeToFile() to automatically read correlation from AsyncLocalStorage
- `src/lib/client_utilities.ts` - Update logger calls to include correlation data from context
- `src/actions/actions.ts` - Wrap server action exports with serverReadCorrelation to enable tracking
- Client components - Use clientPassCorrelation hook to send correlation data to server actions

## How correlationContext.ts Works

This file creates a **universal correlation system** that works on both client and server using different storage mechanisms.

### The Storage Strategy
```typescript
// Server-side storage
const storage = new AsyncLocalStorage<{ requestId: string; userId: string }>();

// Client-side tracking
let clientCorrelation = { requestId: 'unknown', userId: 'anonymous' };
```

**Two different storage types:**
- **Server:** `AsyncLocalStorage` - Node.js's magic context that flows through async calls
- **Client:** Simple module variable - since client is single-threaded

### The Universal Interface
```typescript
static run<T>(data: { requestId: string; userId: string }, callback: () => T): T {
  if (typeof window === 'undefined') {
    // Server: use AsyncLocalStorage
    return storage.run(data, callback);
  } else {
    // Client: use module variable
    const prev = clientCorrelation;
    clientCorrelation = data;
    try {
      return callback();
    } finally {
      clientCorrelation = prev; // Always restore previous value
    }
  }
}
```

**What `run()` does:**
- **Server:** Creates AsyncLocalStorage "bubble" with correlation data
- **Client:** Temporarily sets module variable, then restores it

### The Magic Getters
```typescript
static get() {
  return typeof window === 'undefined'
    ? storage.getStore()      // Server: read from AsyncLocalStorage
    : clientCorrelation;      // Client: read from module variable
}

static getRequestId(): string {
  return this.get()?.requestId || 'unknown';
}
```

**What happens:**
- Your logger calls `CorrelationContext.getRequestId()`
- It automatically detects client vs server
- Returns the correlation data from the right storage

### The Flow
1. **Client:** `withCorrelation()` calls `CorrelationContext.run()`
2. **Server:** `serverReadCorrelation()` calls `CorrelationContext.run()`
3. **Anywhere:** `logger.info()` calls `CorrelationContext.getRequestId()`
4. **Magic:** It automatically returns the right ID from the right storage

**Key Insight:** Same interface, different storage mechanisms, automatic detection. Your code just calls `getRequestId()` and it works everywhere.

## The Magic
AsyncLocalStorage (server) + module tracking (client) automatically carries request IDs through your code without changing function signatures.

## 1. Create Correlation Context (`src/lib/correlationContext.ts`)
```typescript
import { AsyncLocalStorage } from 'async_hooks';

// Server-side storage
const storage = new AsyncLocalStorage<{ requestId: string; userId: string }>();

// Client-side tracking
let clientCorrelation = { requestId: 'unknown', userId: 'anonymous' };

export class CorrelationContext {
  static run<T>(data: { requestId: string; userId: string }, callback: () => T): T {
    if (typeof window === 'undefined') {
      // Server: use AsyncLocalStorage
      return storage.run(data, callback);
    } else {
      // Client: use module variable
      const prev = clientCorrelation;
      clientCorrelation = data;
      try {
        return callback();
      } finally {
        clientCorrelation = prev;
      }
    }
  }

  static get() {
    return typeof window === 'undefined'
      ? storage.getStore()
      : clientCorrelation;
  }

  static getRequestId(): string {
    return this.get()?.requestId || 'unknown';
  }

  static getUserId(): string {
    return this.get()?.userId || 'anonymous';
  }
}
```

## 2. Update Server Logger (`src/lib/server_utilities.ts`)
```typescript
import { CorrelationContext } from './correlationContext';

// Just update writeToFile function:
function writeToFile(level: string, message: string, data: LoggerData | null) {
    const timestamp = new Date().toISOString();
    const correlation = {
        requestId: CorrelationContext.getRequestId(),
        userId: CorrelationContext.getUserId()
    };

    const logEntry = JSON.stringify({
        timestamp, level, message,
        data: data || {},
        correlation
    }) + '\n';

    try {
        appendFileSync(logFile, logEntry);
    } catch (error) {
        // Silently fail
    }
}

// Your existing logger stays exactly the same!
```

## 3. Update Client Logger (`src/lib/client_utilities.ts`)
```typescript
import { CorrelationContext } from './correlationContext';

const logger = {
    debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
        if (!debug) return;
        const correlation = { requestId: CorrelationContext.getRequestId() };
        console.log(`[DEBUG] ${message}`, { ...data, correlation });
    },

    error: (message: string, data: LoggerData | null = null) => {
        const correlation = { requestId: CorrelationContext.getRequestId() };
        console.error(`[ERROR] ${message}`, { ...data, correlation });
    },

    info: (message: string, data: LoggerData | null = null) => {
        const correlation = { requestId: CorrelationContext.getRequestId() };
        console.log(`[INFO] ${message}`, { ...data, correlation });
    },

    warn: (message: string, data: LoggerData | null = null) => {
        const correlation = { requestId: CorrelationContext.getRequestId() };
        console.warn(`[WARN] ${message}`, { ...data, correlation });
    }
};
```

## 4. Server Action Wrapper (`src/lib/serverReadCorrelation.ts`)
```typescript
import { CorrelationContext } from './correlationContext';
import { randomUUID } from 'crypto';

export function serverReadCorrelation<T extends (...args: any[]) => any>(fn: T): T {
  return (async (...args) => {
    const correlationData = args[0]?.__correlation || {
      requestId: randomUUID(),
      userId: 'anonymous'
    };

    if (args[0]?.__correlation) {
      delete args[0].__correlation;
    }

    return CorrelationContext.run(correlationData, () => fn(...args));
  }) as T;
}
```

## 5. Update Your Server Actions (`src/actions/actions.ts`)
```typescript
import { serverReadCorrelation } from '@/lib/serverReadCorrelation';

// Your existing functions stay exactly the same
const _saveExplanationAndTopic = withLogging(
    async function saveExplanationAndTopic(userQuery: string, explanationData: any) {
        // ZERO CHANGES - logger.info() now auto-includes correlation
        logger.info("Saving explanation and topic");
        // ... rest of your code unchanged
    },
    'saveExplanationAndTopic',
    { enabled: FILE_DEBUG }
);

// Only change: wrap the export
export const saveExplanationAndTopic = serverReadCorrelation(_saveExplanationAndTopic);
```

## 6. Client Correlation Hook (`src/hooks/clientPassCorrelation.ts`)
```typescript
'use client';
import { CorrelationContext } from '@/lib/correlationContext';
import { useCallback } from 'react';

export function clientPassCorrelation(userId = 'anonymous') {
  const generateRequestId = useCallback(() =>
    `client-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    []
  );

  const withCorrelation = useCallback((data = {}) => {
    const requestId = generateRequestId(); // New ID for each action!

    // Set client correlation context
    CorrelationContext.run({ requestId, userId }, () => {});

    return {
      ...data,
      __correlation: { requestId, userId }
    };
  }, [userId, generateRequestId]);

  return { withCorrelation };
}
```

## 7. Client Component Usage
```typescript
'use client';
import { clientPassCorrelation } from '@/hooks/clientPassCorrelation';
import { saveExplanationAndTopic } from '@/actions/actions';

export default function MyComponent() {
  const { withCorrelation } = clientPassCorrelation('user123');

  const handleSave = async () => {
    // Each call gets a new request ID for separate tracing
    await saveExplanationAndTopic(withCorrelation({
      userQuery: "test",
      explanationData: { title: "Test" }
    })); // → requestId: "client-1729425600000-abc123"
  };

  const handleEdit = async () => {
    // Different action = different request ID
    await editExplanation(withCorrelation({
      explanationId: 123,
      newContent: "Updated content"
    })); // → requestId: "client-1729425605000-def456"
  };
}
```

## Result
Your logs automatically become correlated:

**Server logs:**
```json
{
  "timestamp": "2024-10-20T10:30:00Z",
  "level": "INFO",
  "message": "Saving explanation and topic",
  "correlation": { "requestId": "client-abc-123", "userId": "user123" }
}
```

**Client logs:**
```
[INFO] User clicked save { correlation: { requestId: "client-abc-123" } }
```

**Search logs:**
```bash
grep '"requestId":"client-abc-123"' server.log
```

## Button Click Locations to Wrap

These are the exact locations in `src/app/results/page.tsx` where client actions need `withCorrelation()` wrapping:

- **Save Button** (line 1142): `onClick={handleSave}` → `saveExplanationToLibraryAction()`
- **Publish Changes Button** (line 1150): `onClick={handleSaveOrPublishChanges}` → `saveOrPublishChanges()`
- **Rewrite Button** (line 1065): `onClick={...handleUserAction(...)}` → `/api/returnExplanation`
- **Rewrite with Tags** (line 1116): `onClick={...handleUserAction(...)}` → `/api/returnExplanation`
- **Edit with Tags** (line 1127): `onClick={...handleUserAction(...)}` → `/api/returnExplanation`
- **View Match Button** (line 1008): `onClick={() => loadExplanation(...)}` → `getExplanationByIdAction()`

## Summary
- ✅ **Zero changes** to your existing 100+ functions
- ✅ **Only wrap exports** with `serverReadCorrelation()`
- ✅ **Logs auto-include** request IDs
- ✅ **Works client + server** with same interface
- ✅ **Easy debugging** - search by request ID