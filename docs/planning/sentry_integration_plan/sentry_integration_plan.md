# Sentry Integration Plan for ExplainAnything

## Overview

Integrate Sentry for error tracking, performance monitoring, and automated issue creation while keeping Grafana for detailed OTEL traces.

**Key Decisions:**
- Server actions: Use `Sentry.withScope()` inside `serverReadRequestId` (one change captures all 50+ actions)
- Error flow: `handleError()` sends Sentry events; `logger.*` sends breadcrumbs only (no duplicates)
- Tracing: Keep both Grafana (detailed perf) + Sentry (error-correlated traces)

---

## Current State

| Component | Current | After Sentry |
|-----------|---------|--------------|
| Server logging | Console + `server.log` | + Sentry breadcrumbs |
| Client logging | Console only (lost in prod) | + Sentry breadcrumbs |
| Error handling | `handleError()` categorizes errors | + Sentry events with context |
| Request context | `RequestIdContext` (requestId, userId, sessionId) | Bridged to Sentry tags |
| OTEL tracing | Grafana Cloud | Keep + Sentry auto-captures |

---

## Phase 1: Core Setup

### 1.1 Install & Configure

```bash
npx @sentry/wizard@latest -i nextjs
```

The wizard creates:
- `sentry.client.config.ts` → Client initialization
- `sentry.server.config.ts` → Server initialization
- `sentry.edge.config.ts` → Edge runtime
- Updates to `next.config.ts` → Source maps

### 1.2 Environment Variables

```bash
# .env.local
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=<from Sentry>
SENTRY_ORG=<your org>
SENTRY_PROJECT=explainanything
```

### 1.3 App Router Error Boundary (REQUIRED)

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

### 1.4 Server Component Error Capture (REQUIRED)

Add to `instrumentation.ts`:

```typescript
import * as Sentry from "@sentry/nextjs";

// Capture React Server Component errors
export async function onRequestError(
  ...args: Parameters<typeof Sentry.captureRequestError>
) {
  return Sentry.captureRequestError(...args);
}

// Existing register() function unchanged
export async function register() {
  // ... existing OTEL setup
}
```

### 1.5 Router Transition Tracking

Add to client config or a layout:

```typescript
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

---

## Phase 2: Request Context Integration

### 2.1 Server: `serverReadRequestId.ts`

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

### 2.2 Client: `clientPassRequestId.ts`

Add Sentry context when generating request:

```typescript
import * as Sentry from "@sentry/nextjs";

// In withRequestId callback, add:
Sentry.setUser({ id: userId });
Sentry.setTag('requestId', requestId);
Sentry.setTag('sessionId', effectiveSessionId);
```

---

## Phase 3: Logger Integration (Breadcrumbs Only)

### 3.1 Server Logger: `server_utilities.ts`

Add `sendToSentry()` function:

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
    // NO captureMessage here - breadcrumbs only!
  } catch (e) {
    // Don't break logging if Sentry fails
  }
}

// Call sendToSentry() in each logger method
const logger = {
  info: (message: string, data: LoggerData | null = null) => {
    console.log(`[INFO] ${message}`, addRequestId(data));
    writeToFile('INFO', message, data);
    sendToSentry('INFO', message, data);  // ADD
  },
  // ... same for debug, warn, error
};
```

### 3.2 Client Logger: `client_utilities.ts`

Same pattern, plus fix context to include userId/sessionId:

```typescript
const addRequestId = (data: LoggerData | null) => {
  const requestId = RequestIdContext.getRequestId();
  const userId = RequestIdContext.getUserId();      // ADD
  const sessionId = RequestIdContext.getSessionId(); // ADD
  return data ? { requestId, userId, sessionId, ...data } : { requestId, userId, sessionId };
};
```

---

## Phase 4: Error Handling Integration (Events)

### 4.1 Modify `errorHandling.ts`

Add Sentry event capture (this is where errors become Sentry events):

```typescript
import * as Sentry from "@sentry/nextjs";

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
      scope.setUser({ id: requestContext.userId });
    }

    scope.setTag('errorCode', errorResponse.code);
    scope.setContext('errorContext', { context, ...additionalData });
    scope.setLevel(getSentryLevel(errorResponse.code));

    Sentry.captureException(error);
  });

  // Existing logging continues
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

---

## Phase 5: Tracing (Auto-Configured)

**No `instrumenter: "otel"` needed** - Sentry SDK v8+ uses OpenTelemetry under the hood automatically.

### 5.1 Sentry Config

```typescript
// sentry.server.config.ts
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  // Sentry auto-instruments Next.js routes, fetch(), etc.
});

// sentry.client.config.ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    Sentry.browserTracingIntegration(),
  ],
});
```

### 5.2 Custom Spans (Optional)

For business-critical operations:

```typescript
// src/lib/services/llms.ts
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

### 6.1 Sentry Dashboard Setup

1. Settings → Integrations → GitHub
2. Enable repository linking
3. Configure alert rules

### 6.2 Alert Rules

| Alert | Trigger | Action |
|-------|---------|--------|
| New Critical Error | First seen, level=error | Create GitHub issue |
| Regression | Previously resolved reappears | Create GitHub issue |
| Error Spike | >10 errors in 5 min | Slack notification |

---

## Implementation Checklist

### Phase 1: Core Setup
- [ ] Run `npx @sentry/wizard@latest -i nextjs`
- [ ] Add environment variables
- [ ] Create `src/app/global-error.tsx`
- [ ] Add `onRequestError` to `instrumentation.ts`
- [ ] Test: trigger error, verify in Sentry

### Phase 2: Request Context
- [ ] Modify `serverReadRequestId.ts` with `Sentry.withScope()`
- [ ] Modify `clientPassRequestId.ts` with `Sentry.setUser/setTag`
- [ ] Verify: errors have requestId/userId tags in Sentry

### Phase 3: Logger Integration
- [ ] Add `sendToSentry()` to `server_utilities.ts` (breadcrumbs only)
- [ ] Add `sendToSentry()` to `client_utilities.ts` (breadcrumbs only)
- [ ] Fix client `addRequestId()` to include userId/sessionId
- [ ] Verify: breadcrumb trail appears in Sentry error details

### Phase 4: Error Handling
- [ ] Modify `handleError()` to call `Sentry.captureException()`
- [ ] Verify: errors show with errorCode tags

### Phase 5: Verification
- [ ] Trigger client-side error → verify Session Replay
- [ ] Trigger server action error → verify context tags
- [ ] Confirm Grafana still receives OTEL traces

### Phase 6: GitHub Integration
- [ ] Configure Sentry → GitHub integration
- [ ] Set up alert rules
- [ ] Test end-to-end: error → GitHub issue

---

## Files to Modify

| File | Change |
|------|--------|
| `instrumentation.ts` | Add `onRequestError` export |
| `src/app/global-error.tsx` | **NEW FILE** |
| `src/lib/serverReadRequestId.ts` | Wrap with `Sentry.withScope()` |
| `src/hooks/clientPassRequestId.ts` | Add `Sentry.setUser/setTag` |
| `src/lib/server_utilities.ts` | Add `sendToSentry()` for breadcrumbs |
| `src/lib/client_utilities.ts` | Add `sendToSentry()` + fix context |
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
