# Sentry Not Catching Errors Prod Research

**Date**: 2026-01-10T16:17:20Z
**Researcher**: Claude
**Git Commit**: 9ed4572bb2966d0bf3dbdbee6a998f9d262f8c98
**Branch**: fix/sentry_not_catching_errors_prod_20260110
**Repository**: Minddojo/explainanything

## Problem Statement

Sentry is not triggering/capturing errors in production. Need to investigate the configuration, initialization, and any conditional logic that might prevent error reporting.

## High Level Summary

The codebase has a comprehensive Sentry setup with client, server, and edge configurations, tunnel endpoint, error boundaries, and centralized error handling. However, several potential issues were identified that could prevent production error reporting:

1. **Tunnel endpoint silently succeeds** when `SENTRY_DSN` is missing - client SDK won't know events failed
2. **Client config missing `environment` field** - harder to filter production errors in Sentry dashboard
3. **`beforeSend` filters may be too aggressive** - filtering errors that should be reported
4. **Production trace sampling at 20%** - performance traces only capture 1 in 5 transactions
5. **Production log level set to ERROR only** - warnings and below not sent to Sentry

## Configuration Files Overview

### 1. Client Configuration (`sentry.client.config.ts`)

```typescript
// Key configuration
dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
tunnel: "/api/monitoring",  // Bypasses ad blockers
tracesSampleRate: 0.2,      // 20% in production, 100% in dev
replaysOnErrorSampleRate: 1.0,  // 100% replay on errors
```

**Integrations enabled:**
- `Sentry.replayIntegration()` - Session replay with full DOM capture
- `Sentry.browserTracingIntegration()` - Browser performance tracking

**beforeSend filter (lines 41-56)** filters out:
- ResizeObserver errors
- Non-Error promise rejections
- AbortError
- "Load failed" (Safari network errors)
- "Script error" (Cross-origin script errors)

### 2. Server Configuration (`sentry.server.config.ts`)

```typescript
dsn: process.env.SENTRY_DSN,
environment: process.env.NODE_ENV,
tracesSampleRate: 0.2,  // 20% in production
```

**beforeSend filter** - Same as client minus "Script error"

### 3. Edge Configuration (`sentry.edge.config.ts`)

```typescript
dsn: process.env.SENTRY_DSN,
environment: process.env.NODE_ENV,
tracesSampleRate: 0.2,
// NO beforeSend filter
```

### 4. Tunnel Endpoint (`src/app/api/monitoring/route.ts`)

```typescript
// Lines 18-22 - Silent failure if DSN not configured
const dsn = process.env.SENTRY_DSN;
if (!dsn) {
  return new NextResponse(null, { status: 200 });  // SILENT SUCCESS
}
```

**Critical**: Client SDK receives 200 status even when events aren't forwarded.

## Error Boundary Setup

### App Error Boundary (`src/app/error.tsx`)
- Uses `Sentry.captureException(error)` in useEffect
- Includes `digest` and `componentStack` in extra context
- Catches errors in page components and nested layouts

### Global Error Boundary (`src/app/global-error.tsx`)
- Same pattern as error.tsx
- Catches errors in root layout
- Must render its own `<html>` and `<body>` tags

### Central Error Handler (`src/lib/errorHandling.ts`)

```typescript
// handleError() function - lines 150-175
Sentry.withScope((scope) => {
  scope.setTag('requestId', requestContext.requestId);
  scope.setTag('sessionId', requestContext.sessionId);
  scope.setUser({ id: requestContext.userId });
  scope.setTag('errorCode', errorResponse.code);
  scope.setLevel(getSentryLevel(errorResponse.code));
  Sentry.captureException(error);
});
```

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `SENTRY_DSN` | Server/Edge DSN | Yes for production |
| `NEXT_PUBLIC_SENTRY_DSN` | Client DSN | Yes for production |
| `SENTRY_ORG` | Org slug for source maps | Optional |
| `SENTRY_PROJECT` | Project slug for source maps | Optional |
| `SENTRY_AUTH_TOKEN` | Auth for source map upload | Optional |
| `SENTRY_TRACES_SAMPLE_RATE` | Override trace sampling | Optional (default 0.2) |
| `SENTRY_REPLAYS_SESSION_RATE` | Session replay rate | Optional (default 0.1) |
| `SENTRY_REPLAYS_ERROR_RATE` | Error replay rate | Optional (default 1.0) |

## Production vs Development Differences

| Aspect | Development | Production |
|--------|-------------|------------|
| DSN configured | Usually empty | Vercel env vars |
| Trace sampling | 100% | 20% |
| Log level to Sentry | WARN | ERROR only |
| Local log storage | 500 logs | 200 logs |
| Browser tracing | Requires env var | Always enabled |
| Auto logging init | Yes | No |

## Documents Read
- `.env.example` - Sentry variable definitions
- `docs/docs_overall/environments.md` - Environment configuration
- `docs/planning/sentry_integration_plan/sentry_integration_plan.md` - Original integration plan

## Code Files Read

### Configuration
- `sentry.client.config.ts:1-57` - Client Sentry init
- `sentry.server.config.ts:1-36` - Server Sentry init
- `sentry.edge.config.ts:1-19` - Edge Sentry init
- `instrumentation.ts:1-136` - Next.js instrumentation hook
- `next.config.ts:28-61` - Webpack plugin config

### Error Handling
- `src/app/error.tsx:1-96` - App error boundary
- `src/app/global-error.tsx:1-96` - Global error boundary
- `src/lib/errorHandling.ts:1-184` - Central error handler
- `src/lib/logging/client/consoleInterceptor.ts:191-224` - Window error handlers

### Request Context
- `src/hooks/clientPassRequestId.ts:29-31` - Client Sentry context
- `src/lib/serverReadRequestId.ts:20-38` - Server Sentry context

### Tunnel Endpoint
- `src/app/api/monitoring/route.ts:1-61` - Sentry event forwarding

### Logging Integration
- `src/lib/client_utilities.ts:24-48` - Client breadcrumbs
- `src/lib/server_utilities.ts:79-108` - Server breadcrumbs
- `src/lib/logging/client/logConfig.ts:40-56` - Log level config

## Investigation Plan

### Phase 1: Verify Environment Variables (Quick Check)
1. Confirm `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` are set in Vercel Production
2. Verify the DSN values point to correct Sentry project (`minddojo/explainanything`)
3. Check Sentry dashboard for any recent events (even filtered ones)

### Phase 2: Test Error Reporting (Requires User Action)
1. **Create intentional error in production:**
   - Option A: Temporarily unset an env var that causes a crash
   - Option B: Add a test endpoint that throws an error
   - Option C: Use browser console to trigger: `throw new Error('Test Sentry')`

2. **Verify tunnel endpoint works:**
   - Check production logs for `/api/monitoring` requests
   - Verify DSN is being read correctly in tunnel endpoint

### Phase 3: Check Sentry Dashboard
1. Go to https://minddojo.sentry.io/issues/?project=explainanything
2. Check "All Issues" (not just unresolved)
3. Check if `beforeSend` is filtering legitimate errors
4. Verify environment tag filtering isn't hiding production errors

### Phase 4: Debug beforeSend Filter
1. The filter may be too aggressive
2. Consider logging when events are filtered to verify behavior
3. Check if production errors match any filter patterns

## Sampling Clarification (Important!)

**The 20% sampling does NOT affect error capture.** This is a common misconception.

### Sentry Sampling Types

| Setting | Current Value | What It Affects | Default |
|---------|---------------|-----------------|---------|
| `sampleRate` | **Not set** | Error events | 1.0 (100%) |
| `tracesSampleRate` | 0.2 (20% in prod) | Performance traces/transactions | 0 (disabled) |
| `replaysSessionSampleRate` | 0.1 (10%) | Session replays (general browsing) | 0 |
| `replaysOnErrorSampleRate` | 1.0 (100%) | Session replays when errors occur | 0 |

### Key Distinction

- **`tracesSampleRate`** = Performance monitoring (page loads, API call timing, spans)
- **`sampleRate`** = Error capture rate (defaults to 100% if not set)

From [Sentry Docs](https://docs.sentry.io/concepts/key-terms/sample-rates/):
> "The error sample rate defaults to 1.0, meaning all errors are sent to Sentry."

### Current Config Analysis

```typescript
// sentry.client.config.ts lines 14-17
tracesSampleRate: parseFloat(
  process.env.SENTRY_TRACES_SAMPLE_RATE ||
  (process.env.NODE_ENV === 'production' ? '0.2' : '1.0')  // Traces only!
),
```

**No `sampleRate` is set**, so errors are captured at 100%.

### To Override Trace Sampling

Set environment variable in Vercel:
```
SENTRY_TRACES_SAMPLE_RATE=1.0   # 100% of performance traces
```

### Bottom Line

**The 20% trace sampling is NOT causing missing errors.** Errors should be captured at 100%. The likely root causes remain:
1. Missing `environment` field in client config
2. Possibly missing `SENTRY_DSN` env var (tunnel silent failure)

Sources:
- https://docs.sentry.io/concepts/key-terms/sample-rates/
- https://docs.sentry.io/platforms/javascript/sampling/

## Key Questions to Verify

1. Are `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` set in Vercel Production?
2. Is the tunnel endpoint (`/api/monitoring`) receiving POST requests?
3. Are events reaching Sentry but being filtered by `beforeSend`?
4. Is the Sentry dashboard filtering by environment (hiding production)?
5. Are errors occurring but not being caught by error boundaries?
