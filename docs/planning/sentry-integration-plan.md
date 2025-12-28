# Sentry Integration Plan for ExplainAnything

## Executive Summary

This plan outlines a comprehensive Sentry integration that will:
1. Capture server and client-side errors with full context
2. Integrate with existing logging and tracing infrastructure
3. Enable automatic bug detection and issue creation for Claude Code

---

## Current State Analysis

### Existing Observability Infrastructure
| Component | Current State | Sentry Integration Opportunity |
|-----------|---------------|-------------------------------|
| **Request Tracing** | `RequestIdContext` propagates IDs client→server | Map to Sentry transaction IDs |
| **Error Handling** | 13+ categorized error codes in `errorHandling.ts` | Use as Sentry tags/fingerprints |
| **Logging** | `withLogging` wrapper captures inputs/outputs/errors | Convert to Sentry breadcrumbs |
| **OpenTelemetry** | Grafana Cloud integration | Connect via Sentry-OTEL bridge |
| **File Logging** | `server.log` with structured JSON | Send to Sentry as attachments |

### Gap Analysis
| Missing Capability | Priority | Solution |
|-------------------|----------|----------|
| React Error Boundaries | High | Add `Sentry.ErrorBoundary` wrapper |
| Client JS error capture | High | Sentry browser SDK |
| Session Replay | Medium | Sentry Replay integration |
| Issue auto-creation | High | GitHub integration + Sentry API |
| **Client logs lost in production** | High | `/api/client-logs` is dev-only; need Sentry breadcrumbs |
| **394 existing logger calls** | High | Hook into logger functions directly |
| **Client context incomplete** | Medium | Client only has `requestId`, missing `userId`/`sessionId` |

### Current Logging Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SERVER SIDE                                  │
├─────────────────────────────────────────────────────────────────────┤
│  logger.info/error/warn/debug  →  Console + server.log file         │
│  (includes requestId, userId, sessionId from RequestIdContext)      │
│                                                                      │
│  withLogging() wrapper  →  Calls logger.info/error automatically    │
│  handleError()          →  Calls logger.error (NO Sentry currently) │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT SIDE                                  │
├─────────────────────────────────────────────────────────────────────┤
│  logger.info/error/warn/debug  →  Console ONLY                      │
│  (only includes requestId, NOT userId/sessionId)                     │
│                                                                      │
│  /api/client-logs endpoint  →  Returns 403 in production!           │
│  withClientLogging() wrapper  →  Calls logger.info/error            │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Insight**: Rather than adding parallel Sentry breadcrumb calls throughout the codebase, we should **modify the logger functions themselves** to also send to Sentry. This automatically captures all 394 existing logger calls.

---

## Phase 1: Core SDK Installation & Configuration

### 1.1 Install Sentry Packages

```bash
npm install @sentry/nextjs
```

This single package includes:
- `@sentry/node` for server-side
- `@sentry/react` for client-side
- Next.js specific integrations

### 1.2 Initialize Sentry with Wizard

```bash
npx @sentry/wizard@latest -i nextjs
```

This will create:
- `sentry.client.config.ts` - Browser SDK initialization
- `sentry.server.config.ts` - Node.js SDK initialization
- `sentry.edge.config.ts` - Edge runtime initialization
- `next.config.js` updates - Source map upload configuration

### 1.3 Configuration Files

**`sentry.client.config.ts`**
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment configuration
  environment: process.env.NODE_ENV,

  // Tracing
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
    Sentry.browserTracingIntegration(),
  ],

  // Custom configuration for existing infrastructure
  beforeSend(event) {
    // Attach requestId from our context system
    const requestId = window.__REQUEST_ID__;
    if (requestId) {
      event.tags = { ...event.tags, requestId };
    }
    return event;
  },

  // Ignore known non-actionable errors
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'Non-Error promise rejection captured',
  ],
});
```

**`sentry.server.config.ts`**
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Tracing
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  // Connect to OpenTelemetry
  instrumenter: "otel",

  integrations: [
    // Database query tracking
    Sentry.prismaIntegration(), // If using Prisma
  ],

  beforeSend(event, hint) {
    // Enrich with our error categorization
    const originalError = hint.originalException;
    if (originalError && typeof originalError === 'object' && 'code' in originalError) {
      event.tags = {
        ...event.tags,
        errorCode: (originalError as any).code,
      };
    }
    return event;
  },
});
```

### 1.4 Environment Variables

Add to `.env.local`:
```bash
# Sentry Configuration
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=your-auth-token
SENTRY_ORG=your-org
SENTRY_PROJECT=explainanything

# For source map uploads
SENTRY_RELEASE=explainanything@${npm_package_version}
```

---

## Phase 2: Error Handling Integration

### 2.1 Enhance `errorHandling.ts`

Modify the existing `handleError` function to report to Sentry:

```typescript
// src/lib/errorHandling.ts

import * as Sentry from "@sentry/nextjs";
import { RequestIdContext } from "./requestIdContext";

export function handleError(
  error: unknown,
  context: string,
  additionalData?: Record<string, any>
): ErrorResponse {
  const errorResponse = categorizeError(error);

  // Report to Sentry with full context
  Sentry.withScope((scope) => {
    // Add request context
    const requestContext = RequestIdContext.get();
    if (requestContext) {
      scope.setTag('requestId', requestContext.requestId);
      scope.setUser({ id: requestContext.userId });
      scope.setExtra('sessionId', requestContext.sessionId);
    }

    // Add error categorization
    scope.setTag('errorCode', errorResponse.code);
    scope.setContext('errorContext', {
      context,
      ...additionalData,
    });

    // Set severity based on error code
    scope.setLevel(getSentryLevel(errorResponse.code));

    // Capture the exception
    Sentry.captureException(error);
  });

  return errorResponse;
}

function getSentryLevel(code: ErrorCode): Sentry.SeverityLevel {
  const criticalErrors = ['DATABASE_ERROR', 'LLM_API_ERROR'];
  const warningErrors = ['TIMEOUT_ERROR', 'VALIDATION_ERROR'];

  if (criticalErrors.includes(code)) return 'error';
  if (warningErrors.includes(code)) return 'warning';
  return 'info';
}
```

### 2.2 Create React Error Boundary

**`src/components/SentryErrorBoundary.tsx`**
```typescript
'use client';

import * as Sentry from "@sentry/nextjs";
import { Component, ReactNode } from "react";
import { ErrorCard } from "./ErrorCard";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  eventId: string | null;
}

export class SentryErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, eventId: null };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true, eventId: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Sentry.withScope((scope) => {
      scope.setContext('react', {
        componentStack: errorInfo.componentStack,
      });
      const eventId = Sentry.captureException(error);
      this.setState({ eventId });
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorCard
          message="Something went wrong"
          eventId={this.state.eventId}
          onRetry={() => this.setState({ hasError: false, eventId: null })}
        />
      );
    }

    return this.props.children;
  }
}
```

### 2.3 Wrap Root Layout

**`src/app/layout.tsx`**
```typescript
import { SentryErrorBoundary } from "@/components/SentryErrorBoundary";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SentryErrorBoundary>
          {children}
        </SentryErrorBoundary>
      </body>
    </html>
  );
}
```

---

## Phase 3: Logging Integration (CRITICAL)

This phase ensures ALL existing logging flows to Sentry. The key is to **modify the logger functions themselves** rather than adding parallel calls.

### 3.1 Modify Server Logger (`server_utilities.ts`)

Hook Sentry breadcrumbs directly into the existing logger:

```typescript
// src/lib/server_utilities.ts
import * as Sentry from "@sentry/nextjs";
import { appendFileSync } from 'fs';
import { join } from 'path';
import { RequestIdContext } from './requestIdContext';

interface LoggerData {
    [key: string]: any;
}

const logFile = join(process.cwd(), 'server.log');

// Map our log levels to Sentry severity
const sentryLevelMap: Record<string, Sentry.SeverityLevel> = {
  'DEBUG': 'debug',
  'INFO': 'info',
  'WARN': 'warning',
  'ERROR': 'error'
};

// Helper function to add request context
const addRequestId = (data: LoggerData | null) => {
    const requestId = RequestIdContext.getRequestId();
    const userId = RequestIdContext.getUserId();
    const sessionId = RequestIdContext.getSessionId();
    return data ? { requestId, userId, sessionId, ...data } : { requestId, userId, sessionId };
};

// File logging with FLAT structure
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
        // Silently fail if file write fails
    }
}

// NEW: Send to Sentry as breadcrumb
function sendToSentry(level: string, message: string, data: LoggerData | null) {
    try {
        Sentry.addBreadcrumb({
            category: 'log',
            message: message,
            level: sentryLevelMap[level] || 'info',
            data: {
                ...data,
                requestId: RequestIdContext.getRequestId(),
                userId: RequestIdContext.getUserId(),
                sessionId: RequestIdContext.getSessionId(),
            },
            timestamp: Date.now() / 1000,
        });

        // For ERROR level, also capture as Sentry event (not just breadcrumb)
        if (level === 'ERROR') {
            Sentry.captureMessage(message, {
                level: 'error',
                extra: data || {},
                tags: {
                    requestId: RequestIdContext.getRequestId(),
                    userId: RequestIdContext.getUserId(),
                }
            });
        }
    } catch (e) {
        // Don't let Sentry errors break logging
    }
}

const logger = {
    debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
        if (!debug) return;
        console.log(`[DEBUG] ${message}`, addRequestId(data));
        writeToFile('DEBUG', message, data);
        sendToSentry('DEBUG', message, data);  // NEW
    },

    error: (message: string, data: LoggerData | null = null) => {
        console.error(`[ERROR] ${message}`, addRequestId(data));
        writeToFile('ERROR', message, data);
        sendToSentry('ERROR', message, data);  // NEW
    },

    info: (message: string, data: LoggerData | null = null) => {
        console.log(`[INFO] ${message}`, addRequestId(data));
        writeToFile('INFO', message, data);
        sendToSentry('INFO', message, data);  // NEW
    },

    warn: (message: string, data: LoggerData | null = null) => {
        console.warn(`[WARN] ${message}`, addRequestId(data));
        writeToFile('WARN', message, data);
        sendToSentry('WARN', message, data);  // NEW
    }
};

export { logger };
```

**Result**: All 394 existing `logger.info()`, `logger.error()`, etc. calls automatically flow to Sentry!

### 3.2 Modify Client Logger (`client_utilities.ts`)

The client logger currently only logs to console. In production, these logs are lost. Fix this:

```typescript
// src/lib/client_utilities.ts
import * as Sentry from "@sentry/nextjs";
import { RequestIdContext } from './requestIdContext';

interface LoggerData {
    [key: string]: any;
}

const sentryLevelMap: Record<string, Sentry.SeverityLevel> = {
  'DEBUG': 'debug',
  'INFO': 'info',
  'WARN': 'warning',
  'ERROR': 'error'
};

const addRequestId = (data: LoggerData | null) => {
    const requestId = RequestIdContext.getRequestId();
    const userId = RequestIdContext.getUserId();      // NEW: now available
    const sessionId = RequestIdContext.getSessionId(); // NEW: now available
    return data ? { requestId, userId, sessionId, ...data } : { requestId, userId, sessionId };
};

// NEW: Send to Sentry (works in production!)
function sendToSentry(level: string, message: string, data: LoggerData | null) {
    try {
        Sentry.addBreadcrumb({
            category: 'client-log',
            message: message,
            level: sentryLevelMap[level] || 'info',
            data: addRequestId(data),
            timestamp: Date.now() / 1000,
        });

        // For ERROR level, capture as Sentry event
        if (level === 'ERROR') {
            Sentry.captureMessage(message, {
                level: 'error',
                extra: data || {},
                tags: {
                    source: 'client',
                    requestId: RequestIdContext.getRequestId(),
                }
            });
        }
    } catch (e) {
        // Sentry not initialized or error - fail silently
    }
}

const logger = {
    debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
        if (!debug) return;
        console.log(`[DEBUG] ${message}`, addRequestId(data));
        sendToSentry('DEBUG', message, data);  // NEW
    },

    error: (message: string, data: LoggerData | null = null) => {
        console.error(`[ERROR] ${message}`, addRequestId(data));
        sendToSentry('ERROR', message, data);  // NEW
    },

    info: (message: string, data: LoggerData | null = null) => {
        console.log(`[INFO] ${message}`, addRequestId(data));
        sendToSentry('INFO', message, data);  // NEW
    },

    warn: (message: string, data: LoggerData | null = null) => {
        console.warn(`[WARN] ${message}`, addRequestId(data));
        sendToSentry('WARN', message, data);  // NEW
    }
};

export { logger };
```

### 3.3 Fix Client Context (userId/sessionId Missing)

**The Problem**: Server and client loggers capture different context:

```typescript
// SERVER (server_utilities.ts:33-38) - COMPLETE ✅
const addRequestId = (data) => {
    const requestId = RequestIdContext.getRequestId();
    const userId = RequestIdContext.getUserId();      // ✅ Captured
    const sessionId = RequestIdContext.getSessionId(); // ✅ Captured
    return { requestId, userId, sessionId, ...data };
};

// CLIENT (client_utilities.ts:15-18) - INCOMPLETE ❌
const addRequestId = (data) => {
    const requestId = RequestIdContext.getRequestId();
    // ❌ userId NOT captured
    // ❌ sessionId NOT captured
    return { requestId, ...data };
};
```

**Why This Matters for Sentry**:

| Capability | Without userId/sessionId | With full context |
|------------|--------------------------|-------------------|
| "Who had this error?" | ❌ Unknown | ✅ User ID visible |
| "Is this user having repeated issues?" | ❌ Can't track | ✅ Filter by user |
| "How many sessions affected?" | ❌ Can't count | ✅ Session metrics |
| "Contact affected users" | ❌ Impossible | ✅ Know who to contact |

**The Fix**: Your codebase already handles this correctly in `useAuthenticatedRequestId()` (in `clientPassRequestId.ts`):
- It fetches user from Supabase auth
- It creates/gets sessionId from localStorage
- It passes all three values via `__requestId` to server

The issue is that `client_utilities.ts` only reads `requestId`, ignoring the other values. Update the client logger to use full context:

```typescript
// src/lib/client_utilities.ts - update addRequestId
const addRequestId = (data: LoggerData | null) => {
    const requestId = RequestIdContext.getRequestId();
    const userId = RequestIdContext.getUserId();      // ADD THIS
    const sessionId = RequestIdContext.getSessionId(); // ADD THIS
    return data ? { requestId, userId, sessionId, ...data } : { requestId, userId, sessionId };
};
```

### 3.4 Server Log File Attachment on Errors

Attach recent server logs when an error is captured:

```typescript
// sentry.server.config.ts - add to beforeSend
import * as fs from 'fs';
import { join } from 'path';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // ... other config

  beforeSend(event, hint) {
    // Only attach logs for actual errors, not breadcrumbs
    if (event.level === 'error' || event.exception) {
      try {
        const logPath = join(process.cwd(), 'server.log');
        const logContent = fs.readFileSync(logPath, 'utf8');
        const lines = logContent.split('\n');

        // Get last 50 log lines related to this request
        const requestId = event.tags?.requestId;
        let relevantLogs: string[];

        if (requestId) {
          // Filter logs for this specific request
          relevantLogs = lines
            .filter(line => line.includes(requestId))
            .slice(-50);
        } else {
          // Just get the last 50 lines
          relevantLogs = lines.slice(-50);
        }

        // Add as attachment
        event.attachments = event.attachments || [];
        event.attachments.push({
          filename: 'server-logs.txt',
          data: relevantLogs.join('\n'),
          contentType: 'text/plain',
        });
      } catch (e) {
        // Log file not available, continue without attachment
      }
    }

    return event;
  },
});
```

### 3.5 withLogging Wrapper Enhancement (Optional)

The `withLogging` wrapper already calls `logger.info()` and `logger.error()`, so with our changes above, it automatically sends to Sentry. However, we can add richer context:

```typescript
// In automaticServerLoggingBase.ts, enhance the logging to include span info:

// Add at the start of the wrapped function:
logger.info(`Function ${functionName} called`, {
  inputs: sanitizedArgs,
  timestamp: new Date().toISOString(),
  spanType: 'function-start',  // NEW: helps identify function boundaries in breadcrumbs
});

// On success:
logger.info(`Function ${functionName} completed successfully`, {
  outputs: sanitizedResult,
  duration: `${duration}ms`,
  timestamp: new Date().toISOString(),
  spanType: 'function-end',  // NEW
});

// On error:
logger.error(`Function ${functionName} failed`, {
  error: error instanceof Error ? error.message : String(error),
  duration: `${duration}ms`,
  timestamp: new Date().toISOString(),
  spanType: 'function-error',  // NEW
});
```

---

## Phase 4: Request Context Integration

Your codebase already has a sophisticated request context system. We need to **bridge it to Sentry**.

### Current Flow (Without Sentry)

```
CLIENT                                    SERVER
───────                                   ──────
useAuthenticatedRequestId()
  └─→ withRequestId(data)
        └─→ RequestIdContext.setClient()  ──→  serverReadRequestId(fn)
        └─→ {...data, __requestId}               └─→ RequestIdContext.run()
                                                       └─→ logger has context ✅
                                                       └─→ Sentry has NO context ❌
```

### Target Flow (With Sentry)

```
CLIENT                                    SERVER
───────                                   ──────
useAuthenticatedRequestId()
  └─→ withRequestId(data)
        └─→ RequestIdContext.setClient()  ──→  serverReadRequestId(fn)
        └─→ Sentry.setUser/setTag ✅            └─→ RequestIdContext.run()
        └─→ {...data, __requestId}                   └─→ Sentry.withScope() ✅
                                                       └─→ logger has context ✅
                                                       └─→ Sentry has context ✅
```

### 4.1 Server: Modify `serverReadRequestId.ts`

This is the single integration point for ALL server actions:

```typescript
// src/lib/serverReadRequestId.ts
import * as Sentry from "@sentry/nextjs";
import { RequestIdContext } from './requestIdContext';
import { randomUUID } from 'crypto';

export function serverReadRequestId<T extends (...args: any[]) => any>(fn: T): T {
  return (async (...args) => {
    const clientData = args[0]?.__requestId;
    const requestIdData = {
      requestId: clientData?.requestId || randomUUID(),
      userId: clientData?.userId || 'anonymous',
      sessionId: clientData?.sessionId || 'unknown'
    };

    if (args[0]?.__requestId) {
      delete args[0].__requestId;
    }

    // NEW: Set Sentry context for this request
    return Sentry.withScope(async (scope) => {
      // Set user (enables "Users Affected" metric in Sentry)
      scope.setUser({ id: requestIdData.userId });

      // Set tags (searchable/filterable in Sentry UI)
      scope.setTag('requestId', requestIdData.requestId);
      scope.setTag('sessionId', requestIdData.sessionId);

      // Set context (visible in error details)
      scope.setContext('request', {
        requestId: requestIdData.requestId,
        userId: requestIdData.userId,
        sessionId: requestIdData.sessionId,
        source: 'server-action',
      });

      // Run with both RequestIdContext AND Sentry context
      return RequestIdContext.run(requestIdData, async () => await fn(...args));
    });
  }) as T;
}
```

**Result**: All 50+ server actions automatically get Sentry context!

### 4.2 Client: Modify `clientPassRequestId.ts`

Set Sentry context when client generates request:

```typescript
// src/hooks/clientPassRequestId.ts
import * as Sentry from "@sentry/nextjs";
import { RequestIdContext } from '@/lib/requestIdContext';
// ... existing imports

export function useClientPassRequestId(userId = 'anonymous', sessionId?: string) {
  // ... existing code

  const withRequestId = useCallback(<T extends Record<string, any> = {}>(data?: T) => {
    const requestId = generateRequestId();
    const effectiveSessionId = sessionId ?? getOrCreateAnonymousSessionId();

    // Set client requestId context persistently
    RequestIdContext.setClient({ requestId, userId, sessionId: effectiveSessionId });

    // NEW: Also set Sentry context
    Sentry.setUser({ id: userId });
    Sentry.setTag('requestId', requestId);
    Sentry.setTag('sessionId', effectiveSessionId);
    Sentry.setContext('request', {
      requestId,
      userId,
      sessionId: effectiveSessionId,
      source: 'client',
    });

    return {
      ...(data || {} as T),
      __requestId: { requestId, userId, sessionId: effectiveSessionId }
    } as T & { __requestId: { requestId: string; userId: string; sessionId: string } };
  }, [userId, sessionId, generateRequestId]);

  return { withRequestId };
}
```

### 4.3 API Routes: Add Sentry Scope

For API routes (not using `serverReadRequestId`), add Sentry context manually:

```typescript
// src/app/api/returnExplanation/route.ts
import * as Sentry from "@sentry/nextjs";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { __requestId, ...rest } = body;

  const requestIdData = {
    requestId: __requestId?.requestId || randomUUID(),
    userId: __requestId?.userId || 'anonymous',
    sessionId: __requestId?.sessionId || 'unknown',
  };

  // Wrap entire request in Sentry scope
  return Sentry.withScope(async (scope) => {
    scope.setUser({ id: requestIdData.userId });
    scope.setTag('requestId', requestIdData.requestId);
    scope.setTag('sessionId', requestIdData.sessionId);
    scope.setTag('endpoint', 'returnExplanation');
    scope.setContext('request', requestIdData);

    return RequestIdContext.run(requestIdData, async () => {
      // ... existing logic
    });
  });
}
```

### 4.4 Correlation Diagram

After integration, all errors will be correlated:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SENTRY ERROR VIEW                                │
├─────────────────────────────────────────────────────────────────────────┤
│  Error: LLM_API_ERROR - OpenAI rate limit exceeded                      │
│                                                                          │
│  Tags:                                                                   │
│    requestId: client-1703847234-x8k2m1                                  │
│    sessionId: auth-a3f2b9c1e4d8                                          │
│    errorCode: LLM_API_ERROR                                              │
│    endpoint: returnExplanation                                           │
│                                                                          │
│  User: user-456                                                          │
│                                                                          │
│  Breadcrumbs (from logger integration):                                  │
│    12:34:01 [INFO] Function returnExplanation called                     │
│    12:34:02 [INFO] Vector search completed (45ms)                        │
│    12:34:03 [INFO] Calling OpenAI GPT-4                                  │
│    12:34:05 [ERROR] OpenAI API error: rate limit exceeded                │
│                                                                          │
│  Attachments:                                                            │
│    📎 server-logs.txt (filtered by requestId)                            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 5: Tracing Integration

### Current State: OpenTelemetry → Grafana Cloud

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      EXISTING TRACING (instrumentation.ts)               │
├─────────────────────────────────────────────────────────────────────────┤
│  Custom Tracers:                                                         │
│    • llmTracer      → LLM/OpenAI calls                                  │
│    • dbTracer       → Supabase queries                                  │
│    • vectorTracer   → Pinecone operations                               │
│    • appTracer      → Application logic                                 │
│                                                                          │
│  Auto-instrumented:                                                      │
│    • fetch() calls to pinecone.io → vectorTracer spans                  │
│    • fetch() calls to supabase.co → dbTracer spans                      │
│                                                                          │
│  Destination: OTEL_EXPORTER_OTLP_ENDPOINT → Grafana Cloud               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Tracing Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A: Sentry Native (Recommended)** | Use Sentry's built-in tracing | Zero config, auto-instruments Next.js | Separate from Grafana traces |
| **B: OTEL Bridge** | Send existing OTEL traces to Sentry | Single source of truth | Complex setup, dual destinations |
| **C: Sentry Only** | Replace Grafana with Sentry | Unified platform | Migration effort, lose Grafana |

### Recommended: Option A (Sentry Native + Keep Grafana)

Use **Sentry for error-correlated traces** and **Grafana for detailed performance monitoring**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AFTER INTEGRATION                                │
├─────────────────────────────────────────────────────────────────────────┤
│  SENTRY (Error Tracking + Basic Traces):                                │
│    • Auto-traces Next.js routes, API handlers                           │
│    • Auto-traces fetch() calls                                          │
│    • Errors include trace context (what happened before error)          │
│    • Session Replay shows user actions                                  │
│                                                                          │
│  GRAFANA (Detailed Performance):                                         │
│    • Your custom OTEL spans (LLM, DB, Vector)                           │
│    • Detailed timing breakdowns                                          │
│    • Long-term performance trends                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Enable Sentry Native Tracing

Sentry's `@sentry/nextjs` automatically instruments:
- Next.js App Router (routes, layouts, API handlers)
- `fetch()` calls (client and server)
- Database queries (with integrations)

```typescript
// sentry.server.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Enable tracing - this is the key setting
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  // Sentry will auto-instrument:
  // - All API routes (/api/*)
  // - All page routes
  // - All fetch() calls
  // - Database queries
});
```

```typescript
// sentry.client.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Enable browser tracing
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  integrations: [
    Sentry.browserTracingIntegration(),
  ],
});
```

### 5.2 Add Custom Spans for Key Operations

While Sentry auto-instruments fetch, add custom spans for business-critical operations:

```typescript
// src/lib/services/llms.ts
import * as Sentry from "@sentry/nextjs";

export async function generateExplanation(query: string): Promise<string> {
  return Sentry.startSpan(
    {
      name: 'generateExplanation',
      op: 'llm.generate',
      attributes: {
        'llm.model': 'gpt-4',
        'llm.prompt_length': query.length,
      },
    },
    async (span) => {
      const result = await openai.chat.completions.create({...});

      // Add result attributes
      span.setAttribute('llm.tokens_used', result.usage?.total_tokens || 0);
      span.setAttribute('llm.response_length', result.choices[0]?.message?.content?.length || 0);

      return result.choices[0]?.message?.content || '';
    }
  );
}
```

```typescript
// src/lib/services/vectorsim.ts
import * as Sentry from "@sentry/nextjs";

export async function searchVectors(embedding: number[], topK: number) {
  return Sentry.startSpan(
    {
      name: 'vectorSearch',
      op: 'vector.search',
      attributes: {
        'vector.top_k': topK,
        'vector.dimension': embedding.length,
      },
    },
    async (span) => {
      const results = await pinecone.query({...});

      span.setAttribute('vector.results_count', results.matches?.length || 0);
      span.setAttribute('vector.top_score', results.matches?.[0]?.score || 0);

      return results;
    }
  );
}
```

### 5.3 Trace Visualization in Sentry

After integration, a request trace in Sentry will look like:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TRACE: POST /api/returnExplanation                                      │
│  Duration: 3.2s                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ├─ POST /api/returnExplanation ─────────────────────────── 3.2s        │
│  │   │                                                                   │
│  │   ├─ vectorSearch ────────────────────── 145ms                       │
│  │   │   └─ fetch pinecone.io/query ─────── 142ms                       │
│  │   │                                                                   │
│  │   ├─ generateExplanation ─────────────── 2.8s                        │
│  │   │   └─ fetch api.openai.com ────────── 2.7s                        │
│  │   │                                                                   │
│  │   └─ db.insert ───────────────────────── 85ms                        │
│  │       └─ fetch supabase.co ───────────── 82ms                        │
│                                                                          │
│  Breadcrumbs:                                                            │
│    • [INFO] Function returnExplanation called                            │
│    • [INFO] Vector search completed (145ms)                              │
│    • [INFO] Calling OpenAI GPT-4                                         │
│    • [INFO] Explanation generated (2.8s)                                 │
│    • [INFO] Saved to database                                            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.4 Link Traces to Errors

When an error occurs, Sentry automatically attaches the trace:

```typescript
// This happens automatically - no code needed
// When an error is thrown inside a traced operation,
// Sentry links the error to the trace

Sentry.startSpan({ name: 'myOperation', op: 'custom' }, async () => {
  // If this throws, the error will include:
  // - The trace ID
  // - The span where it occurred
  // - All parent spans
  // - All breadcrumbs
  throw new Error('Something went wrong');
});
```

### 5.5 (Optional) OTEL Bridge for Unified Traces

If you want your existing OTEL traces to appear in Sentry (instead of just Grafana):

```typescript
// sentry.server.config.ts
Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Tell Sentry to read from OTEL instead of its own instrumentation
  instrumenter: "otel",

  tracesSampleRate: 0.2,
});
```

Then in `instrumentation.ts`, add Sentry as a span processor:

```typescript
// instrumentation.ts
import { SentrySpanProcessor } from "@sentry/opentelemetry";

export async function register() {
  // Import Sentry config (initializes Sentry with OTEL mode)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  // Your existing OTEL setup continues...
  // Traces now go to BOTH Grafana AND Sentry
}
```

**Note**: This requires `@sentry/opentelemetry` package and more complex setup. Only use if you need unified traces across both platforms.

---

## Phase 6: Automatic Issue Creation for Claude Code

### 6.1 Sentry → GitHub Integration

Configure in Sentry Dashboard:
1. **Settings → Integrations → GitHub**
2. Enable repository linking
3. Configure issue auto-creation rules

### 6.2 Custom Issue Template

Create GitHub issue template for Sentry-generated issues:

**`.github/ISSUE_TEMPLATE/sentry-bug.md`**
```markdown
---
name: Sentry Bug Report
about: Auto-generated from Sentry error tracking
title: '[SENTRY] {{ title }}'
labels: bug, sentry, claude-code
assignees: ''
---

## Sentry Error Report

**Error ID:** {{ eventId }}
**First Seen:** {{ firstSeen }}
**Occurrences:** {{ count }}

### Error Details
```
{{ errorMessage }}
```

### Stack Trace
```
{{ stackTrace }}
```

### Context
- **Request ID:** {{ requestId }}
- **User ID:** {{ userId }}
- **Error Code:** {{ errorCode }}
- **Environment:** {{ environment }}

### Breadcrumbs
{{ breadcrumbs }}

### Claude Code Instructions
This issue was automatically created from a Sentry error. To fix:
1. Review the stack trace and error context
2. Check the breadcrumbs for user actions leading to the error
3. Implement a fix with appropriate error handling
4. Add tests to prevent regression

[View in Sentry]({{ sentryLink }})
```

### 6.3 Sentry Alert Rules

Configure in Sentry:

```yaml
# Alert for new issues
- name: "New High-Priority Issue"
  conditions:
    - type: first_seen_event
  filters:
    - type: level
      value: error
  actions:
    - type: create_github_issue
      integration: github
      repo: your-org/explainanything
      labels: ["bug", "sentry", "claude-code"]

# Alert for regressions
- name: "Issue Regression"
  conditions:
    - type: regression_event
  actions:
    - type: create_github_issue
      integration: github
      labels: ["regression", "sentry", "claude-code"]
```

### 6.4 Webhook for Custom Processing

**`src/app/api/sentry-webhook/route.ts`**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  const signature = request.headers.get('sentry-hook-signature');
  // Verify webhook signature...

  const payload = await request.json();

  if (payload.action === 'created' && payload.data.issue) {
    const issue = payload.data.issue;

    // Create GitHub issue with Claude Code context
    const githubIssue = await createGitHubIssue({
      title: `[BUG] ${issue.title}`,
      body: formatIssueBody(issue),
      labels: ['bug', 'sentry', 'claude-code'],
    });

    // Log for tracking
    console.log('Created GitHub issue:', githubIssue.number);
  }

  return NextResponse.json({ received: true });
}

function formatIssueBody(issue: any): string {
  return `
## Sentry Error: ${issue.title}

**Error ID:** ${issue.id}
**Occurrences:** ${issue.count}
**Users Affected:** ${issue.userCount}

### Error Message
\`\`\`
${issue.metadata.value || issue.culprit}
\`\`\`

### Context
${JSON.stringify(issue.context, null, 2)}

### Claude Code Instructions
Use the error context above to:
1. Identify the root cause
2. Implement a fix with proper error handling
3. Add error boundary if it's a React component error
4. Add tests to prevent regression

[View in Sentry](https://sentry.io/organizations/your-org/issues/${issue.id}/)
`;
}
```

---

## Phase 7: Advanced Features

### 7.1 Performance Monitoring

```typescript
// src/lib/sentryPerformance.ts
import * as Sentry from "@sentry/nextjs";

export function measureOperation<T>(
  name: string,
  operation: () => Promise<T>,
  category: 'llm' | 'db' | 'vector' | 'compute'
): Promise<T> {
  return Sentry.startSpan(
    { name, op: category },
    async (span) => {
      try {
        const result = await operation();
        span.setStatus({ code: 1, message: 'ok' });
        return result;
      } catch (error) {
        span.setStatus({ code: 2, message: (error as Error).message });
        throw error;
      }
    }
  );
}

// Usage example
const explanation = await measureOperation(
  'generate-explanation',
  () => generateExplanation(query),
  'llm'
);
```

### 7.2 User Feedback Widget

```typescript
// src/components/FeedbackButton.tsx
'use client';

import * as Sentry from "@sentry/nextjs";

export function FeedbackButton() {
  const handleFeedback = () => {
    Sentry.showReportDialog({
      eventId: Sentry.lastEventId(),
      title: 'Report an Issue',
      subtitle: 'Help us improve ExplainAnything',
      labelComments: 'What happened?',
    });
  };

  return (
    <button onClick={handleFeedback}>
      Report Issue
    </button>
  );
}
```

### 7.3 Custom Metrics

```typescript
// src/lib/sentryMetrics.ts
import * as Sentry from "@sentry/nextjs";

export const metrics = {
  // Track LLM usage
  trackLLMCall: (model: string, tokens: number, duration: number) => {
    Sentry.setMeasurement('llm.tokens', tokens, 'none');
    Sentry.setMeasurement('llm.duration', duration, 'millisecond');
  },

  // Track vector search performance
  trackVectorSearch: (results: number, duration: number) => {
    Sentry.setMeasurement('vector.results', results, 'none');
    Sentry.setMeasurement('vector.duration', duration, 'millisecond');
  },

  // Track explanation generation
  trackExplanation: (charCount: number, duration: number) => {
    Sentry.setMeasurement('explanation.length', charCount, 'none');
    Sentry.setMeasurement('explanation.duration', duration, 'millisecond');
  },
};
```

---

## Implementation Checklist

### Phase 1: Core Setup
- [ ] Run `npx @sentry/wizard@latest -i nextjs`
- [ ] Configure `sentry.client.config.ts`
- [ ] Configure `sentry.server.config.ts`
- [ ] Add environment variables to `.env.local` and production
- [ ] Verify source map uploads work in CI/CD

### Phase 2: Error Handling
- [ ] Enhance `handleError()` in `src/lib/errorHandling.ts` with Sentry reporting
- [ ] Create `SentryErrorBoundary` component
- [ ] Wrap root layout (`src/app/layout.tsx`) with error boundary
- [ ] Test error capture in development

### Phase 3: Logging Integration (CRITICAL - captures all 394 existing log calls)
- [ ] Modify `src/lib/server_utilities.ts` to add `sendToSentry()` function
- [ ] Modify `src/lib/client_utilities.ts` to add `sendToSentry()` function
- [ ] Update client-side code to set full context (userId, sessionId) on `RequestIdContext`
- [ ] Add server log file attachment in `sentry.server.config.ts` `beforeSend`
- [ ] Verify breadcrumb trail appears in Sentry for a test error
- [ ] Test that `logger.error()` calls create Sentry events

### Phase 4: Request Context
- [ ] Integrate `RequestIdContext.run()` with Sentry tags/user context
- [ ] Add Sentry scope to API routes (especially `/api/returnExplanation`)
- [ ] Verify request correlation in Sentry (all events from same request grouped)

### Phase 5: OpenTelemetry Bridge (Optional - depends on needs)
- [ ] Evaluate if dual Grafana + Sentry is needed or if Sentry replaces Grafana
- [ ] If keeping both: Configure OTEL-Sentry integration via `instrumenter: "otel"`
- [ ] Link trace IDs between systems
- [ ] Verify traces appear in both Grafana and Sentry

### Phase 6: Automatic Issue Creation
- [ ] Create Sentry project and configure GitHub integration
- [ ] Create issue template `.github/ISSUE_TEMPLATE/sentry-bug.md`
- [ ] Set up Sentry Alert Rules for new errors
- [ ] Set up Sentry Alert Rules for regressions
- [ ] Test end-to-end: trigger error → verify GitHub issue created with `claude-code` label

### Phase 7: Advanced Features (Nice-to-have)
- [ ] Add performance monitoring for LLM calls, vector searches
- [ ] Implement user feedback widget
- [ ] Set up custom metrics dashboard
- [ ] Configure Session Replay for production debugging

---

## Configuration Reference

### Recommended Sentry Project Settings

| Setting | Development | Production |
|---------|-------------|------------|
| `tracesSampleRate` | 1.0 | 0.2 |
| `replaysSessionSampleRate` | 0.0 | 0.1 |
| `replaysOnErrorSampleRate` | 1.0 | 1.0 |
| `attachStacktrace` | true | true |
| `maxBreadcrumbs` | 100 | 50 |
| `debug` | true | false |

### Alert Rule Suggestions

| Alert Name | Trigger | Action |
|------------|---------|--------|
| New Critical Error | First seen, level=error | Create GitHub issue, Slack notification |
| Error Spike | >10 errors in 5 min | Slack notification |
| Performance Regression | p95 > 5s | Email notification |
| Regression | Previously resolved error | Create GitHub issue |

---

## Security Considerations

1. **PII Scrubbing**: Configure `beforeSend` to redact sensitive fields
2. **Source Maps**: Keep auth tokens in CI/CD secrets only
3. **DSN Security**: Use `NEXT_PUBLIC_SENTRY_DSN` carefully (client-exposed)
4. **Session Replay**: Review `maskAllText` settings for sensitive content

---

## Testing the Integration

### Manual Testing Checklist

```typescript
// Test error capture
throw new Error('Test Sentry integration');

// Test breadcrumb trail
logger.info('Step 1');
logger.info('Step 2');
throw new Error('Error after breadcrumbs');

// Test context propagation
RequestIdContext.run({ requestId: 'test-123' }, () => {
  throw new Error('Error with context');
});
```

### E2E Test Additions

```typescript
// __tests__/e2e/specs/sentry-integration.spec.ts
test('captures client error and sends to Sentry', async ({ page }) => {
  // Trigger an error
  await page.evaluate(() => {
    throw new Error('E2E test error');
  });

  // Verify Sentry received the error (via mock/stub)
  // ...
});
```

---

## Monitoring Dashboard

### Key Metrics to Track

1. **Error Rate**: Errors per 1000 requests
2. **Error Types**: Distribution by `errorCode`
3. **Response Time**: p50, p95, p99 for API routes
4. **User Impact**: Unique users affected by errors
5. **LLM Performance**: Token usage, response times
6. **Vector Search**: Query latency, result counts

### Sentry Dashboard Widgets

1. **Issue Stream**: Real-time error feed
2. **Release Health**: Error rate per deployment
3. **Performance**: Transaction duration trends
4. **User Feedback**: Submitted feedback reports

---

## Cost Estimation

| Feature | Free Tier | Team Tier ($26/mo) | Business ($80/mo) |
|---------|-----------|--------------------|--------------------|
| Errors | 5k/mo | 50k/mo | 100k/mo |
| Performance | Limited | Full | Full |
| Session Replay | 50/mo | 500/mo | 1500/mo |
| Attachments | 1GB | 10GB | 100GB |

**Recommendation**: Start with Team tier for production use.
