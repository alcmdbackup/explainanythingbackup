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

  // Test localStorage availability first (handles private browsing, Safari iframes)
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
  } catch {
    originalConsole.warn('localStorage unavailable, console interception disabled');
    return; // Graceful degradation
  }

  (['log', 'info', 'warn', 'error', 'debug'] as const).forEach(level => {
    console[level] = (...args: unknown[]) => {
      originalConsole[level](...args);

      try {
        const logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
        logs.push({
          timestamp: new Date().toISOString(),
          level: level.toUpperCase(),
          message: args.map(a => {
            try {
              return typeof a === 'object' ? JSON.stringify(a) : String(a);
            } catch {
              return '[Unserializable]'; // Handle DOM nodes, functions, circular refs
            }
          }).join(' '),
        });

        if (logs.length > MAX_LOGS) logs.shift();
        localStorage.setItem(LOG_KEY, JSON.stringify(logs));
      } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
          localStorage.removeItem(LOG_KEY);
        }
        // Other errors: already logged to original console, just don't persist
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
import { useEffect, useRef } from 'react';
import { initConsoleInterceptor } from '@/lib/logging/client/consoleInterceptor';
import { RequestIdContext } from '@/lib/requestIdContext';

export function ClientInitializer() {
  // Guard against React Strict Mode double-mount and Fast Refresh
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

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

> **Important**: Do NOT modify `clientRequestId` directly. The existing `run()` method resets `clientRequestId` after each call, which would break session persistence. Use a separate `sessionId` field instead.

```typescript
// Add to RequestIdContext (src/lib/requestIdContext.ts)
// Add as private static field at class level:
private static sessionId: string | null = null;

static initSession(): void {
  if (typeof window === 'undefined') return;

  let sid = sessionStorage.getItem('session_request_id');
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem('session_request_id', sid);
  }
  this.sessionId = sid;
}

static getSessionId(): string {
  return this.sessionId || 'unknown';
}
```

```typescript
// Update addRequestId() in src/lib/client_utilities.ts to include sessionId:
const addRequestId = (data: LoggerData | null) => {
  const requestId = RequestIdContext.getRequestId();
  const sessionId = RequestIdContext.getSessionId();
  return data
    ? { requestId, sessionId, ...data }
    : { requestId, sessionId };
};
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
# Minimal set for browser traces (recommended for smaller bundles)
npm install @opentelemetry/api @opentelemetry/sdk-trace-web @opentelemetry/exporter-trace-otlp-http @opentelemetry/sdk-trace-base
```

> **Note**: `@opentelemetry/auto-instrumentations-node` is server-only. For browser, use individual packages for tree-shaking.

> **Bundle Size Warning**: Full OTel browser bundle is ~60KB gzipped (~300KB uncompressed). Use individual packages and ensure tree-shaking is enabled. See [SigNoz guide on reducing bundle size](https://newsletter.signoz.io/p/reducing-opentelemetry-bundle-size).

> **ZoneContextManager Compatibility**: `@opentelemetry/context-zone` does NOT work with ES2017+ targets (Next.js default). Either:
> 1. Skip context-zone and use default context manager (simpler, works for most cases)
> 2. Or add context-zone but configure `tsconfig.json` with `"target": "ES2015"` (not recommended - hurts modern browser perf)

**Files to create/modify**:
| File | Action |
|------|--------|
| `src/lib/tracing/browserTracing.ts` | CREATE |
| `src/components/ClientInitializer.tsx` | MODIFY - call initBrowserTracing() |
| `src/lib/client_utilities.ts` | MODIFY - attach span events |
| `.env.local` / Vercel env | ADD `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` |

**Prerequisites**:
1. Create `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` environment variable (base64 encoded `user:token`)
2. **Test CORS before implementation**: Grafana Cloud OTLP endpoint must accept browser requests:
   ```typescript
   // Quick CORS test (run in browser console)
   fetch('https://otlp-gateway-prod-us-west-0.grafana.net/otlp/v1/traces', { method: 'OPTIONS' })
     .then(r => console.log('CORS OK:', r.ok))
     .catch(e => console.error('CORS blocked:', e));
   ```

**Implementation**:

```typescript
// src/lib/tracing/browserTracing.ts
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace, diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

let initialized = false;

export function initBrowserTracing() {
  if (typeof window === 'undefined' || initialized) return;

  // Enable diagnostic logging for debugging (set to WARN in production)
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  const provider = new WebTracerProvider();
  provider.addSpanProcessor(new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: 'https://otlp-gateway-prod-us-west-0.grafana.net/otlp/v1/traces',
      headers: {
        Authorization: `Basic ${process.env.NEXT_PUBLIC_GRAFANA_OTLP_TOKEN}`
      }
    }),
    {
      exportTimeoutMillis: 5000,
      maxExportBatchSize: 100,
    }
  ));

  // Use default context manager (no zone.js required, works with ES2017+)
  provider.register();
  // NOTE: If you need async context propagation across setTimeout/Promise chains,
  // install @opentelemetry/context-zone and use: provider.register({ contextManager: new ZoneContextManager() });
  // But this requires ES2015 target in tsconfig.json

  initialized = true;
}

export function getTracer() {
  return trace.getTracer('client', '1.0.0');
}
```

```typescript
// Updated src/lib/client_utilities.ts
import { trace } from '@opentelemetry/api';
import { RequestIdContext } from './requestIdContext';

interface LoggerData {
  [key: string]: unknown;
}

// Updated to include sessionId (from Phase 2)
const addRequestId = (data: LoggerData | null) => {
  const requestId = RequestIdContext.getRequestId();
  const sessionId = RequestIdContext.getSessionId();
  return data
    ? { requestId, sessionId, ...data }
    : { requestId, sessionId };
};

function logWithSpan(level: string, message: string, data: LoggerData | null) {
  const enrichedData = addRequestId(data);

  // Console output (using correct console method mapping)
  const consoleMethod = level === 'debug' ? 'log' : level;
  console[consoleMethod as 'log'](`[${level.toUpperCase()}] ${message}`, enrichedData);

  // Attach to active span if exists (Phase 3 OTel integration)
  try {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.addEvent(message, {
        'log.level': level.toUpperCase(),
        'log.data': JSON.stringify(enrichedData),
      });
    }
  } catch {
    // OTel not initialized yet, ignore
  }
}

// NOTE: Preserving existing API signatures
const logger = {
  // debug has 3 params - preserving existing signature
  debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
    if (!debug) return;
    logWithSpan('debug', message, data);
  },
  error: (message: string, data: LoggerData | null = null) => logWithSpan('error', message, data),
  info: (message: string, data: LoggerData | null = null) => logWithSpan('info', message, data),
  warn: (message: string, data: LoggerData | null = null) => logWithSpan('warn', message, data),
};

export { logger };
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
- ~60KB gzipped bundle increase (~300KB uncompressed) - use individual packages for tree-shaking
- Note: ZoneContextManager requires ES2015 target; default context manager recommended for ES2017+

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
- [ ] Verify localStorage availability check works (test in private browsing)
- [ ] Verify JSON serialization fallback works (test with DOM nodes)
- [ ] Verify React Strict Mode guard prevents double initialization

### Phase 2: Session Request ID
- [ ] Add private static `sessionId` field to `RequestIdContext`
- [ ] Add `initSession()` to `RequestIdContext` (uses separate sessionId, not clientRequestId)
- [ ] Add `getSessionId()` to `RequestIdContext`
- [ ] Update `addRequestId()` in `client_utilities.ts` to include sessionId
- [ ] Verify `ClientInitializer` calls `initSession()` (added in Phase 1)
- [ ] Verify consistent session IDs across multiple `logger.info()` calls
- [ ] Verify `run()` still works correctly (sessionId is independent)
- [ ] Verify new tab = new session ID

### Phase 3: Browser OpenTelemetry
- [ ] **Test CORS first**: Run CORS check in browser console before installing packages
- [ ] Install minimal packages: `@opentelemetry/api`, `@opentelemetry/sdk-trace-web`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/sdk-trace-base`
- [ ] (Optional) Install `@opentelemetry/context-zone` only if ES2015 target is acceptable
- [ ] Create `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` environment variable
- [ ] Create `src/lib/tracing/browserTracing.ts` (using default context manager, not ZoneContextManager)
- [ ] Update `ClientInitializer` to call `initBrowserTracing()`
- [ ] Update `logger` in `client_utilities.ts` to attach span events (preserve 3-param debug signature)
- [ ] Enable OTel diagnostic logging (`DiagConsoleLogger`) for debugging
- [ ] Measure actual bundle size increase after implementation
- [ ] Verify client spans in Grafana Tempo

### Phase 4: Trace Propagation (Optional)
- [ ] Add `traceparent` header to fetch calls
- [ ] Verify client→server trace correlation in Grafana
