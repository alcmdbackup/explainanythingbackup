# Sentry Integration Plan for ExplainAnything

## Overview

Integrate Sentry for error tracking, performance monitoring, and automated issue creation while keeping Grafana for detailed OTEL traces.

**Key Decisions:**
- **Server actions:** Use `Sentry.withScope()` inside `serverReadRequestId` (one change captures all 50+ actions)
- **Error flow:** `handleError()` sends Sentry events; `logger.*` sends breadcrumbs only (no duplicates)
- **Tracing:** Grafana for detailed perf traces, Sentry for error-correlated traces (separate)
- **Tunneling:** Route through `/api/monitoring` to bypass ad blockers

---

## Current State → After Sentry

| Component | Current | After Sentry |
|-----------|---------|--------------|
| Server logging | Console + `server.log` | + Sentry breadcrumbs |
| Client logging | Console only (lost in prod) | + Sentry breadcrumbs |
| Error handling | `handleError()` categorizes errors | + Sentry events with context |
| Request context | `RequestIdContext` (requestId, userId, sessionId) | Bridged to Sentry tags |
| OTEL tracing | Grafana Cloud | Keep unchanged (Sentry separate) |

---

## Phase 1: Core Setup

**Goal:** Get Sentry running with basic error capture
**Test:** Trigger an error → verify it appears in Sentry dashboard

### 1.1 Install SDK

```bash
npx @sentry/wizard@latest -i nextjs
```

The wizard creates:
- `sentry.client.config.ts` → Client initialization
- `sentry.server.config.ts` → Server initialization
- `sentry.edge.config.ts` → Edge runtime
- Updates to `next.config.ts` → Source maps

### 1.2 Environment Variables

Add to `.env.local`:

```bash
# Required
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=<from Sentry dashboard>
SENTRY_ORG=<your org>
SENTRY_PROJECT=explainanything

# Optional rate overrides (defaults shown)
SENTRY_TRACES_SAMPLE_RATE=0.2
SENTRY_REPLAYS_SESSION_RATE=0.1
SENTRY_REPLAYS_ERROR_RATE=1.0
```

### 1.3 Update instrumentation.ts (CRITICAL)

The `register()` function must import Sentry configs for initialization:

```typescript
import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Initialize Sentry based on runtime (MUST be first)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }

  // ... existing OTEL setup below (unchanged)
}

// Capture React Server Component errors
export const onRequestError = Sentry.captureRequestError;
```

### 1.4 Create Global Error Boundary

Create `src/app/global-error.tsx`:

```tsx
"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <h1>Something went wrong</h1>
        <button onClick={() => window.location.reload()}>Try again</button>
      </body>
    </html>
  );
}
```

### 1.5 Configure Sentry Configs

Update wizard-generated configs:

**sentry.server.config.ts:**
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ||
    (process.env.NODE_ENV === 'production' ? '0.2' : '1.0')
  ),
  beforeSend(event) {
    // Filter known noise
    const message = event.exception?.values?.[0]?.value || '';
    if (message.includes('ResizeObserver') || message.includes('Non-Error promise rejection')) {
      return null;
    }
    return event;
  },
});
```

**sentry.client.config.ts:**
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tunnel: '/api/monitoring', // Bypass ad blockers
  tracesSampleRate: parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ||
    (process.env.NODE_ENV === 'production' ? '0.2' : '1.0')
  ),
  replaysSessionSampleRate: parseFloat(process.env.SENTRY_REPLAYS_SESSION_RATE || '0.1'),
  replaysOnErrorSampleRate: parseFloat(process.env.SENTRY_REPLAYS_ERROR_RATE || '1.0'),
  integrations: [
    Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    Sentry.browserTracingIntegration(),
  ],
  beforeSend(event) {
    const message = event.exception?.values?.[0]?.value || '';
    if (message.includes('ResizeObserver') || message.includes('Non-Error promise rejection')) {
      return null;
    }
    return event;
  },
});
```

### 1.6 Create Tunnel Endpoint

Create `src/app/api/monitoring/route.ts`:

```typescript
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const envelope = await request.text();
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    return NextResponse.json({ error: 'DSN not configured' }, { status: 500 });
  }

  const url = new URL(dsn);
  const projectId = url.pathname.replace('/', '');
  const sentryUrl = `https://${url.host}/api/${projectId}/envelope/`;

  const response = await fetch(sentryUrl, {
    method: 'POST',
    body: envelope,
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
  });

  return new NextResponse(null, { status: response.status });
}
```

### 1.7 Update Middleware

Update `src/middleware.ts` to exclude tunnel route:

```typescript
export const config = {
  matcher: [
    "/((?!_next|favicon.ico|error|api/client-logs|api/monitoring).*)",
  ],
};
```

### Phase 1 Checklist
- [ ] Run `npx @sentry/wizard@latest -i nextjs`
- [ ] Add environment variables to `.env.local`
- [ ] Update `instrumentation.ts` with Sentry imports in `register()`
- [ ] Add `onRequestError` export to `instrumentation.ts`
- [ ] Create `src/app/global-error.tsx`
- [ ] Update `sentry.server.config.ts` with `beforeSend`
- [ ] Update `sentry.client.config.ts` with tunnel + `beforeSend`
- [ ] Create `src/app/api/monitoring/route.ts`
- [ ] Update middleware matcher
- [ ] **Test:** Throw error in a component → verify in Sentry dashboard

---

## Phase 2: Request Context Integration

**Goal:** Errors include requestId, userId, sessionId tags
**Test:** Trigger server action error → verify tags appear in Sentry

### 2.1 Server: serverReadRequestId.ts

Wrap with `Sentry.withScope()` to capture context for all server actions:

```typescript
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

    // Set Sentry context for this request
    return Sentry.withScope(async (scope) => {
      scope.setUser({ id: requestIdData.userId });
      scope.setTag('requestId', requestIdData.requestId);
      scope.setTag('sessionId', requestIdData.sessionId);
      scope.setContext('request', { ...requestIdData, source: 'server-action' });

      return RequestIdContext.run(requestIdData, async () => await fn(...args));
    });
  }) as T;
}
```

### 2.2 Client: clientPassRequestId.ts

Add Sentry context when generating request. In `useClientPassRequestId`:

```typescript
import * as Sentry from "@sentry/nextjs";

// Inside withRequestId callback, after generating IDs:
const withRequestId = useCallback(<T,>(data?: T) => {
  const requestId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

  // Set Sentry context for client-side errors
  Sentry.setUser({ id: userId });
  Sentry.setTag('requestId', requestId);
  Sentry.setTag('sessionId', effectiveSessionId);

  // ... rest of existing implementation
}, [userId, effectiveSessionId]);
```

### Phase 2 Checklist
- [ ] Modify `src/lib/serverReadRequestId.ts` with `Sentry.withScope()`
- [ ] Modify `src/hooks/clientPassRequestId.ts` with `Sentry.setUser/setTag`
- [ ] **Test:** Trigger server action error → verify requestId/userId/sessionId tags in Sentry

---

## Phase 3: Logger Integration (Breadcrumbs)

**Goal:** Log entries appear as breadcrumb trail in Sentry errors
**Test:** Trigger error after several log calls → verify breadcrumb trail

### 3.1 Fix Client Logger Context (Prerequisite)

Update `src/lib/client_utilities.ts` to include full context:

```typescript
import * as Sentry from "@sentry/nextjs";

const addRequestId = (data: LoggerData | null) => {
  const requestId = RequestIdContext.getRequestId();
  const userId = RequestIdContext.getUserId();      // ADD
  const sessionId = RequestIdContext.getSessionId(); // ADD
  return data ? { requestId, userId, sessionId, ...data } : { requestId, userId, sessionId };
};

const sentryLevelMap: Record<string, Sentry.SeverityLevel> = {
  'DEBUG': 'debug', 'INFO': 'info', 'WARN': 'warning', 'ERROR': 'error'
};

function sendToSentry(level: string, message: string, data: LoggerData | null) {
  try {
    Sentry.addBreadcrumb({
      category: 'log',
      message,
      level: sentryLevelMap[level] || 'info',
      data: addRequestId(data),
    });
    // NO captureMessage - breadcrumbs only!
  } catch {
    // Don't break logging if Sentry fails
  }
}

const logger = {
  debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
    if (!debug) return;
    console.log(`[DEBUG] ${message}`, addRequestId(data));
    sendToSentry('DEBUG', message, data);
  },
  error: (message: string, data: LoggerData | null = null) => {
    console.error(`[ERROR] ${message}`, addRequestId(data));
    sendToSentry('ERROR', message, data);
  },
  info: (message: string, data: LoggerData | null = null) => {
    console.log(`[INFO] ${message}`, addRequestId(data));
    sendToSentry('INFO', message, data);
  },
  warn: (message: string, data: LoggerData | null = null) => {
    console.warn(`[WARN] ${message}`, addRequestId(data));
    sendToSentry('WARN', message, data);
  }
};
```

### 3.2 Server Logger: server_utilities.ts

Add the same `sendToSentry()` function:

```typescript
import * as Sentry from "@sentry/nextjs";

const sentryLevelMap: Record<string, Sentry.SeverityLevel> = {
  'DEBUG': 'debug', 'INFO': 'info', 'WARN': 'warning', 'ERROR': 'error'
};

function sendToSentry(level: string, message: string, data: LoggerData | null) {
  try {
    Sentry.addBreadcrumb({
      category: 'log',
      message,
      level: sentryLevelMap[level] || 'info',
      data: {
        ...data,
        requestId: RequestIdContext.getRequestId(),
        userId: RequestIdContext.getUserId(),
        sessionId: RequestIdContext.getSessionId(),
      },
    });
    // NO captureMessage - breadcrumbs only!
  } catch {
    // Don't break logging if Sentry fails
  }
}

const logger = {
  debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
    if (!debug) return;
    console.log(`[DEBUG] ${message}`, addRequestId(data));
    writeToFile('DEBUG', message, data);
    sendToSentry('DEBUG', message, data);  // ADD
  },
  error: (message: string, data: LoggerData | null = null) => {
    console.error(`[ERROR] ${message}`, addRequestId(data));
    writeToFile('ERROR', message, data);
    sendToSentry('ERROR', message, data);  // ADD
  },
  info: (message: string, data: LoggerData | null = null) => {
    console.log(`[INFO] ${message}`, addRequestId(data));
    writeToFile('INFO', message, data);
    sendToSentry('INFO', message, data);  // ADD
  },
  warn: (message: string, data: LoggerData | null = null) => {
    console.warn(`[WARN] ${message}`, addRequestId(data));
    writeToFile('WARN', message, data);
    sendToSentry('WARN', message, data);  // ADD
  }
};
```

### Phase 3 Checklist
- [ ] Fix `src/lib/client_utilities.ts` `addRequestId()` to include userId/sessionId
- [ ] Add `sendToSentry()` to `src/lib/client_utilities.ts`
- [ ] Add `sendToSentry()` to `src/lib/server_utilities.ts`
- [ ] **Test:** Make several API calls → trigger error → verify breadcrumb trail in Sentry

---

## Phase 4: Error Handling Integration

**Goal:** `handleError()` creates Sentry events with error codes
**Test:** Trigger different error types → verify errorCode tags

### 4.1 Modify errorHandling.ts

```typescript
import * as Sentry from "@sentry/nextjs";
import { RequestIdContext } from './requestIdContext';

export function handleError(
  error: unknown,
  context: string,
  additionalData?: Record<string, any>
): ErrorResponse {
  const errorResponse = categorizeError(error);

  // Report to Sentry with full context
  Sentry.withScope((scope) => {
    const requestContext = RequestIdContext.get();
    if (requestContext) {
      scope.setTag('requestId', requestContext.requestId);
      scope.setTag('sessionId', requestContext.sessionId);
      scope.setUser({ id: requestContext.userId });
    }

    scope.setTag('errorCode', errorResponse.code);
    scope.setContext('errorContext', { context, ...additionalData });
    scope.setLevel(getSentryLevel(errorResponse.code));

    Sentry.captureException(error);
  });

  // Existing logging continues (will also create breadcrumb)
  logger.error(`${context}: ${errorResponse.message}`, { code: errorResponse.code, ...additionalData });

  return errorResponse;
}

function getSentryLevel(code: ErrorCode): Sentry.SeverityLevel {
  const critical = ['DATABASE_ERROR', 'LLM_API_ERROR'];
  const warning = ['TIMEOUT_ERROR', 'VALIDATION_ERROR'];
  if (critical.includes(code)) return 'error';
  if (warning.includes(code)) return 'warning';
  return 'info';
}
```

### Phase 4 Checklist
- [ ] Modify `src/lib/errorHandling.ts` with `Sentry.captureException()`
- [ ] Add `getSentryLevel()` function
- [ ] **Test:** Trigger LLM error → verify errorCode=LLM_API_ERROR in Sentry
- [ ] **Test:** Trigger validation error → verify level=warning

---

## Phase 5: Verification & Polish

**Goal:** Full end-to-end validation
**Test:** Complete user flow with error → verify all context in Sentry

### 5.1 Verification Checklist

- [ ] **Client error:** Click something that throws → verify Session Replay available
- [ ] **Server action error:** Submit form that fails → verify:
  - requestId tag present
  - userId tag present
  - sessionId tag present
  - errorCode tag present
  - Breadcrumb trail shows log messages
- [ ] **Grafana still works:** Confirm OTEL traces still flowing to Grafana
- [ ] **Tunnel working:** Check Network tab → Sentry calls go to `/api/monitoring`

### 5.2 Optional: Custom Spans for LLM Operations

For business-critical operations, add explicit spans:

```typescript
// src/lib/services/llms.ts
import * as Sentry from "@sentry/nextjs";

export async function generateExplanation(query: string) {
  return Sentry.startSpan(
    { name: 'generateExplanation', op: 'llm.generate', attributes: { 'llm.model': 'gpt-4' } },
    async (span) => {
      const result = await openai.chat.completions.create({...});
      span.setAttribute('llm.tokens_used', result.usage?.total_tokens || 0);
      return result.choices[0]?.message?.content || '';
    }
  );
}
```

---

## Phase 6: GitHub Integration

**Goal:** Errors auto-create GitHub issues
**Test:** New error → GitHub issue created

### 6.1 Sentry Dashboard Setup

1. Settings → Integrations → GitHub
2. Enable repository linking for `explainanything`
3. Configure alert rules

### 6.2 Alert Rules

| Alert | Trigger | Action |
|-------|---------|--------|
| New Critical Error | First seen, level=error | Create GitHub issue |
| Regression | Previously resolved reappears | Create GitHub issue |
| Error Spike | >10 errors in 5 min | Slack notification |

### Phase 6 Checklist
- [ ] Configure Sentry → GitHub integration
- [ ] Create "New Critical Error" alert rule
- [ ] Create "Regression" alert rule
- [ ] **Test:** Trigger new error type → verify GitHub issue created

---

## Files Summary

| File | Change |
|------|--------|
| `instrumentation.ts` | Add Sentry imports to `register()` + `onRequestError` export |
| `sentry.client.config.ts` | Wizard creates + add `tunnel` + `beforeSend` |
| `sentry.server.config.ts` | Wizard creates + add `beforeSend` |
| `sentry.edge.config.ts` | Wizard creates |
| `src/app/global-error.tsx` | **NEW** - React error boundary |
| `src/app/api/monitoring/route.ts` | **NEW** - Tunnel endpoint |
| `src/middleware.ts` | Add `/api/monitoring` to excluded routes |
| `src/lib/serverReadRequestId.ts` | Wrap with `Sentry.withScope()` |
| `src/hooks/clientPassRequestId.ts` | Add `Sentry.setUser/setTag` |
| `src/lib/server_utilities.ts` | Add `sendToSentry()` breadcrumbs |
| `src/lib/client_utilities.ts` | Fix `addRequestId()` + add `sendToSentry()` |
| `src/lib/errorHandling.ts` | Add `Sentry.captureException()` |
| `next.config.ts` | Wizard modifies for source maps |
| `.env.local` | Add Sentry DSN and tokens |

---

## Configuration Reference

| Setting | Development | Production |
|---------|-------------|------------|
| `tracesSampleRate` | 1.0 | 0.2 |
| `replaysSessionSampleRate` | 0.0 | 0.1 |
| `replaysOnErrorSampleRate` | 1.0 | 1.0 |

---

## Expected Result

After integration, a Sentry error will show:

```
Error: LLM_API_ERROR - OpenAI rate limit exceeded

Tags:
  requestId: client-1703847234-x8k2m1
  sessionId: auth-a3f2b9c1e4d8
  errorCode: LLM_API_ERROR

User: user-456

Breadcrumbs:
  12:34:01 [INFO] Function returnExplanation called
  12:34:02 [INFO] Vector search completed (145ms)
  12:34:03 [INFO] Calling OpenAI GPT-4
  12:34:05 [ERROR] OpenAI API error: rate limit exceeded

Session Replay: [View user's actions leading to error]
```
