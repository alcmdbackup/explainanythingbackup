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
| `src/lib/logging/client/logConfig.ts` | CREATE - log level filtering |
| `src/lib/logging/client/earlyLogger.ts` | CREATE - pre-hydration capture |
| `src/components/ClientInitializer.tsx` | CREATE - client wrapper for initialization |
| `src/app/layout.tsx` | MODIFY - import ClientInitializer + early logger script |

> **Important**: `layout.tsx` is a server component. Client-side initialization (localStorage, sessionStorage, browser APIs) must happen in a 'use client' component.

**Implementation**:

#### 1a. Log Level Configuration

```typescript
// src/lib/logging/client/logConfig.ts
export type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0, log: 1, info: 2, warn: 3, error: 4,
};

export interface ClientLogConfig {
  minPersistLevel: LogLevel;
  minRemoteLevel: LogLevel;
  remoteEnabled: boolean;
  maxLocalLogs: number;
}

const DEFAULT_DEV_CONFIG: ClientLogConfig = {
  minPersistLevel: 'debug',
  minRemoteLevel: 'warn',
  remoteEnabled: false,
  maxLocalLogs: 500,
};

const DEFAULT_PROD_CONFIG: ClientLogConfig = {
  minPersistLevel: 'warn',  // Filter out debug noise in prod
  minRemoteLevel: 'error',
  remoteEnabled: true,
  maxLocalLogs: 200,
};

export function getLogConfig(): ClientLogConfig {
  const isProd = process.env.NODE_ENV === 'production';
  return isProd ? DEFAULT_PROD_CONFIG : DEFAULT_DEV_CONFIG;
}

export function shouldPersist(level: LogLevel, config: ClientLogConfig): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[config.minPersistLevel];
}
```

#### 1b. Pre-Hydration Log Capture

> **Gap Addressed**: Logs that fire before `useEffect` runs (during SSR/hydration) were previously lost.

```typescript
// src/lib/logging/client/earlyLogger.ts
// Inlined into <script> tag in layout.tsx for immediate execution

export const EARLY_LOGGER_SCRIPT = `
(function() {
  if (typeof window === 'undefined') return;

  window.__PRE_HYDRATION_LOGS__ = [];
  window.__LOGGING_INITIALIZED__ = false;
  window.__ORIGINAL_CONSOLE__ = {
    log: console.log, info: console.info, warn: console.warn,
    error: console.error, debug: console.debug
  };

  ['log', 'info', 'warn', 'error', 'debug'].forEach(function(level) {
    console[level] = function() {
      window.__ORIGINAL_CONSOLE__[level].apply(console, arguments);
      if (!window.__LOGGING_INITIALIZED__) {
        window.__PRE_HYDRATION_LOGS__.push({
          timestamp: new Date().toISOString(),
          level: level.toUpperCase(),
          args: Array.prototype.slice.call(arguments)
        });
      }
    };
  });
})();
`;
```

#### 1c. Console Interceptor with Error Handlers & HMR Cleanup

> **Gaps Addressed**:
> - Uncaught errors and unhandled rejections now captured
> - HMR cleanup prevents stacked console wrappers
> - Log level filtering reduces noise

```typescript
// src/lib/logging/client/consoleInterceptor.ts
import { getLogConfig, shouldPersist, type LogLevel } from './logConfig';

const LOG_KEY = 'client_logs';
const ERROR_KEY = 'client_errors';

// Store pristine console at module load (before any patching)
const PRISTINE_CONSOLE = typeof window !== 'undefined' ? { ...console } : null;
let isInterceptorActive = false;

export function initConsoleInterceptor(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (isInterceptorActive) return () => {}; // HMR protection

  // Test localStorage availability
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
  } catch {
    PRISTINE_CONSOLE?.warn('localStorage unavailable');
    return () => {};
  }

  const config = getLogConfig();

  // Flush pre-hydration logs first
  const preHydrationLogs = (window as any).__PRE_HYDRATION_LOGS__ || [];
  if (preHydrationLogs.length > 0) {
    try {
      const existingLogs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      const bufferedLogs = preHydrationLogs.map((entry: any) => ({
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.args.map((a: any) => {
          try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
          catch { return '[Unserializable]'; }
        }).join(' '),
        preHydration: true,
      }));
      const combined = [...existingLogs, ...bufferedLogs].slice(-config.maxLocalLogs);
      localStorage.setItem(LOG_KEY, JSON.stringify(combined));
    } catch { /* ignore */ }
  }
  (window as any).__LOGGING_INITIALIZED__ = true;

  // Patch console methods with level filtering
  (['log', 'info', 'warn', 'error', 'debug'] as const).forEach(level => {
    console[level] = (...args: unknown[]) => {
      PRISTINE_CONSOLE![level](...args);
      if (!shouldPersist(level as LogLevel, config)) return;

      try {
        const logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
        logs.push({
          timestamp: new Date().toISOString(),
          level: level.toUpperCase(),
          message: args.map(a => {
            try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
            catch { return '[Unserializable]'; }
          }).join(' '),
        });
        if (logs.length > config.maxLocalLogs) logs.shift();
        localStorage.setItem(LOG_KEY, JSON.stringify(logs));
      } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
          localStorage.removeItem(LOG_KEY);
        }
      }
    };
  });

  isInterceptorActive = true;
  (window as any).exportLogs = () => localStorage.getItem(LOG_KEY) || '[]';
  (window as any).clearLogs = () => localStorage.removeItem(LOG_KEY);

  // Return cleanup for HMR
  return () => {
    if (PRISTINE_CONSOLE) {
      (['log', 'info', 'warn', 'error', 'debug'] as const).forEach(level => {
        console[level] = PRISTINE_CONSOLE[level];
      });
    }
    isInterceptorActive = false;
  };
}

// Capture uncaught errors and unhandled promise rejections
export function initErrorHandlers(): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleError = (event: ErrorEvent) => {
    persistError({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      type: 'uncaught',
      message: event.message,
      stack: event.error?.stack,
      filename: event.filename,
      lineno: event.lineno,
    });
  };

  const handleRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    persistError({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      type: 'unhandledrejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  };

  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);

  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
  };
}

function persistError(entry: object): void {
  try {
    const errors = JSON.parse(localStorage.getItem(ERROR_KEY) || '[]');
    errors.push(entry);
    if (errors.length > 100) errors.shift();
    localStorage.setItem(ERROR_KEY, JSON.stringify(errors));
  } catch { /* ignore */ }
}

// HMR support
if (typeof module !== 'undefined' && (module as any).hot) {
  (module as any).hot.dispose(() => {
    if (PRISTINE_CONSOLE) {
      (['log', 'info', 'warn', 'error', 'debug'] as const).forEach(level => {
        console[level] = PRISTINE_CONSOLE[level];
      });
    }
    isInterceptorActive = false;
  });
}
```

#### 1d. Layout Integration

```typescript
// src/app/layout.tsx - add these imports and elements
import Script from 'next/script';
import { EARLY_LOGGER_SCRIPT } from '@/lib/logging/client/earlyLogger';
import { ClientInitializer } from '@/components/ClientInitializer';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="early-logger"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: EARLY_LOGGER_SCRIPT }}
        />
      </head>
      <body>
        <ClientInitializer />
        {/* ... existing content ... */}
      </body>
    </html>
  );
}
```

**Verification**:
- `mcp__playwright__browser_evaluate(() => window.exportLogs())` returns logs
- Logs persist across page navigations
- Pre-hydration logs marked with `preHydration: true`
- Uncaught errors appear in `localStorage.getItem('client_errors')`

---

### Phase 2: Session Request ID (Correlation Foundation)

**Goal**: Single request ID per session (not per-action) for log correlation.

**Problem**: `RequestIdContext` currently uses per-action IDs. Logs from the same session have different IDs.

**Files to modify**:
| File | Action |
|------|--------|
| `src/lib/requestIdContext.ts` | MODIFY - add session persistence with lazy init |
| `src/lib/client_utilities.ts` | MODIFY - include sessionId in addRequestId() |

> **Note**: Uses `sessionStorage` (cleared on tab close) vs `localStorage` (persistent). This is intentional: session IDs should reset per browser session, but logs can persist longer for debugging.

**Implementation**:

> **Gap Addressed**: Race condition fixed via lazy initialization. `getSessionId()` auto-initializes if called before `useEffect`, so it never returns 'unknown'.

```typescript
// Add to RequestIdContext (src/lib/requestIdContext.ts)
private static sessionId: string | null = null;
private static sessionInitialized = false;

static initSession(): void {
  if (this.sessionInitialized) return;
  if (typeof window === 'undefined') return;

  try {
    let sid = sessionStorage.getItem('session_request_id');
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem('session_request_id', sid);
    }
    this.sessionId = sid;
    this.sessionInitialized = true;
  } catch {
    // Private browsing fallback
    this.sessionId = crypto.randomUUID();
    this.sessionInitialized = true;
  }
}

// Lazy init - never returns 'unknown'
static getSessionId(): string {
  if (!this.sessionInitialized) {
    this.initSession();
  }
  return this.sessionId || crypto.randomUUID();
}
```

```typescript
// Update addRequestId() in src/lib/client_utilities.ts
const addRequestId = (data: LoggerData | null) => {
  const requestId = RequestIdContext.getRequestId();
  const sessionId = RequestIdContext.getSessionId(); // Auto-inits if needed
  return data
    ? { requestId, sessionId, ...data }
    : { requestId, sessionId };
};
```

**Verification**:
- Same session ID across multiple `logger.info()` calls
- ID persists across component re-renders
- New tab = new session ID
- Logs before `useEffect` still get valid session ID

---

### Phase 1.5: Batched Remote Sending (Optional)

> **Gap Addressed**: Bridge between localStorage buffer and existing `/api/client-logs` endpoint.

**Goal**: Periodically flush localStorage logs to remote endpoint without blocking UI.

**Files to create**:
| File | Action |
|------|--------|
| `src/lib/logging/client/remoteFlusher.ts` | CREATE |

**Implementation**:

```typescript
// src/lib/logging/client/remoteFlusher.ts
interface FlushConfig {
  flushIntervalMs: number;
  batchSize: number;
  endpoint: string;
}

const DEFAULT_CONFIG: FlushConfig = {
  flushIntervalMs: 30_000,
  batchSize: 50,
  endpoint: '/api/client-logs',
};

let flushTimer: ReturnType<typeof setInterval> | null = null;

export function initRemoteFlusher(config: Partial<FlushConfig> = {}): () => void {
  if (typeof window === 'undefined') return () => {};

  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  let isOnline = navigator.onLine;

  const handleOnline = () => { isOnline = true; };
  const handleOffline = () => { isOnline = false; };
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  const scheduleFlush = () => {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => flushLogs(finalConfig, isOnline));
    } else {
      setTimeout(() => flushLogs(finalConfig, isOnline), 0);
    }
  };

  flushTimer = setInterval(scheduleFlush, finalConfig.flushIntervalMs);

  // Flush on page hide using sendBeacon
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      flushLogsSync(finalConfig);
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    if (flushTimer) clearInterval(flushTimer);
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

async function flushLogs(config: FlushConfig, isOnline: boolean): Promise<void> {
  if (!isOnline) return;
  // ... batch and send logic using fetch with priority: 'low'
}

function flushLogsSync(config: FlushConfig): void {
  // Use navigator.sendBeacon for page unload
}
```

---

### Phase 3: Browser OpenTelemetry (Production Traces)

**Goal**: Client traces visible in Grafana, correlated with server traces.

**Dependencies**:
```bash
npm install @opentelemetry/api @opentelemetry/sdk-trace-web @opentelemetry/exporter-trace-otlp-http @opentelemetry/sdk-trace-base
```

> **Bundle Size Warning**: ~60KB gzipped. Mitigated via lazy loading below.

**Files to create/modify**:
| File | Action |
|------|--------|
| `src/lib/tracing/browserTracing.ts` | CREATE - with lazy loading |
| `src/components/ClientInitializer.tsx` | MODIFY - defer OTel init |
| `src/lib/client_utilities.ts` | MODIFY - attach span events |

**Implementation**:

> **Gap Addressed**: Bundle size mitigated via dynamic imports and deferred initialization using `requestIdleCallback`.

```typescript
// src/lib/tracing/browserTracing.ts
let initialized = false;
let initPromise: Promise<void> | null = null;

export function initBrowserTracing(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const shouldTrace =
      process.env.NODE_ENV === 'production' ||
      process.env.NEXT_PUBLIC_ENABLE_BROWSER_TRACING === 'true';

    if (!shouldTrace) {
      initialized = true;
      return;
    }

    try {
      // Dynamic imports for code splitting
      const [
        { WebTracerProvider },
        { OTLPTraceExporter },
        { BatchSpanProcessor },
        { trace, diag, DiagConsoleLogger, DiagLogLevel },
      ] = await Promise.all([
        import('@opentelemetry/sdk-trace-web'),
        import('@opentelemetry/exporter-trace-otlp-http'),
        import('@opentelemetry/sdk-trace-base'),
        import('@opentelemetry/api'),
      ]);

      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

      const provider = new WebTracerProvider();
      provider.addSpanProcessor(
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: 'https://otlp-gateway-prod-us-west-0.grafana.net/otlp/v1/traces',
            headers: {
              Authorization: `Basic ${process.env.NEXT_PUBLIC_GRAFANA_OTLP_TOKEN}`,
            },
          })
        )
      );
      provider.register();
      initialized = true;
    } catch (error) {
      console.warn('Failed to initialize browser tracing:', error);
      initialized = true;
    }
  })();

  return initPromise;
}
```

```typescript
// src/components/ClientInitializer.tsx - complete implementation
'use client';
import { useEffect, useRef } from 'react';

export function ClientInitializer() {
  const initialized = useRef(false);
  const cleanupFns = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Synchronous init
    import('@/lib/logging/client/consoleInterceptor').then(
      ({ initConsoleInterceptor, initErrorHandlers }) => {
        cleanupFns.current.push(initConsoleInterceptor());
        cleanupFns.current.push(initErrorHandlers());
      }
    );

    import('@/lib/requestIdContext').then(({ RequestIdContext }) => {
      RequestIdContext.initSession();
    });

    // Remote flusher (dev only)
    if (process.env.NODE_ENV === 'development') {
      import('@/lib/logging/client/remoteFlusher').then(({ initRemoteFlusher }) => {
        cleanupFns.current.push(initRemoteFlusher());
      });
    }

    // Lazy-load OTel after idle (bundle size mitigation)
    if ('requestIdleCallback' in window) {
      const idleId = (window as any).requestIdleCallback(
        async () => {
          const { initBrowserTracing } = await import('@/lib/tracing/browserTracing');
          initBrowserTracing();
        },
        { timeout: 5000 }
      );
      cleanupFns.current.push(() => (window as any).cancelIdleCallback(idleId));
    }

    // HMR cleanup
    return () => {
      cleanupFns.current.forEach(fn => fn());
      cleanupFns.current = [];
      initialized.current = false;
    };
  }, []);

  return null;
}
```

**Prerequisites**:
1. Create `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` environment variable
2. **Test CORS first**:
   ```typescript
   fetch('https://otlp-gateway-prod-us-west-0.grafana.net/otlp/v1/traces', { method: 'OPTIONS' })
     .then(r => console.log('CORS OK:', r.ok))
     .catch(e => console.error('CORS blocked:', e));
   ```

---

### Phase 4: Trace Context Propagation (Optional)

**Goal**: Link client-initiated requests to server traces via W3C `traceparent` header.

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

Phase 1.5 (remote flushing) optional but useful for correlating with server logs.

Phase 3 adds production observability but requires:
- CORS configuration on Grafana OTLP endpoint
- Environment variable setup
- ~60KB bundle (mitigated by lazy loading)

---

## Existing Infrastructure

- `src/lib/logging/client/clientLogging.ts` - Has `withClientLogging()` wrapper
- `src/lib/logging/client/__tests__/clientLogging.test.ts` - Existing test coverage
- `src/app/api/client-logs/route.ts` - Functional endpoint with tests
- `src/app/(debug)/test-client-logging/page.tsx` - Test page for verification
- `src/lib/errorHandling.ts` - 13 categorized error codes (can integrate)

---

## Checklist

### Phase 1: localStorage Buffer
- [ ] Create `src/lib/logging/client/logConfig.ts` (log level filtering)
- [ ] Create `src/lib/logging/client/earlyLogger.ts` (pre-hydration capture)
- [ ] Create `src/lib/logging/client/consoleInterceptor.ts` (with error handlers + HMR cleanup)
- [ ] Create `src/components/ClientInitializer.tsx`
- [ ] Modify `src/app/layout.tsx` (add early logger script + ClientInitializer)
- [ ] Test with Playwright `browser_evaluate(() => window.exportLogs())`
- [ ] Verify pre-hydration logs captured (check `preHydration: true` flag)
- [ ] Verify uncaught errors in `localStorage.getItem('client_errors')`
- [ ] Verify HMR doesn't stack console wrappers (check in dev)
- [ ] Verify log level filtering in production mode

### Phase 2: Session Request ID
- [ ] Add `sessionId` field + `initSession()` + `getSessionId()` to `RequestIdContext`
- [ ] Verify lazy initialization works (no 'unknown' values)
- [ ] Update `addRequestId()` in `client_utilities.ts`
- [ ] Verify consistent session IDs across `logger.info()` calls
- [ ] Verify new tab = new session ID

### Phase 1.5: Remote Flushing (Optional)
- [ ] Create `src/lib/logging/client/remoteFlusher.ts`
- [ ] Integrate with existing `/api/client-logs` endpoint
- [ ] Test `sendBeacon` on page unload
- [ ] Test offline resilience

### Phase 3: Browser OpenTelemetry
- [ ] **Test CORS first**
- [ ] Install OTel packages
- [ ] Create `src/lib/tracing/browserTracing.ts` with lazy loading
- [ ] Update `ClientInitializer` to defer OTel init via `requestIdleCallback`
- [ ] Create `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` env var
- [ ] Measure actual bundle size increase
- [ ] Verify client spans in Grafana Tempo

### Phase 4: Trace Propagation (Optional)
- [ ] Add `traceparent` header to fetch calls
- [ ] Verify client→server trace correlation
