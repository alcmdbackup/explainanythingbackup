# Improve Client Logging Visibility

## Problem Statement

Current client logging has two limitations:
1. **API dependency**: Logs are sent via `POST /api/client-logs` (development only)
2. **No trace correlation**: `logger.*()` calls don't appear in Grafana traces

---

## Current State

| Component | How It Works | Limitation |
|-----------|--------------|------------|
| `logger.info()` etc. | Wraps `console.*`, adds requestId | Only visible in browser console |
| `/api/client-logs` | Appends to `client.log` file | Dev only, requires network call |
| Server OpenTelemetry | Sends traces to Grafana | Client-side not instrumented |

**Key files**:
- `src/lib/client_utilities.ts` - Client logger
- `src/lib/logging/client/clientLogging.ts` - `withClientLogging()` wrapper
- `src/app/api/client-logs/route.ts` - API endpoint (dev only)

---

## Options for Client Log Collection Without API Calls

### Option 1: Browser OpenTelemetry (Recommended for Production)

Send traces directly from browser to Grafana OTLP endpoint.

**Setup**:
```bash
npm install @opentelemetry/sdk-trace-web @opentelemetry/exporter-trace-otlp-http @opentelemetry/context-zone
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

function logWithSpan(level: string, message: string, data?: unknown) {
  // Still log to console
  console[level](message, data);

  // Attach to active span if one exists
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.addEvent(message, {
      'log.level': level.toUpperCase(),
      'log.data': data ? JSON.stringify(data) : undefined
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

### Phase 1: Immediate (No Code Changes)
- Use `mcp__playwright__browser_console_messages` for debugging
- Continue using browser DevTools console

### Phase 2: Local Development Enhancement
- Implement **Option 2 (localStorage interception)**
- Add a debug panel or keyboard shortcut to export logs
- Readable via Playwright's `browser_evaluate`

### Phase 3: Production Observability
- Implement **Browser OpenTelemetry** (Option 1)
- Modify logger to use **Solution A (span events)**
- Unified client+server traces in Grafana

---

## Implementation Checklist

### For localStorage Approach (Phase 2)
- [ ] Create `src/lib/logging/client/consoleInterceptor.ts`
- [ ] Initialize interceptor in app layout
- [ ] Add `exportLogs()` function accessible via console
- [ ] Test with Playwright `browser_evaluate(() => exportLogs())`

### For Browser OpenTelemetry (Phase 3)
- [ ] Install OTEL browser packages
- [ ] Configure CORS on Grafana OTLP endpoint
- [ ] Create `src/lib/tracing/browserTracing.ts`
- [ ] Modify `logger` to attach events to active spans
- [ ] Initialize in client-side app entry point
- [ ] Verify traces appear in Grafana Tempo

---

## References

- [OpenTelemetry Browser SDK](https://opentelemetry.io/docs/instrumentation/js/getting-started/browser/)
- [Grafana Cloud OTLP](https://grafana.com/docs/grafana-cloud/send-data/otlp/)
- [Span Events vs Logs](https://opentelemetry.io/docs/concepts/signals/traces/#span-events)
