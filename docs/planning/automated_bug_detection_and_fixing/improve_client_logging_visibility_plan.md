# Improve Client Logging Visibility

## Status: IMPLEMENTED

All phases have been implemented and are working in production.

---

## Problem

Client logs (`logger.info()`, etc.) only appear in browser console. They:
1. Don't persist anywhere accessible for debugging
2. Don't correlate with server traces in Grafana

> **Note**: `/api/client-logs/route.ts` exists and IS functional (has 11 tests, called by test page). Consider integrating rather than deleting.

> **Scope Note**: Session ID tracking (cross-action correlation) is **out of scope** for this plan. It will be implemented separately per `session_id_vs_request_id_research.md`.

---

## Implementation Summary

| Phase | Status | Description |
|-------|--------|-------------|
| 0 | COMPLETED | CORS validation - **CORS blocked**, implemented proxy solution |
| 1 | COMPLETED | localStorage buffer with pre-hydration capture |
| 1.5 | COMPLETED | Remote flushing to `/api/client-logs` |
| 3 | COMPLETED | Browser OpenTelemetry via `/api/traces` proxy |
| 4 | COMPLETED | Trace propagation with `fetchWithTracing` |

### Key Finding: CORS Blocked

Direct browser→Grafana OTLP requests are blocked by CORS. The solution was to create a server-side proxy at `/api/traces` that forwards traces to Grafana with authentication.

---

## Files Created

| File | Purpose |
|------|---------|
| `src/app/(debug)/test-cors/page.tsx` | CORS validation test page |
| `src/app/api/traces/route.ts` | OTLP proxy endpoint (bypasses CORS) |
| `src/lib/logging/client/logConfig.ts` | Log level configuration |
| `src/lib/logging/client/earlyLogger.ts` | Pre-hydration log capture script |
| `src/lib/logging/client/consoleInterceptor.ts` | Console interception + localStorage |
| `src/lib/logging/client/remoteFlusher.ts` | Batched remote log sending |
| `src/lib/logging/client/__tests__/consoleInterceptor.test.ts` | Unit tests |
| `src/lib/logging/client/__tests__/remoteFlusher.test.ts` | Unit tests |
| `src/lib/tracing/browserTracing.ts` | Browser OpenTelemetry setup |
| `src/lib/tracing/fetchWithTracing.ts` | Traced fetch wrapper |
| `src/lib/tracing/__tests__/browserTracing.test.ts` | Unit tests |
| `src/lib/tracing/__tests__/fetchWithTracing.test.ts` | Unit tests |
| `src/components/ClientInitializer.tsx` | Client-side initialization component |

## Files Modified

| File | Change |
|------|--------|
| `src/app/layout.tsx` | Added early logger script + ClientInitializer |
| `src/middleware.ts` | Excluded `/api/traces` from auth middleware |
| `package.json` | Added OpenTelemetry dependencies |

---

## Environment Variables

Add these to `.env.local`:

```bash
# Server-side tracing (used by npm run dev script and /api/traces proxy)
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-west-0.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64_token>"

# Browser-side (not directly used - proxy handles auth, but kept for reference)
NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT=https://otlp-gateway-prod-us-west-0.grafana.net/otlp
NEXT_PUBLIC_GRAFANA_OTLP_TOKEN=<base64_token>

# Enable browser tracing in development
NEXT_PUBLIC_ENABLE_BROWSER_TRACING=true
```

### Token Format

The token must be base64-encoded in format `instanceId:apiKey`. Get it from:
1. Grafana Cloud → Your Stack → Connections → OpenTelemetry
2. Generate an API token
3. The token is provided already base64-encoded (do NOT encode it again)

**Common mistake**: Double-encoding the token causes `401 Unauthorized` errors.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                           BROWSER                                │
├─────────────────────────────────────────────────────────────────┤
│  earlyLogger.ts          Pre-hydration log capture (inline)     │
│  consoleInterceptor.ts   Console → localStorage buffer          │
│  remoteFlusher.ts        localStorage → /api/client-logs        │
│  browserTracing.ts       OpenTelemetry → /api/traces proxy      │
│  fetchWithTracing.ts     Adds traceparent header to fetch       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                           SERVER                                 │
├─────────────────────────────────────────────────────────────────┤
│  /api/client-logs        Receives batched logs, writes to file  │
│  /api/traces             Forwards OTLP to Grafana (with auth)   │
│  instrumentation.ts      Auto-traces Supabase/Pinecone calls    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                        GRAFANA CLOUD                             │
├─────────────────────────────────────────────────────────────────┤
│  Tempo                   Stores traces (service: explainanything)│
│  Explore                 Query traces by service name            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Usage

### View Local Logs (Browser Console)

```javascript
// Export all captured logs as JSON
window.exportLogs()

// Clear log buffer
window.clearLogs()
```

### View Server Logs

Check `client.log` file in project root (dev mode only).

### View Traces in Grafana

1. Go to Grafana Cloud → Explore
2. Select `grafanacloud-<stack>-traces` datasource
3. Search by service name:
   - `explainanything` - Server traces
   - `browser-client` - Browser traces (when using traced fetch)

### Using Traced Fetch

```typescript
import { fetchWithTracing } from '@/lib/tracing/fetchWithTracing';

// This creates a span and injects traceparent header
const response = await fetchWithTracing('/api/endpoint', {
  method: 'POST',
  body: JSON.stringify(data),
});
```

---

## Implementation Details

### Phase 0: CORS Validation

**Result**: CORS BLOCKED

Grafana's OTLP endpoint does not include CORS headers for browser requests. The solution was to create `/api/traces` as a server-side proxy.

### Phase 1: localStorage Buffer

- Pre-hydration logs captured via inline script before React hydrates
- Console methods intercepted and logged to localStorage
- Log level filtering (debug in dev, warn+ in prod)
- Max 500 logs in dev, 200 in prod
- Error handlers capture uncaught errors and unhandled rejections
- HMR cleanup prevents stacked console wrappers

### Phase 1.5: Remote Flushing

- Batches logs every 30 seconds using `requestIdleCallback`
- Uses `sendBeacon` on page hide for reliability
- Offline-aware (skips when `navigator.onLine` is false)
- Sends to existing `/api/client-logs` endpoint

### Phase 3: Browser OpenTelemetry

**Key Changes from Original Plan**:

1. **CORS blocked** - Cannot send directly to Grafana from browser
2. **Proxy solution** - Created `/api/traces` endpoint that forwards to Grafana
3. **API v2.x change** - `WebTracerProvider` uses constructor options instead of `addSpanProcessor` method:

```typescript
// Old API (broken in v2.x)
const provider = new WebTracerProvider();
provider.addSpanProcessor(new BatchSpanProcessor(exporter)); // Error!

// New API (v2.x)
const provider = new WebTracerProvider({
  spanProcessors: [new BatchSpanProcessor(exporter)],
});
```

4. **Middleware exclusion** - `/api/traces` added to auth middleware exclusions

### Phase 4: Trace Propagation

- `fetchWithTracing` wrapper injects W3C `traceparent` header
- Creates spans with HTTP attributes (status, URL, method)
- Enables client→server trace correlation in Grafana

---

## Checklist (All Complete)

### Phase 0: CORS Validation
- [x] Create `src/app/(debug)/test-cors/page.tsx`
- [x] Add OTLP env vars to `.env.local`
- [x] Run CORS test and document result → **BLOCKED**
- [x] Implement proxy solution at `/api/traces`

### Phase 1: localStorage Buffer
- [x] Create `src/lib/logging/client/logConfig.ts`
- [x] Create `src/lib/logging/client/earlyLogger.ts`
- [x] Create `src/lib/logging/client/consoleInterceptor.ts`
- [x] Create `src/components/ClientInitializer.tsx`
- [x] Modify `src/app/layout.tsx`
- [x] Create unit tests
- [x] Verify with `window.exportLogs()`

### Phase 1.5: Remote Flushing
- [x] Create `src/lib/logging/client/remoteFlusher.ts`
- [x] Create unit tests
- [x] Integrate with `/api/client-logs`

### Phase 3: Browser OpenTelemetry
- [x] Install OTel packages
- [x] Create `src/lib/tracing/browserTracing.ts` with v2.x API
- [x] Create `/api/traces` proxy endpoint
- [x] Add `/api/traces` to middleware exclusions
- [x] Create unit tests
- [x] Verify traces in Grafana Tempo

### Phase 4: Trace Propagation
- [x] Create `src/lib/tracing/fetchWithTracing.ts`
- [x] Create unit tests

---

## Test Results

All tests pass:
- **Unit tests**: 2200+ passed
- **Integration tests**: 103 passed
- **E2E tests**: 12 passed
- **TypeScript**: No errors
- **Lint**: No errors

---

## Troubleshooting

### "Failed to initialize browser tracing: provider.addSpanProcessor is not a function"

The OpenTelemetry SDK v2.x changed the API. Span processors must be passed in the constructor:

```typescript
const provider = new WebTracerProvider({
  spanProcessors: [new BatchSpanProcessor(exporter)],
});
```

### 401 Unauthorized from Grafana

The token format is wrong. Check:
1. Token should be `instanceId:apiKey` base64-encoded
2. Don't double-encode - Grafana provides it already encoded
3. Use the token from `package.json` dev script as reference

### "Failing to connect to Tempo" in Grafana UI

This is a Grafana UI issue, not trace ingestion. Try:
1. Select `grafanacloud-<stack>-traces` datasource (not just "Tempo")
2. Use Search tab, not TraceQL
3. Look for service name in dropdown

### Traces not appearing in Grafana

1. Verify `/api/traces` returns `{"success":true}`
2. Check server logs for `📡 Traces going to: ...`
3. Wait 1-2 minutes for Grafana to index traces
4. Search for `service.name = "explainanything"` or `service.name = "browser-client"`
