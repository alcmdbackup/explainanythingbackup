# Request ID Implementation

## Files to Change

### New Files
- `src/lib/requestIdContext.ts` - Provides AsyncLocalStorage context for storing/retrieving request ID data across async calls
- `src/lib/serverReadRequestId.ts` - Wraps server actions to extract request ID data from client and set up server context
- `src/hooks/clientPassRequestId.ts` - React hook that injects request ID data into server action calls

### Existing Files
- `src/lib/server_utilities.ts` - Update writeToFile() to automatically read request ID from AsyncLocalStorage
- `src/lib/client_utilities.ts` - Update logger calls to include request ID data from context
- `src/actions/actions.ts` - Wrap server action exports with serverReadRequestId to enable tracking
- Client components - Use clientPassRequestId hook to send request ID data to server actions

## How requestIdContext.ts Works

This file creates a **universal request ID system** that works on both client and server using different storage mechanisms.

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
    const prev = clientRequestId;
    clientRequestId = data;
    try {
      return callback();
    } finally {
      clientRequestId = prev; // Always restore previous value
    }
  }
}
```

**What `run()` does:**
- **Server:** Creates AsyncLocalStorage "bubble" with request ID data
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
- Your logger calls `RequestIdContext.getRequestId()`
- It automatically detects client vs server
- Returns the requestId data from the right storage

### The Flow
1. **Client:** `withCorrelation()` calls `RequestIdContext.run()`
2. **Server:** `serverReadCorrelation()` calls `RequestIdContext.run()`
3. **Anywhere:** `logger.info()` calls `RequestIdContext.getRequestId()`
4. **Magic:** It automatically returns the right ID from the right storage

**Key Insight:** Same interface, different storage mechanisms, automatic detection. Your code just calls `getRequestId()` and it works everywhere.

## The Magic
AsyncLocalStorage (server) + module tracking (client) automatically carries request IDs through your code without changing function signatures.

## 1. Create Request ID Context (`src/lib/requestIdContext.ts`)
```typescript
import { AsyncLocalStorage } from 'async_hooks';

// Server-side storage
const storage = new AsyncLocalStorage<{ requestId: string; userId: string }>();

// Client-side tracking
let clientRequestId = { requestId: 'unknown', userId: 'anonymous' };

export class RequestIdContext {
  static run<T>(data: { requestId: string; userId: string }, callback: () => T): T {
    if (typeof window === 'undefined') {
      // Server: use AsyncLocalStorage
      return storage.run(data, callback);
    } else {
      // Client: use module variable
      const prev = clientRequestId;
      clientRequestId = data;
      try {
        return callback();
      } finally {
        clientRequestId = prev;
      }
    }
  }

  static get() {
    return typeof window === 'undefined'
      ? storage.getStore()
      : clientRequestId;
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
import { RequestIdContext } from './requestIdContext';

// Helper function to add request ID to data
const addRequestId = (data: LoggerData | null) => {
    const requestId = RequestIdContext.getRequestId();
    const userId = RequestIdContext.getUserId();
    return data ? { requestId, userId, ...data } : { requestId, userId };
};

// Update writeToFile function:
function writeToFile(level: string, message: string, data: LoggerData | null) {
    const timestamp = new Date().toISOString();
    const requestIdData = {
        requestId: RequestIdContext.getRequestId(),
        userId: RequestIdContext.getUserId()
    };

    const logEntry = JSON.stringify({
        timestamp, level, message,
        data: data || {},
        requestId: requestIdData
    }) + '\n';

    try {
        appendFileSync(logFile, logEntry);
    } catch (error) {
        // Silently fail
    }
}

// Update logger to include request ID in console output:
const logger = {
    debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
        if (!debug) return;
        console.log(`[DEBUG] ${message}`, addRequestId(data));
        writeToFile('DEBUG', message, data);
    },

    error: (message: string, data: LoggerData | null = null) => {
        console.error(`[ERROR] ${message}`, addRequestId(data));
        writeToFile('ERROR', message, data);
    },

    info: (message: string, data: LoggerData | null = null) => {
        console.log(`[INFO] ${message}`, addRequestId(data));
        writeToFile('INFO', message, data);
    },

    warn: (message: string, data: LoggerData | null = null) => {
        console.warn(`[WARN] ${message}`, addRequestId(data));
        writeToFile('WARN', message, data);
    }
};
```

## 3. Update Client Logger (`src/lib/client_utilities.ts`)
```typescript
import { RequestIdContext } from './requestIdContext';

// Helper function to add request ID to data
const addRequestId = (data: LoggerData | null) => {
    const requestId = RequestIdContext.getRequestId();
    return data ? { requestId, ...data } : { requestId };
};

const logger = {
    debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
        if (!debug) return;
        console.log(`[DEBUG] ${message}`, addRequestId(data));
    },

    error: (message: string, data: LoggerData | null = null) => {
        console.error(`[ERROR] ${message}`, addRequestId(data));
    },

    info: (message: string, data: LoggerData | null = null) => {
        console.log(`[INFO] ${message}`, addRequestId(data));
    },

    warn: (message: string, data: LoggerData | null = null) => {
        console.warn(`[WARN] ${message}`, addRequestId(data));
    }
};
```

## 4. Server Action Wrapper (`src/lib/serverReadRequestId.ts`)
```typescript
import { RequestIdContext } from './requestIdContext';
import { randomUUID } from 'crypto';

export function serverReadRequestId<T extends (...args: any[]) => any>(fn: T): T {
  return (async (...args) => {
    const requestIdData = args[0]?.__requestId || {
      requestId: randomUUID(),
      userId: 'anonymous'
    };

    if (args[0]?.__requestId) {
      delete args[0].__requestId;
    }

    return RequestIdContext.run(requestIdData, () => fn(...args));
  }) as T;
}
```

## 5. Update Your Server Actions (`src/actions/actions.ts`)
```typescript
import { serverReadRequestId } from '@/lib/serverReadRequestId';

// Your existing functions stay exactly the same
const _saveExplanationAndTopic = withLogging(
    async function saveExplanationAndTopic(userQuery: string, explanationData: any) {
        // ZERO CHANGES - logger.info() now auto-includes requestId
        logger.info("Saving explanation and topic");
        // ... rest of your code unchanged
    },
    'saveExplanationAndTopic',
    { enabled: FILE_DEBUG }
);

// Only change: wrap the export
export const saveExplanationAndTopic = serverReadRequestId(_saveExplanationAndTopic);
```

## 6. Client Request ID Hook (`src/hooks/clientPassRequestId.ts`)
```typescript
'use client';
import { RequestIdContext } from '@/lib/requestIdContext';
import { useCallback } from 'react';

export function clientPassRequestId(userId = 'anonymous') {
  const generateRequestId = useCallback(() =>
    `client-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    []
  );

  const withRequestId = useCallback((data = {}) => {
    const requestId = generateRequestId(); // New ID for each action!

    // Set client requestId context
    RequestIdContext.run({ requestId, userId }, () => {});

    return {
      ...data,
      __requestId: { requestId, userId }
    };
  }, [userId, generateRequestId]);

  return { withRequestId };
}
```

## 7. Client Component Usage
```typescript
'use client';
import { clientPassRequestId } from '@/hooks/clientPassRequestId';
import { saveExplanationAndTopic } from '@/actions/actions';

export default function MyComponent() {
  const { withRequestId } = clientPassRequestId('user123');

  const handleSave = async () => {
    // Each call gets a new request ID for separate tracing
    await saveExplanationAndTopic(withRequestId({
      userQuery: "test",
      explanationData: { title: "Test" }
    })); // → requestId: "client-1729425600000-abc123"
  };

  const handleEdit = async () => {
    // Different action = different request ID
    await editExplanation(withRequestId({
      explanationId: 123,
      newContent: "Updated content"
    })); // → requestId: "client-1729425605000-def456"
  };
}
```

## Result
Your logs automatically become request ID tracked:

**Server logs:**
```json
{
  "timestamp": "2024-10-20T10:30:00Z",
  "level": "INFO",
  "message": "Saving explanation and topic",
  "requestId": { "requestId": "client-abc-123", "userId": "user123" }
}
```

**Client logs:**
```
[INFO] User clicked save { requestId: { requestId: "client-abc-123" } }
```

**Search logs:**
```bash
grep '"requestId":"client-abc-123"' server.log
```

## Button Click Locations to Wrap

These are the exact locations in `src/app/results/page.tsx` where client actions need `withRequestId()` wrapping:

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