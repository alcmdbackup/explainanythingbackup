# Sentry Integration for ExplainAnything

> **Status: ✅ COMPLETE** — All phases implemented and verified (Dec 2024)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Client                         │  Server                       │
├─────────────────────────────────┼───────────────────────────────┤
│  sentry.client.config.ts        │  sentry.server.config.ts      │
│  ↓                              │  sentry.edge.config.ts        │
│  clientPassRequestId.ts         │  ↓                            │
│  (sets user/requestId/session)  │  serverReadRequestId.ts       │
│  ↓                              │  (Sentry.withScope for all    │
│  client_utilities.ts            │   50+ server actions)         │
│  (breadcrumbs)                  │  ↓                            │
│  ↓                              │  server_utilities.ts          │
│  /api/monitoring (tunnel)  ────→│  (breadcrumbs)                │
│                                 │  ↓                            │
│                                 │  errorHandling.ts             │
│                                 │  (captureException + tags)    │
└─────────────────────────────────┴───────────────────────────────┘
                                  ↓
                         Sentry Dashboard
                    (minddojo.sentry.io)
```

**Key Design Decisions:**
- `handleError()` sends Sentry events; `logger.*` sends breadcrumbs only (no duplicates)
- Single integration point in `serverReadRequestId.ts` captures context for all server actions
- Tunnel at `/api/monitoring` bypasses ad blockers
- Grafana keeps OTEL traces; Sentry handles error-correlated traces separately

---

## Dashboard Access

| View | URL |
|------|-----|
| All Issues | https://minddojo.sentry.io/issues/?project=explainanything |
| Traces | https://minddojo.sentry.io/explore/traces/?project=4510618939490304 |
| Alerts | https://minddojo.sentry.io/alerts/rules/ |

---

## File Reference

| File | Purpose |
|------|---------|
| `sentry.client.config.ts` | Client init with tunnel, replay, browser tracing |
| `sentry.server.config.ts` | Server init with beforeSend filtering |
| `sentry.edge.config.ts` | Edge runtime init |
| `instrumentation.ts` | Loads configs + exports `onRequestError` |
| `src/app/global-error.tsx` | React error boundary |
| `src/app/api/monitoring/route.ts` | Tunnel endpoint (bypasses ad blockers) |
| `src/middleware.ts` | Excludes `/api/monitoring` from auth |
| `src/lib/serverReadRequestId.ts` | `Sentry.withScope()` for all server actions |
| `src/hooks/clientPassRequestId.ts` | Sets user/requestId/sessionId tags |
| `src/lib/server_utilities.ts` | Logger breadcrumbs (server) |
| `src/lib/client_utilities.ts` | Logger breadcrumbs (client) |
| `src/lib/errorHandling.ts` | `captureException()` with error codes |

---

## Environment Variables

```bash
# Required
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=<from Sentry dashboard>
SENTRY_ORG=minddojo
SENTRY_PROJECT=explainanything

# Optional (defaults shown)
SENTRY_TRACES_SAMPLE_RATE=0.2      # 1.0 in development
SENTRY_REPLAYS_SESSION_RATE=0.1
SENTRY_REPLAYS_ERROR_RATE=1.0
```

---

## Sample Error Output

When an error occurs, Sentry captures:

```
Error: LLM_API_ERROR - OpenAI rate limit exceeded

Tags:
  requestId: client-1703847234-x8k2m1
  sessionId: auth-a3f2b9c1e4d8
  errorCode: LLM_API_ERROR
  transaction: /api/returnExplanation

User: user-456

Breadcrumbs:
  12:34:01 [INFO] Function returnExplanation called
  12:34:02 [INFO] Vector search completed (145ms)
  12:34:03 [INFO] Calling OpenAI GPT-4
  12:34:05 [ERROR] OpenAI API error: rate limit exceeded

Context:
  nextjs.route_type: route
  nextjs.router_kind: App Router
  device.arch: arm64
  runtime: node v20.11.0

Session Replay: [Available for client errors]
```

---

## GitHub Integration

**Status:** ✅ Configured

Alert rules configured in Sentry dashboard:
- **New Critical Error** → Creates GitHub issue
- **Regression** → Creates GitHub issue (previously resolved reappears)

---

## Known Issues

### OpenTelemetry Duplicate Registration Warning
```
Error: @opentelemetry/api: Attempted duplicate registration of API: trace
```
This occurs because both Sentry and our custom OTEL setup register trace providers. It's harmless—Sentry gracefully handles the conflict and both systems work correctly.

### Turbopack Compatibility Warning
```
[@sentry/nextjs] WARNING: You are using the Sentry SDK with Turbopack.
The Sentry SDK is compatible with Turbopack on Next.js version 15.4.1 or later.
```
Current Next.js version is 15.2.8. Sentry still works but full Turbopack support requires upgrade.

---

## Verification (Completed Dec 29, 2024)

| Test | Result |
|------|--------|
| Error capture (server) | ✅ EXPLAINANYTHING-2 captured |
| Message capture | ✅ EXPLAINANYTHING-1 captured |
| Stacktraces | ✅ Full traces with source locations |
| Tags (requestId, userId, etc.) | ✅ Present |
| Context (nextjs, device, os) | ✅ Present |
| Trace propagation | ✅ trace_id linked |
| Tunnel endpoint | ✅ /api/monitoring working |
| GitHub integration | ✅ Issues auto-created |
