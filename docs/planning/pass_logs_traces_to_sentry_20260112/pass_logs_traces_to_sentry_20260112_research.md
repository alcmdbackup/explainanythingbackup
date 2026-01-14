# Pass Logs Traces to Sentry Research

## Problem Statement
The project aims to integrate logs and traces with Sentry, connecting with the existing OpenTelemetry setup and configuring comprehensive error tracking. This will enhance observability by sending structured logs and distributed traces to Sentry for centralized monitoring, alerting, and debugging.

## High Level Summary

**Key Finding: Sentry is already integrated** - The codebase has a mature, production-ready Sentry integration with `@sentry/nextjs@^10.32.1`. The infrastructure includes:
- Three runtime configurations (client, server, edge)
- Error boundaries and centralized error handling
- Tunnel endpoint at `/api/monitoring` to bypass ad blockers
- Breadcrumb logging integration

**Current gaps to address:**
1. **Sentry Logs feature** not enabled (`enableLogs: true` missing from configs)
2. **OpenTelemetry traces** currently go to Honeycomb only, not Sentry
3. **Structured logs** go to Honeycomb via OTLP but not to Sentry's new Logs product

The project should enable Sentry's native logging feature and optionally configure trace forwarding to Sentry while maintaining Honeycomb as the primary observability backend.

---

## Current Architecture

### Observability Data Flow
```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER (Client-Side)                    │
├─────────────────────────────────────────────────────────────┤
│  Console Interceptor → localStorage → /api/client-logs      │
│  Browser Tracing → /api/traces (proxy to Honeycomb)         │
│  Sentry Client → /api/monitoring (tunnel to Sentry)         │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────────────────┐
│                    SERVER (Next.js)                          │
├─────────────────────────────────────────────────────────────┤
│  Server Logger → console + server.log + Sentry breadcrumbs   │
│                → emitLog() → Honeycomb OTLP                  │
│  OpenTelemetry → Honeycomb (traces)                          │
│  Sentry Server → Sentry (errors only)                        │
└────────┬───────────────────────────────────────┬────────────┘
         ↓                                       ↓
    ┌─────────────┐                         ┌─────────────┐
    │  Honeycomb  │                         │   Sentry    │
    │  (Traces &  │                         │  (Errors &  │
    │    Logs)    │                         │  Replays)   │
    └─────────────┘                         └─────────────┘
```

---

## Documents Read

### Core Documentation
- `docs/docs_overall/architecture.md` - System design and data flow
- `docs/docs_overall/environments.md` - Environment configuration
- `docs/feature_deep_dives/request_tracing_observability.md` - Tracing patterns

### External Documentation
- [Sentry Next.js Guide](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Sentry OpenTelemetry Integration](https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry/)
- [Sentry Logs Configuration](https://docs.sentry.io/platforms/javascript/guides/nextjs/logs/)

---

## Code Files Read

### Sentry Configuration
| File | Purpose |
|------|---------|
| `sentry.client.config.ts` | Client-side Sentry initialization with browser tracing & replay |
| `sentry.server.config.ts` | Server-side Sentry for Node.js runtime |
| `sentry.edge.config.ts` | Edge runtime Sentry (middleware) |
| `next.config.ts` | `withSentryConfig()` wrapper for source maps |
| `instrumentation.ts` | Next.js hook, initializes OpenTelemetry + Sentry |

### Error Handling
| File | Purpose |
|------|---------|
| `src/lib/errorHandling.ts` | Centralized error categorization, Sentry capture |
| `src/app/error.tsx` | Page-level error boundary |
| `src/app/global-error.tsx` | Global error boundary |
| `src/app/api/monitoring/route.ts` | Sentry tunnel endpoint |

### Logging Infrastructure
| File | Purpose |
|------|---------|
| `src/lib/server_utilities.ts` | Server logger (console + file + Sentry breadcrumbs + OTLP) |
| `src/lib/client_utilities.ts` | Client logger (console + Sentry breadcrumbs) |
| `src/lib/logging/server/otelLogger.ts` | OTLP logger to Honeycomb |
| `src/lib/logging/client/consoleInterceptor.ts` | localStorage persistence |
| `src/lib/logging/client/remoteFlusher.ts` | Batched log sending to server |
| `src/app/api/client-logs/route.ts` | Receives client logs, forwards to OTLP |

### Tracing Infrastructure
| File | Purpose |
|------|---------|
| `src/lib/tracing/browserTracing.ts` | Browser-side OpenTelemetry (lazy loaded) |
| `src/lib/tracing/fetchWithTracing.ts` | W3C traceparent header injection |
| `src/lib/requestIdContext.ts` | AsyncLocalStorage context propagation |
| `src/app/api/traces/route.ts` | Proxy browser traces to Honeycomb |

---

## Detailed Findings

### 1. Existing Sentry Integration

**Package:** `@sentry/nextjs@^10.32.1` (production dependency)

**Configuration Files (all at project root):**

```typescript
// sentry.client.config.ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tunnel: "/api/monitoring",
  tracesSampleRate: isDev ? 1.0 : 0.2,  // Configurable via SENTRY_TRACES_SAMPLE_RATE
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
  // Error filtering for non-actionable errors
});

// sentry.server.config.ts
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: isDev ? 1.0 : 0.2,
  // Similar error filtering
});

// sentry.edge.config.ts
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: isDev ? 1.0 : 0.2,
});
```

**Key Features Already Implemented:**
- ✅ Multi-runtime support (client, server, edge)
- ✅ Tunnel endpoint `/api/monitoring` (bypasses ad blockers)
- ✅ Session replay (10% sessions, 100% error sessions)
- ✅ Browser tracing integration
- ✅ Error filtering (ResizeObserver, AbortError, etc.)
- ✅ Source map uploads via `withSentryConfig()`
- ✅ Error boundaries (`error.tsx`, `global-error.tsx`)
- ✅ Centralized error handling with categorization

**Not Yet Enabled:**
- ❌ `enableLogs: true` (Sentry's structured logging feature)
- ❌ Custom OpenTelemetry integration (uses Sentry's automatic setup)

### 2. Logging Infrastructure

**Server-Side Logger (`src/lib/server_utilities.ts`):**
```typescript
const logger = {
  debug: (message, data) => { /* console + file + Sentry breadcrumb + OTLP */ },
  info: (message, data) => { /* same */ },
  warn: (message, data) => { /* same */ },
  error: (message, data) => { /* same */ },
};
```

**Destinations:**
1. Console output with level prefix
2. `server.log` file (NDJSON format)
3. Sentry breadcrumb (for error correlation timeline)
4. Honeycomb via OTLP (`emitLog()` function)

**Client-Side Logger (`src/lib/client_utilities.ts`):**
- Console output
- Sentry breadcrumb
- localStorage buffer → `/api/client-logs` → Honeycomb OTLP

**OTLP Logger (`src/lib/logging/server/otelLogger.ts`):**
```typescript
export function emitLog(level, message, data, source = 'server') {
  // Flattens nested data to dot notation
  // Includes trace_id and span_id for correlation
  // Production: only ERROR/WARN unless OTEL_SEND_ALL_LOG_LEVELS=true
}
```

### 3. OpenTelemetry Tracing

**Initialization (`instrumentation.ts`):**
- Creates 4 domain-specific tracers:
  - `explainanything-llm` - LLM/AI operations
  - `explainanything-database` - Database operations
  - `explainanything-vector` - Pinecone/vector operations
  - `explainanything-application` - General app flows
- Auto-instruments fetch for Pinecone and Supabase calls
- Registers unhandledRejection listener

**Browser Tracing (`src/lib/tracing/browserTracing.ts`):**
- Lazy-loaded (~60KB gzipped)
- Sends traces to `/api/traces` proxy endpoint
- Production: always enabled; Dev: requires `NEXT_PUBLIC_ENABLE_BROWSER_TRACING=true`

**Fetch Tracing (`src/lib/tracing/fetchWithTracing.ts`):**
- Wraps fetch with W3C `traceparent` header injection
- Records span attributes: `http.status_code`, `http.url`, `http.method`

### 4. Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `SENTRY_DSN` | Server | Server-side Sentry DSN |
| `NEXT_PUBLIC_SENTRY_DSN` | Client | Client-side Sentry DSN |
| `SENTRY_TRACES_SAMPLE_RATE` | Both | Trace sampling (default: 0.2 prod, 1.0 dev) |
| `SENTRY_REPLAYS_SESSION_RATE` | Client | Session replay rate (default: 0.1) |
| `SENTRY_REPLAYS_ERROR_RATE` | Client | Error replay rate (default: 1.0) |
| `SENTRY_AUTH_TOKEN` | Build | Source map upload authentication |
| `SENTRY_ORG` | Build | Sentry organization slug |
| `SENTRY_PROJECT` | Build | Sentry project name |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Server | Honeycomb OTLP endpoint |
| `OTEL_EXPORTER_OTLP_HEADERS` | Server | Honeycomb API key headers |
| `OTEL_SEND_ALL_LOG_LEVELS` | Server | Send all logs to Honeycomb (default: false) |
| `NEXT_PUBLIC_ENABLE_BROWSER_TRACING` | Client | Enable browser OpenTelemetry |
| `NEXT_PUBLIC_LOG_ALL_LEVELS` | Client | Send all client logs to server |

---

## Sentry Integration Options

### Option 1: Enable Sentry Logs Feature (Recommended)
Add `enableLogs: true` to all three Sentry configs and use `Sentry.logger.*` methods.

**Pros:**
- Native integration with Sentry's new Logs product
- Logs appear alongside errors with full context
- No additional infrastructure needed

**Cons:**
- Requires SDK v9.41.0+ (current is v10.32.1, compatible)
- May duplicate logs already going to Honeycomb

### Option 2: Forward OpenTelemetry Traces to Sentry
Use `@sentry/opentelemetry` to add `SentrySpanProcessor` to existing setup.

**Pros:**
- Traces appear in Sentry alongside errors
- Unified view in Sentry dashboard

**Cons:**
- Duplicates traces (both Honeycomb and Sentry)
- Increased data costs

### Option 3: Use Custom OpenTelemetry Setup
Set `skipOpenTelemetrySetup: true` and manually register Sentry components.

**Required components from `@sentry/opentelemetry`:**
- `SentrySampler` - Respects Sentry's tracesSampleRate
- `SentryPropagator` - Trace propagation across services
- `SentryContextManager` - Context synchronization
- `SentrySpanProcessor` - Sends spans to Sentry

**Pros:**
- Full control over what goes where
- Can selectively send traces to Sentry

**Cons:**
- More complex configuration
- Requires maintaining OpenTelemetry setup

---

## Recommended Approach

### Phase 1: Enable Sentry Logs
1. Add `enableLogs: true` to all three Sentry config files
2. Use `Sentry.logger.*` methods for critical logs that should appear in Sentry
3. Keep existing Honeycomb logging for detailed telemetry

### Phase 2: Evaluate Trace Integration
1. Monitor current setup for gaps
2. Consider adding `SentrySpanProcessor` only for error-related traces
3. Keep Honeycomb as primary trace destination (better for detailed analysis)

---

## Related Planning Documents
- `docs/planning/sentry_integration_plan/` - Previous Sentry integration work
- `docs/planning/improve_sentry_and_honeycomb_integrations/` - Recent observability improvements
- `docs/planning/sentry_not_catching_errors_prod_20260110/` - Production debugging

---

---

## Deep Dive: Sentry Logs API (Round 2 Research)

### Logger Methods - Complete Reference

**Six log levels (in severity order):**
```typescript
Sentry.logger.trace("Fine-grained debug info", { database: "users" });
Sentry.logger.debug("Debug information");
Sentry.logger.info("General info", { userId: "123" });
Sentry.logger.warn("Warning", { endpoint: "/api/results/" });
Sentry.logger.error("Error message", { orderId: "order_123" });
Sentry.logger.fatal("Critical failure", { database: "users" });
```

**Printf-style formatting (server-side):**
```typescript
Sentry.logger.info("User %s logged in successfully", ["John Doe"]);
Sentry.logger.warn("Failed to load user %s data", ["John Doe"], { errorCode: 404 });
```

**Template literals with `fmt` (browser):**
```typescript
const user = "John";
const product = "Product 1";
Sentry.logger.info(Sentry.logger.fmt`'${user}' added '${product}' to cart.`);
// Parameters accessible as sentry.message.parameter.0, sentry.message.parameter.1
```

### Configuration Pattern

```typescript
Sentry.init({
  dsn: "___PUBLIC_DSN___",
  enableLogs: true,  // Required to enable log capture

  // Filter logs at SDK level (most effective for quota)
  beforeSendLog: (log) => {
    // log object: { level, message, timestamp, attributes, span_id?, trace_id? }
    if (process.env.NODE_ENV === 'production' && log.level === 'trace') {
      return null;  // Discard
    }
    return log;  // Send
  },

  // Capture console calls automatically
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
    // Or: Sentry.pinoIntegration() for Pino
  ],
});
```

### Log Correlation with Traces

When logged within an active span, logs automatically include:
- `span_id` - ID of active span
- `trace_id` - Global trace identifier
- `timestamp` - Creation time

**Benefits in Sentry UI:**
- Filter logs by `trace_id` to see entire request flow
- Reconstruct execution order using span relationships
- View logs + spans + errors together in Trace View

### Rate Limits & Quotas

- Dedicated `log_item` data category
- Relay caps at 1,000 logs per envelope
- SDKs batch at ≤100 logs per envelope
- Filtering at source (`beforeSendLog`) is most effective for quota

---

## Deep Dive: OpenTelemetry → Sentry (Round 2 Research)

### How Sentry Receives Traces

**Automatic (default):** Sentry configures OpenTelemetry automatically. Any OTel instrumentation emitting spans is picked up without configuration.

**Custom setup:** Set `skipOpenTelemetrySetup: true` to manually configure.

### Sending Traces to BOTH Honeycomb AND Sentry

```typescript
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { SentrySpanProcessor, SentryPropagator, SentrySampler } from "@sentry/opentelemetry";
import * as Sentry from "@sentry/node";

// Initialize Sentry with custom setup
const sentryClient = Sentry.init({
  dsn: "your-sentry-dsn",
  skipOpenTelemetrySetup: true,
  tracesSampleRate: 1.0,
});

// Create provider with Sentry sampler
const provider = new NodeTracerProvider({
  sampler: sentryClient ? new SentrySampler(sentryClient) : undefined,
});

// Add BOTH processors
provider.addSpanProcessor(new SentrySpanProcessor());  // → Sentry
provider.addSpanProcessor(new BatchSpanProcessor(      // → Honeycomb
  new OTLPTraceExporter({
    url: "https://api.honeycomb.io/v1/traces",
    headers: { "x-honeycomb-team": "your-api-key" },
  })
));

// Register with Sentry components
provider.register({
  propagator: new SentryPropagator(),
  contextManager: new Sentry.SentryContextManager(),
});

Sentry.validateOpenTelemetrySetup();
```

### ⚠️ Critical Caveat: SentryPropagator + Honeycomb

**Problem:** If frontend uses Sentry but backend uses Honeycomb, `SentryPropagator` on backend receives Sentry's Baggage header and **breaks Honeycomb's trace view**.

**Solution:** Do NOT include `SentryPropagator` in backend OTel config if:
- Frontend sends requests via fetch()
- Frontend uses Sentry
- Backend sends to Honeycomb

**Source:** [Sentry's distributed tracing causes missing parent spans in Honeycomb](https://macwright.com/2025/12/22/sentry-otel-honeycomb)

### Required Components for Custom Setup

| Component | Purpose | Required? |
|-----------|---------|-----------|
| `SentrySpanProcessor` | Sends spans to Sentry | Only if sending traces to Sentry |
| `SentryContextManager` | Context isolation between requests | **Always** |
| `SentryPropagator` | Trace propagation (`sentry-trace` headers) | **Always** (but see caveat above) |
| `SentrySampler` | Respects `tracesSampleRate` | **Always** |

---

## Deep Dive: Next.js App Router Patterns (Round 2 Research)

### Gap Found: Server Actions Not Instrumented

**Current state:** Server Actions in `/src/app/login/actions.ts` are NOT wrapped with `withServerActionInstrumentation`.

**Recommended pattern:**
```typescript
import { withServerActionInstrumentation } from '@sentry/nextjs';

export async function login(formData: FormData) {
  return withServerActionInstrumentation(
    'login',
    { formData },
    async () => {
      // Current login logic here
    }
  );
}
```

### Gap Found: Route Handlers Missing Explicit Capture

**Current state:** Route Handlers don't call `Sentry.captureException()` explicitly.

**Recommended pattern:**
```typescript
import * as Sentry from '@sentry/nextjs';

export async function POST(request: Request) {
  try {
    // Handler logic
  } catch (error) {
    Sentry.captureException(error, {
      tags: { endpoint: '/api/stream-chat' }
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

### Current Implementation Strengths

✅ **File structure correct** - All Sentry configs at root level
✅ **instrumentation.ts advanced** - Custom OTel tracers, fetch wrapping, error handlers
✅ **Tunnel endpoint correct** - `/api/monitoring` properly configured
✅ **Source maps correct** - `widenClientFileUpload`, `hideSourceMaps`, `reactComponentAnnotation`
✅ **onRequestError exported** - Required for Next.js 15

---

## Revised Recommended Approach

### Phase 1: Enable Sentry Logs (Quick Win)

**Files to modify:**
1. `sentry.client.config.ts` - Add `enableLogs: true`
2. `sentry.server.config.ts` - Add `enableLogs: true`
3. `sentry.edge.config.ts` - Add `enableLogs: true`

**Optional:** Add `beforeSendLog` to filter verbose logs in production.

### Phase 2: Instrument Server Actions

**Files to modify:**
- `src/app/login/actions.ts` - Wrap with `withServerActionInstrumentation`
- Any other Server Actions found in codebase

### Phase 3: Add Explicit Error Capture to Route Handlers

**Files to modify:**
- `src/app/api/stream-chat/route.ts`
- `src/app/api/health/route.ts`
- Other Route Handlers

### Phase 4 (Optional): Dual Trace Export

**Only if needed:** Add `SentrySpanProcessor` to send traces to both Honeycomb and Sentry.

**Caution:** Avoid `SentryPropagator` if it breaks Honeycomb trace correlation.

---

## Open Questions

1. **Dual logging cost:** Should logs go to both Honeycomb AND Sentry, or selectively route?
2. **Trace destination:** Keep traces in Honeycomb only, or also send to Sentry?
3. **Log level filtering:** What severity levels should go to Sentry Logs?
4. **Sample rates:** Current 20% prod trace sampling - appropriate for Sentry Logs?
5. **Server Actions:** How many Server Actions need instrumentation?
6. **SentryPropagator caveat:** Does this affect our Honeycomb setup?
