# Improve Client Logging Visibility

## Problem Statement

Current client logging has two limitations:
1. **API dependency**: Logs are sent via `POST /api/client-logs` (development only)
2. **No trace correlation**: `logger.*()` calls don't appear in Grafana traces

---

## Critical Flaws in Original Approach

Before implementing, these issues must be addressed:

| Flaw | Problem | Required Fix |
|------|---------|--------------|
| **RequestId Lifecycle** | `useClientPassRequestId` creates new ID per action, not per session | Add Phase 0: session-level request ID on app mount |
| **No TraceId Propagation** | Client request IDs don't correlate with server trace IDs | Pass W3C `traceparent` header from client to server |
| **Orphaned API Endpoint** | `/api/client-logs` exists but no code calls it | Wire up or remove |
| **Sanitization Gap** | `logger.info()` bypasses `withClientLogging` sanitization | Route OTEL exports through sanitization pipeline |

---

## Current State

| Component | How It Works | Limitation |
|-----------|--------------|------------|
| `logger.info()` etc. | Wraps `console.*`, adds requestId | Only visible in browser console |
| `/api/client-logs` | Appends to `client.log` file | Dev only, **unused** |
| Server OpenTelemetry | Sends traces to Grafana | Client-side not instrumented |

**Key files**:
- `src/lib/client_utilities.ts` - Client logger
- `src/lib/logging/client/clientLogging.ts` - `withClientLogging()` wrapper
- `src/app/api/client-logs/route.ts` - API endpoint (dev only, unused)
- `src/lib/requestIdContext.ts` - Request ID context (per-action, not per-session)

---

## Existing Infrastructure to Leverage

The codebase already has OTEL infrastructure that should be reused:

| Component | Location | Status |
|-----------|----------|--------|
| OTLP trace exporter | `@opentelemetry/exporter-trace-otlp-http` v0.55.0 | Installed |
| OTLP logs exporter | `@opentelemetry/exporter-logs-otlp-http` v0.55.0 | Installed |
| Grafana endpoint | `package.json` dev script | Configured |
| Custom tracers | `instrumentation.ts` | 4 tracers: llm, db, vector, app |
| Sanitization | `src/lib/logging/client/clientLogging.ts` | Working |

---

## Options for Client Log Collection Without API Calls

### Option 1: Browser OpenTelemetry (Recommended for Production)

Send traces directly from browser to Grafana OTLP endpoint.

**Setup**:
```bash
# Only need sdk-trace-web and context-zone; exporter already installed
npm install @opentelemetry/sdk-trace-web @opentelemetry/context-zone
```

**Implementation**:
```typescript
// src/lib/tracing/browserTracing.ts
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ZoneContextManager } from '@opentelemetry/context-zone';

const provider = new WebTracerProvider();
provider.addSpanProcessor(new BatchSpanProcessor(
  new OTLPTraceExporter({
    url: 'https://otlp-gateway-prod-us-west-0.grafana.net/otlp/v1/traces',
    headers: { Authorization: 'Basic <token>' }
  })
));
provider.register({ contextManager: new ZoneContextManager() });
```

**Pros**: Unified with server traces, works in prod, Grafana correlation
**Cons**: ~50KB bundle size, requires CORS config on Grafana endpoint

---

### Option 2: Console Interception + localStorage

Intercept all console calls, buffer to localStorage, read via Playwright MCP or debug panel.

**Implementation**:
```typescript
// src/lib/logging/client/consoleInterceptor.ts
const LOG_KEY = 'client_logs';
const MAX_LOGS = 500;

const originalConsole = { ...console };

['log', 'info', 'warn', 'error', 'debug'].forEach(level => {
  console[level] = (...args) => {
    originalConsole[level](...args);

    try {
      const logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      logs.push({
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
        requestId: RequestIdContext.getRequestId()
      });

      // Keep only last N logs
      if (logs.length > MAX_LOGS) logs.shift();
      localStorage.setItem(LOG_KEY, JSON.stringify(logs));
    } catch (e) {
      // QuotaExceededError - graceful degradation
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        localStorage.removeItem(LOG_KEY);
      }
    }
  };
});

export function exportLogs(): string {
  return localStorage.getItem(LOG_KEY) || '[]';
}

export function clearLogs(): void {
  localStorage.removeItem(LOG_KEY);
}
```

**Pros**: Zero network overhead, works offline, simple
**Cons**: ~5MB storage limit, only accessible locally

---

### Option 3: IndexedDB Buffer

Store logs in IndexedDB for larger storage and structured queries.

**Pros**: 50MB+ storage, can query by level/time
**Cons**: More complex setup, async API

---

### Option 4: Playwright MCP Console Capture (No Code Changes)

Use existing Playwright MCP during debugging sessions:

```
mcp__playwright__browser_console_messages
```

**Pros**: Works immediately, no code changes
**Cons**: Only during active Playwright sessions

---

## Getting Logger Statements into Traces

### The Problem

OpenTelemetry traces and logger statements are different concepts:

| | Traces (Spans) | Logs |
|---|---|---|
| What | Operations with duration | Discrete messages |
| Example | `tracer.startSpan("handleClick")` | `logger.info("clicked")` |
| Grafana | Tempo | Loki |

**Your `logger.info()` calls don't automatically appear in traces.**

---

### Solution A: Attach Logs as Span Events (Recommended)

Modify logger to attach messages to the active span when one exists.

**Implementation**:
```typescript
// src/lib/client_utilities.ts - Enhanced logger
import { trace } from '@opentelemetry/api';
import { sanitizeData } from './logging/client/clientLogging';

function logWithSpan(level: string, message: string, data?: unknown) {
  // Sanitize before logging anywhere
  const safeData = data ? sanitizeData(data) : undefined;

  // Still log to console
  console[level](message, safeData);

  // Attach to active span if one exists
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.addEvent(message, {
      'log.level': level.toUpperCase(),
      'log.data': safeData ? JSON.stringify(safeData) : undefined
    });
  }
}

export const logger = {
  info: (msg: string, data?: unknown) => logWithSpan('info', msg, data),
  warn: (msg: string, data?: unknown) => logWithSpan('warn', msg, data),
  error: (msg: string, data?: unknown) => logWithSpan('error', msg, data),
  debug: (msg: string, data?: unknown) => logWithSpan('debug', msg, data),
};
```

**Result in Grafana**: Log messages appear as events on the trace timeline, correlated by trace ID.

---

### Solution B: OTLP Logs Exporter (Separate from Traces)

Send logs as a separate OpenTelemetry signal to Grafana Loki.

```typescript
import { logs } from '@opentelemetry/api-logs';
import { LoggerProvider } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

const loggerProvider = new LoggerProvider();
loggerProvider.addLogRecordProcessor(
  new BatchLogRecordProcessor(new OTLPLogExporter({
    url: 'https://otlp-gateway.../v1/logs'
  }))
);

const otelLogger = logs.getLogger('client');
otelLogger.emit({
  body: 'User clicked button',
  severityText: 'INFO',
  attributes: { component: 'ButtonComponent' }
});
```

**Pros**: Full log pipeline, separate from traces
**Cons**: More setup, requires Loki configuration

---

## Recommended Implementation Plan

### Phase 0: Request ID Foundation (PREREQUISITE)
- Establish session-level request ID on app mount
- Update `RequestIdContext` for session persistence
- Required before Phase 2-3 will work correctly

### Phase 1: Immediate (No Code Changes)
- Use `mcp__playwright__browser_console_messages` for debugging
- Continue using browser DevTools console

### Phase 2: Local Development Enhancement
- Implement **Option 2 (localStorage interception)** with quota handling
- Add a debug panel or keyboard shortcut to export logs
- Readable via Playwright's `browser_evaluate`
- Resolve orphaned `/api/client-logs` endpoint

### Phase 3: Production Observability
- Implement **Browser OpenTelemetry** (Option 1)
- Add W3C `traceparent` header propagation
- Modify logger to use **Solution A (span events)** with sanitization
- Unified client+server traces in Grafana

---

## Implementation Checklist

### Phase 0: Request ID Foundation
- [ ] Modify `src/app/layout.tsx` to auto-generate session request ID on mount
- [ ] Update `src/lib/requestIdContext.ts` for session-level persistence
- [ ] Ensure all logs use session ID, not per-action ID

### Phase 2: localStorage Approach
- [ ] Create `src/lib/logging/client/consoleInterceptor.ts` with quota handling
- [ ] Initialize interceptor in `src/app/layout.tsx`
- [ ] Add `exportLogs()` / `clearLogs()` to window object
- [ ] Wire up OR remove `/api/client-logs` endpoint
- [ ] Test with Playwright `browser_evaluate(() => window.exportLogs())`

### Phase 3: Browser OpenTelemetry
- [ ] Install `@opentelemetry/sdk-trace-web` and `@opentelemetry/context-zone`
- [ ] Configure CORS on Grafana OTLP endpoint
- [ ] Create `src/lib/tracing/browserTracing.ts` (reuse existing Grafana config)
- [ ] Add W3C `traceparent` header to client→server requests
- [ ] Modify `logger` to attach sanitized span events
- [ ] Initialize in `src/app/layout.tsx`
- [ ] Verify client+server traces correlate in Grafana Tempo

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/app/layout.tsx` | Initialize session request ID, console interceptor, browser tracer |
| `src/lib/client_utilities.ts` | Add span event attachment with sanitization |
| `src/lib/requestIdContext.ts` | Support session-level persistence |
| `src/lib/logging/client/consoleInterceptor.ts` | NEW: localStorage buffering |
| `src/lib/tracing/browserTracing.ts` | NEW: Browser OTEL setup |
| `src/app/api/client-logs/route.ts` | Wire up or remove |

---

## References

- [OpenTelemetry Browser SDK](https://opentelemetry.io/docs/instrumentation/js/getting-started/browser/)
- [Grafana Cloud OTLP](https://grafana.com/docs/grafana-cloud/send-data/otlp/)
- [Span Events vs Logs](https://opentelemetry.io/docs/concepts/signals/traces/#span-events)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
