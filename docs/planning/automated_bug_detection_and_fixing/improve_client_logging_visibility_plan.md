# Improve Client Logging Visibility

## Problem

Client logs (`logger.info()`, etc.) only appear in browser console. They:
1. Don't persist anywhere accessible for debugging
2. Don't correlate with server traces in Grafana
3. Per-action request IDs prevent cross-action correlation within a session

> **Note**: `/api/client-logs/route.ts` exists and IS functional (has 11 tests, called by test page). Consider integrating rather than deleting.

---

## Implementation Phases

### Phase 1: localStorage Buffer (Dev Experience)

**Goal**: Persist client logs locally for debugging without network calls.

**Files to create/modify**:
| File | Action |
|------|--------|
| `src/lib/logging/client/consoleInterceptor.ts` | CREATE |
| `src/components/ClientInitializer.tsx` | CREATE - client wrapper for initialization |
| `src/app/layout.tsx` | MODIFY - import ClientInitializer |

> **Important**: `layout.tsx` is a server component. Client-side initialization (localStorage, sessionStorage, browser APIs) must happen in a 'use client' component.

**Implementation**:

```typescript
// src/lib/logging/client/consoleInterceptor.ts
const LOG_KEY = 'client_logs';
const MAX_LOGS = 500;

const originalConsole = { ...console };

export function initConsoleInterceptor() {
  if (typeof window === 'undefined') return;

  (['log', 'info', 'warn', 'error', 'debug'] as const).forEach(level => {
    console[level] = (...args: unknown[]) => {
      originalConsole[level](...args);

      try {
        const logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
        logs.push({
          timestamp: new Date().toISOString(),
          level: level.toUpperCase(),
          message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
        });

        if (logs.length > MAX_LOGS) logs.shift();
        localStorage.setItem(LOG_KEY, JSON.stringify(logs));
      } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
          localStorage.removeItem(LOG_KEY);
        }
      }
    };
  });

  // Expose for Playwright/debugging
  (window as any).exportLogs = () => localStorage.getItem(LOG_KEY) || '[]';
  (window as any).clearLogs = () => localStorage.removeItem(LOG_KEY);
}
```

```typescript
// src/components/ClientInitializer.tsx
'use client';
import { useEffect } from 'react';
import { initConsoleInterceptor } from '@/lib/logging/client/consoleInterceptor';
import { RequestIdContext } from '@/lib/requestIdContext';

export function ClientInitializer() {
  useEffect(() => {
    initConsoleInterceptor();
    RequestIdContext.initSession(); // Phase 2
    // initBrowserTracing(); // Phase 3
  }, []);
  return null;
}
```

**Verification**:
- `mcp__playwright__browser_evaluate(() => window.exportLogs())` returns logs
- Logs persist across page navigations

---

### Phase 2: Session Request ID (Correlation Foundation)

**Goal**: Single request ID per session (not per-action) for log correlation.

**Problem**: `RequestIdContext` currently uses per-action IDs. Logs from the same session have different IDs.

**Files to modify**:
| File | Action |
|------|--------|
| `src/lib/requestIdContext.ts` | MODIFY - add session persistence |
| `src/components/ClientInitializer.tsx` | MODIFY - call initSession() (already added in Phase 1) |

> **Note**: Uses `sessionStorage` (cleared on tab close) vs `localStorage` (persistent). This is intentional: session IDs should reset per browser session, but logs can persist longer for debugging.

**Implementation**:

```typescript
// Add to RequestIdContext
static initSession(): void {
  if (typeof window === 'undefined') return;

  let sessionId = sessionStorage.getItem('session_request_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('session_request_id', sessionId);
  }

  clientRequestId = { requestId: sessionId, userId: 'anonymous' };
}

static getSessionId(): string {
  if (typeof window === 'undefined') return 'unknown';
  return sessionStorage.getItem('session_request_id') || 'unknown';
}
```

**Verification**:
- Same session ID across multiple `logger.info()` calls
- ID persists across component re-renders
- New tab = new session ID

---

### Phase 3: Browser OpenTelemetry (Production Traces)

**Goal**: Client traces visible in Grafana, correlated with server traces.

**Dependencies**:
```bash
npm install @opentelemetry/sdk-trace-web @opentelemetry/context-zone @opentelemetry/exporter-trace-otlp-http @opentelemetry/sdk-trace-base @opentelemetry/api
```

> **Correction**: `@opentelemetry/auto-instrumentations-node` only provides server-side packages. Browser requires explicit installation of all web-compatible packages.

**Files to create/modify**:
| File | Action |
|------|--------|
| `src/lib/tracing/browserTracing.ts` | CREATE |
| `src/components/ClientInitializer.tsx` | MODIFY - call initBrowserTracing() |
| `src/lib/client_utilities.ts` | MODIFY - attach span events |
| `.env.local` / Vercel env | ADD `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` |

**Prerequisites**:
1. Create `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` environment variable (base64 encoded `user:token`)
2. Verify Grafana OTLP endpoint accepts browser CORS (may need configuration)

**Implementation**:

```typescript
// src/lib/tracing/browserTracing.ts
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { trace } from '@opentelemetry/api';

let initialized = false;

export function initBrowserTracing() {
  if (typeof window === 'undefined' || initialized) return;

  const provider = new WebTracerProvider();
  provider.addSpanProcessor(new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: 'https://otlp-gateway-prod-us-west-0.grafana.net/otlp/v1/traces',
      headers: {
        Authorization: `Basic ${process.env.NEXT_PUBLIC_GRAFANA_OTLP_TOKEN}`
      }
    })
  ));
  provider.register({ contextManager: new ZoneContextManager() });

  initialized = true;
}

export function getTracer() {
  return trace.getTracer('client', '1.0.0');
}
```

```typescript
// Updated src/lib/client_utilities.ts
import { trace } from '@opentelemetry/api';

const addRequestId = (data: LoggerData | null) => {
  const requestId = RequestIdContext.getRequestId();
  return data ? { requestId, ...data } : { requestId };
};

function logWithSpan(level: string, message: string, data: LoggerData | null) {
  const enrichedData = addRequestId(data);

  // Console output
  console[level as 'log'](`[${level.toUpperCase()}] ${message}`, enrichedData);

  // Attach to active span if exists
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.addEvent(message, {
      'log.level': level.toUpperCase(),
      'log.data': JSON.stringify(enrichedData),
    });
  }
}

const logger = {
  debug: (message: string, data: LoggerData | null = null, debug = false) => {
    if (!debug) return;
    logWithSpan('debug', message, data);
  },
  error: (message: string, data: LoggerData | null = null) => logWithSpan('error', message, data),
  info: (message: string, data: LoggerData | null = null) => logWithSpan('info', message, data),
  warn: (message: string, data: LoggerData | null = null) => logWithSpan('warn', message, data),
};
```

**Verification**:
- Client spans appear in Grafana Tempo
- Log messages visible as span events
- Client + server traces share correlation IDs

---

### Phase 4: Trace Context Propagation (Optional)

**Goal**: Link client-initiated requests to server traces via W3C `traceparent` header.

**Files to modify**:
| File | Action |
|------|--------|
| API fetch wrappers | MODIFY - add traceparent header |

**Implementation**:
```typescript
// In fetch wrapper
import { context, propagation } from '@opentelemetry/api';

const headers: Record<string, string> = {};
propagation.inject(context.active(), headers);
fetch(url, { headers: { ...headers, ...otherHeaders } });
```

---

## Recommendation

**Start with Phase 1 + 2** — immediate debugging value, minimal complexity.

Phase 3 adds production observability but requires:
- CORS configuration on Grafana OTLP endpoint (test before implementing)
- Environment variable `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` must be created
- ~50KB bundle increase (estimate - actual size TBD based on tree-shaking)

Phase 4 only needed if you want end-to-end distributed tracing.

## Existing Infrastructure

The following existing code should be considered:
- `src/lib/logging/client/clientLogging.ts` - Has `withClientLogging()` wrapper (183 lines)
- `src/lib/logging/client/__tests__/clientLogging.test.ts` - Existing test coverage (240 lines)
- `src/app/api/client-logs/route.ts` - Functional endpoint with tests (optional remote persistence)
- `src/app/(debug)/test-client-logging/page.tsx` - Test page for verification

---

## Checklist

### Phase 1: localStorage Buffer
- [ ] Create `src/lib/logging/client/consoleInterceptor.ts`
- [ ] Create `src/components/ClientInitializer.tsx` (client wrapper)
- [ ] Import `<ClientInitializer />` in `src/app/layout.tsx`
- [ ] Test with Playwright `browser_evaluate(() => window.exportLogs())`
- [ ] Verify logs persist across page navigations

### Phase 2: Session Request ID
- [ ] Add `initSession()` to `RequestIdContext`
- [ ] Add `getSessionId()` to `RequestIdContext`
- [ ] Verify `ClientInitializer` calls `initSession()` (added in Phase 1)
- [ ] Verify consistent IDs across multiple `logger.info()` calls
- [ ] Verify new tab = new session ID

### Phase 3: Browser OpenTelemetry
- [ ] Install all required packages: `@opentelemetry/sdk-trace-web`, `@opentelemetry/context-zone`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/api`
- [ ] Create `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` environment variable
- [ ] Test CORS with Grafana OTLP endpoint (may require Grafana configuration)
- [ ] Create `src/lib/tracing/browserTracing.ts`
- [ ] Update `ClientInitializer` to call `initBrowserTracing()`
- [ ] Update `logger` in `client_utilities.ts` to attach span events
- [ ] Verify client spans in Grafana Tempo

### Phase 4: Trace Propagation (Optional)
- [ ] Add `traceparent` header to fetch calls
- [ ] Verify client→server trace correlation in Grafana
