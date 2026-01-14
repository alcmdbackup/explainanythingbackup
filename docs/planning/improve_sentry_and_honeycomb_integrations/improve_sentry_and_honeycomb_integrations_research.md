# Improve Sentry and Honeycomb Integrations Research

---
date: 2026-01-11T10:30:00-08:00
researcher: Claude
git_commit: 4669b11be0d73df605684fc3300c591d43f48ae2
branch: fix/improve_sentry_and_honeycomb_integrations
repository: explainanything
topic: "Improving Sentry and Honeycomb observability integrations"
tags: [research, observability, sentry, honeycomb, tracing, logging, mcp]
status: complete
last_updated: 2026-01-11
last_updated_by: Claude
---

## Problem Statement

The Sentry and Honeycomb integrations have been set up, but there are outstanding issues:
1. Honeycomb connection is not working
2. Honeycomb is not receiving traces of logs
3. Sentry is not receiving traces of logs
4. Need a way for Claude Code to systematically utilize both tools via MCP or CLI

## High Level Summary

The codebase has a **production-grade observability stack** using:
- **OpenTelemetry (OTLP)** for distributed tracing and structured logging
- **Honeycomb** (recently migrated from Grafana) as the OTLP backend
- **Sentry** for error tracking, session replay, and performance monitoring

**Key Findings:**

| Component | Status | Known Issues |
|-----------|--------|--------------|
| **Honeycomb OTLP Traces** | ✅ Configured | May not be receiving data - endpoint/auth issues |
| **Honeycomb OTLP Logs** | ✅ Configured | Production only sends ERROR/WARN by default |
| **Sentry Error Tracking** | ✅ Configured | Working; traces separate from OTLP |
| **Sentry MCP for Claude** | ✅ Enabled | Full access to issues, traces, events |
| **Honeycomb MCP** | ❌ Not available | Must use web UI or REST API |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER                                       │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │ Console Logs     │     │ Browser Traces   │                      │
│  │ (intercepted)    │     │ (WebTracerProvider)                     │
│  └────────┬─────────┘     └────────┬─────────┘                      │
│           │ localStorage           │ BatchSpanProcessor              │
│           ▼                        ▼                                 │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │ Remote Flusher   │     │ OTLP Exporter    │                      │
│  │ (30s batches)    │     │ → /api/traces    │                      │
│  └────────┬─────────┘     └────────┬─────────┘                      │
└───────────┼────────────────────────┼────────────────────────────────┘
            │                        │
            ▼                        ▼
┌───────────────────────────────────────────────────────────────────┐
│                        SERVER (Next.js)                            │
│  ┌──────────────────┐     ┌──────────────────┐                    │
│  │ /api/client-logs │     │ /api/traces      │  (CORS proxies)    │
│  └────────┬─────────┘     └────────┬─────────┘                    │
│           │                        │                               │
│           ▼                        ▼                               │
│  ┌──────────────────────────────────────────┐                     │
│  │         OpenTelemetry SDK                 │                     │
│  │  - OTLPLogExporter (→ /v1/logs)          │                     │
│  │  - Auto-instrumentation (Node.js)         │                     │
│  │  - Custom tracers (LLM, DB, Vector, App)  │                     │
│  └────────────────────┬─────────────────────┘                     │
│                       │                                            │
│  ┌──────────────────────────────────────────┐                     │
│  │ Sentry SDK (separate from OTLP)          │                     │
│  │  - Error capture                          │                     │
│  │  - Session replay                         │                     │
│  │  - Performance (browserTracingIntegration)│                     │
│  │  - Tunnel: /api/monitoring                │                     │
│  └────────────────────┬─────────────────────┘                     │
└───────────────────────┼─────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  HONEYCOMB   │ │   SENTRY     │ │ Sentry MCP   │
│  /v1/traces  │ │ ingest.io    │ │ (Claude Code)│
│  /v1/logs    │ │              │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
```

---

## Detailed Findings

### 1. Honeycomb Integration

#### Configuration Files

| File | Purpose |
|------|---------|
| `.env.example:21-38` | Environment variable documentation |
| `src/lib/logging/server/otelLogger.ts` | OTLP log exporter to Honeycomb |
| `src/app/api/traces/route.ts` | Browser traces proxy to Honeycomb |
| `src/lib/tracing/browserTracing.ts` | Browser-side WebTracerProvider |
| `instrumentation.ts` | Server-side tracing setup |

#### Environment Variables

```bash
# Required for Honeycomb
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_HONEYCOMB_API_KEY
OTEL_SERVICE_NAME=explainanything

# Optional log level controls
OTEL_SEND_ALL_LOG_LEVELS=false      # Runtime: send DEBUG/INFO logs
NEXT_PUBLIC_LOG_ALL_LEVELS=false    # Build-time: client sends all levels
NEXT_PUBLIC_ENABLE_BROWSER_TRACING=false  # Enable browser traces
```

#### Known Issues

1. **Header Parsing Format** (`otelLogger.ts:39-50`)
   - Format must be: `x-honeycomb-team=YOUR_KEY` or comma-separated `key=value`
   - Incorrect format = silent failure

2. **Production Log Level Filtering** (`otelLogger.ts:121-126`)
   - Only ERROR/WARN sent by default
   - DEBUG/INFO require `OTEL_SEND_ALL_LOG_LEVELS=true`

3. **Browser Tracing Conditional** (`browserTracing.ts:28-30`)
   - Only enabled in production or with explicit env var
   - No warning if initialization fails

4. **Missing Endpoint Silent Failure** (`api/traces/route.ts:16-22`)
   - Returns 503 if `OTEL_EXPORTER_OTLP_ENDPOINT` not configured
   - Client doesn't know traces failed

5. **SimpleLogRecordProcessor** (`otelLogger.ts:83-88`)
   - Uses synchronous sends (inefficient for production)
   - Should use `BatchLogRecordProcessor`

---

### 2. Sentry Integration

#### Configuration Files

| File | Purpose |
|------|---------|
| `sentry.client.config.ts` | Client-side Sentry init with replay |
| `sentry.server.config.ts` | Server-side Sentry init |
| `sentry.edge.config.ts` | Edge runtime Sentry init |
| `src/app/api/monitoring/route.ts` | Tunnel endpoint (bypasses ad blockers) |
| `src/app/error.tsx` | App error boundary |
| `src/app/global-error.tsx` | Global error boundary |
| `src/lib/errorHandling.ts` | Central error handler |

#### Environment Variables

```bash
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=<from Sentry dashboard>
SENTRY_ORG=minddojo
SENTRY_PROJECT=explainanything
SENTRY_TRACES_SAMPLE_RATE=0.2  # 20% in production
SENTRY_REPLAYS_SESSION_RATE=0.1
SENTRY_REPLAYS_ERROR_RATE=1.0
```

#### Key Points

- **Error capture rate: 100%** - `sampleRate` not set, defaults to 1.0
- **Trace sampling: 20%** - Only affects performance traces, NOT errors
- **Tunnel endpoint**: `/api/monitoring` forwards events to Sentry, bypasses ad blockers
- **Session replay**: 10% all sessions, 100% when errors occur
- **beforeSend filters**: ResizeObserver, AbortError, "Load failed", "Script error"

#### Sentry vs OTLP Tracing

**IMPORTANT**: Sentry tracing is SEPARATE from OpenTelemetry tracing:

| Aspect | Sentry Tracing | OTLP Tracing (Honeycomb) |
|--------|---------------|-------------------------|
| SDK | `@sentry/nextjs` | `@opentelemetry/*` packages |
| Integration | `browserTracingIntegration()` | `WebTracerProvider` |
| Data destination | Sentry ingest | Honeycomb API |
| Correlation | Sentry-internal | W3C Traceparent headers |
| Purpose | Performance + errors | Distributed tracing + logs |

They run in parallel but are NOT linked by default.

---

### 3. Tracing Infrastructure

#### Custom OpenTelemetry Tracers

Defined in `instrumentation.ts:5-8`:

| Tracer | Purpose |
|--------|---------|
| `explainanything-llm` | LLM API calls (OpenAI) |
| `explainanything-database` | Database operations (Supabase) |
| `explainanything-vector` | Vector search (Pinecone) |
| `explainanything-application` | General app operations |

#### Trace Flow: Browser → Server → Honeycomb

1. **Browser**: `fetchWithTracing()` injects W3C `traceparent` header
2. **Server proxy**: `/api/traces` forwards spans to Honeycomb
3. **Auto-instrumentation**: Global fetch wrapper traces Pinecone/Supabase
4. **Span attributes**: Method, URL, status, response size, tokens, etc.

#### Test Coverage

- `src/lib/tracing/__tests__/browserTracing.test.ts`
- `src/lib/tracing/__tests__/fetchWithTracing.test.ts`
- `src/app/api/traces/route.test.ts`

---

### 4. MCP and CLI Tooling

#### Sentry MCP - ENABLED

**Configuration**: `settings.json:140`
```json
"sentry@claude-plugins-official": true
```

**Available Tools for Claude Code:**

| Tool | Purpose |
|------|---------|
| `mcp__plugin_sentry_sentry__whoami` | Get authenticated user |
| `mcp__plugin_sentry_sentry__find_organizations` | List organizations |
| `mcp__plugin_sentry_sentry__find_projects` | List projects |
| `mcp__plugin_sentry_sentry__search_issues` | Search issues (returns lists) |
| `mcp__plugin_sentry_sentry__search_events` | Search events + aggregations |
| `mcp__plugin_sentry_sentry__get_issue_details` | Get issue details |
| `mcp__plugin_sentry_sentry__get_trace_details` | Get trace details |
| `mcp__plugin_sentry_sentry__analyze_issue_with_seer` | AI root cause analysis |

**Sentry Project**: `minddojo/explainanything`

#### Honeycomb CLI - DOCUMENTED

**Query Guide**: `scripts/query-honeycomb.md`

No MCP plugin exists for Honeycomb. Access via:
1. **Web UI**: `https://ui.honeycomb.io` → Select `explainanything` dataset
2. **REST API**: Using `HONEYCOMB_API_KEY` header
3. **BubbleUp**: AI-powered outlier detection in UI

---

## Code References

### Honeycomb Configuration
- `src/lib/logging/server/otelLogger.ts:56-97` - OTLP log exporter setup
- `src/lib/tracing/browserTracing.ts:59-64` - Browser OTLP trace exporter
- `src/app/api/traces/route.ts:12-71` - Traces proxy endpoint

### Sentry Configuration
- `sentry.client.config.ts:14-49` - Client init with integrations
- `sentry.server.config.ts:8-35` - Server init with beforeSend
- `src/app/api/monitoring/route.ts:15-56` - Tunnel endpoint

### Error Handling
- `src/lib/errorHandling.ts:142-184` - handleError with Sentry capture
- `src/app/error.tsx:21-29` - Error boundary useEffect
- `src/lib/requestIdContext.ts:30-70` - Request context management

### Tracing
- `instrumentation.ts:42-101` - Global fetch instrumentation
- `src/lib/tracing/fetchWithTracing.ts:21-64` - W3C traceparent injection
- `src/lib/services/llms.ts:163-169` - LLM span creation

---

## Environment Comparison

| Environment | Honeycomb | Sentry | Notes |
|-------------|-----------|--------|-------|
| Local Dev | ❌ | ❌ | Not configured |
| Unit Tests | ❌ | ❌ | Mocked |
| Integration Tests | ❌ | ❌ | Mocked |
| E2E Tests | ❌ | ❌ | Not configured |
| GitHub CI | ❌ | ❌ | Not configured |
| Vercel Preview | ✅ | ✅ | Both enabled |
| Vercel Production | ✅ | ✅ | Both enabled |

---

## Documents Read

- `docs/docs_overall/environments.md` - Environment configuration
- `docs/planning/new_tracing_logging_vendor_20260110/new_tracing_logging_vendor_research.md` - Honeycomb migration research
- `docs/planning/sentry_not_catching_errors_prod_20260110/sentry_not_catching_errors_prod_20260110_research.md` - Sentry debugging
- `scripts/query-honeycomb.md` - Honeycomb query guide

## Code Files Read

### Configuration
- `sentry.client.config.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- `instrumentation.ts`
- `next.config.ts`
- `.env.example`
- `settings.json`

### API Routes
- `src/app/api/traces/route.ts`
- `src/app/api/monitoring/route.ts`
- `src/app/api/client-logs/route.ts`

### Logging/Tracing
- `src/lib/logging/server/otelLogger.ts`
- `src/lib/tracing/browserTracing.ts`
- `src/lib/tracing/fetchWithTracing.ts`

### Error Handling
- `src/lib/errorHandling.ts`
- `src/app/error.tsx`
- `src/app/global-error.tsx`
- `src/lib/requestIdContext.ts`

---

---

## Additional Research Findings (Round 2)

### 5. Local Environment Variable Verification

**`.env.local` Current Configuration:**
```bash
# Honeycomb is configured locally
x-honeycomb-team=e6BHBGspbuTr8f7vQnTLXG
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=e6BHBGspbuTr8f7vQnTLXG
OTEL_SERVICE_NAME=explainanything
```

**State Summary:**
- ✅ Honeycomb API endpoint configured
- ✅ Authentication headers configured with API key
- ✅ Service name set to `explainanything`
- ⚠️ `OTEL_SEND_ALL_LOG_LEVELS` not set (defaults to false - only ERROR/WARN sent)
- ⚠️ `NEXT_PUBLIC_ENABLE_BROWSER_TRACING` not set (browser traces disabled)

**Error Handling:**
- `otelLogger.ts:61-64`: Returns null and logs warning if endpoint not set
- `otelLogger.ts:93-96`: Catches and logs any initialization errors
- `/api/traces:16-21`: Returns 503 if endpoint not configured

---

### 6. Sentry-OTLP Integration Research

**Key Finding:** Sentry and OpenTelemetry traces run **in parallel without correlation**.

| Fact | Detail |
|------|--------|
| `@sentry/opentelemetry` installed | YES - in node_modules as transitive dependency |
| `@sentry/opentelemetry` used | **NO** - not imported in any config file |
| Trace ID correlation | **NO** - separate trace contexts |
| Can Sentry export to OTLP? | **NO** - Sentry only receives, doesn't export |

**Current Architecture:**
- OpenTelemetry traces → Honeycomb (via OTLP HTTP exporter)
- Sentry traces → Sentry (via DSN/tunnel)
- **No bridge between them**

**Options for Unification:**
1. Use OpenTelemetry Collector with Sentry exporter (external component)
2. Implement `@sentry/opentelemetry` SentrySpanProcessor (currently unused)
3. Configure Sentry to receive OTLP data at `https://{HOST}/api/{PROJECT_ID}/integration/otlp/v1/traces`

---

### 7. Honeycomb MCP Options

**Discovery: Honeycomb has an official hosted MCP server!**

| Option | Status | Description |
|--------|--------|-------------|
| **Honeycomb Hosted MCP** | ✅ GA | Official, free, OAuth auth, AWS Marketplace |
| Self-hosted MCP | ⚠️ Deprecated | Enterprise only, now recommends hosted |
| REST API | ✅ Available | Manual integration, async queries |

**Honeycomb Hosted MCP Features:**
- One-click integration with Cursor, VS Code, Claude Desktop
- OAuth authentication (no API key management)
- Zero additional charge for all Honeycomb tiers
- `.mcp.json` configuration for team-wide access

**Available MCP Tools:**
| Tool | Purpose |
|------|---------|
| `list_datasets` | Enumerate datasets |
| `get_columns` | Column metadata |
| `run_query` | Execute analytics queries |
| `analyze_columns` | Statistical metrics |
| `list_slos` / `get_slo` | Service Level Objectives |
| `list_triggers` / `get_trigger` | Alert configurations |
| `get_trace_link` | Generate UI deep links |
| `get_instrumentation_help` | OpenTelemetry guidance |

**References:**
- [Honeycomb Hosted MCP](https://www.honeycomb.io/blog/hosted-mcp-now-available)
- [Honeycomb MCP GA](https://www.honeycomb.io/blog/honeycomb-mcp-ga-support-bubbleup-heatmaps-histograms)

---

### 8. Sentry Production Error Check

**Using Sentry MCP tools, checked production for observability errors:**

| Search | Result |
|--------|--------|
| OTLP errors | ❌ None found |
| Honeycomb connection errors | ❌ None found |
| `/api/traces` route errors | ❌ None found |
| `/api/client-logs` route errors | ❌ None found |

**Overall Error Statistics (Last 7 Days):**
- Total errors: 7
- Active issues: 2
- All errors are test-related (E2E test error boundary tests)

**Conclusion:** No observability infrastructure errors detected in production. The OTLP stack appears to be functioning without throwing errors.

---

## Updated Answers to Open Questions

### 1. Why is Honeycomb not receiving data?

**Possible causes identified:**
- ⚠️ Browser tracing disabled (`NEXT_PUBLIC_ENABLE_BROWSER_TRACING=false`)
- ⚠️ Production only sends ERROR/WARN logs (may need activity to generate)
- ⚠️ No E2E tests verify actual Honeycomb connectivity
- ✅ Local config appears correct
- ✅ No errors in Sentry related to OTLP

**Action needed:** Verify Vercel production env vars and manually trigger a test error.

### 2. Should Sentry and OTLP tracing be unified?

**Answer:** The `@sentry/opentelemetry` package exists but is NOT used. Options:
1. Keep them separate (current state) - simpler but no correlation
2. Use `@sentry/opentelemetry` - bridges trace contexts
3. Send OpenTelemetry to Sentry's OTLP endpoint - centralizes in Sentry

### 3. What additional MCP capabilities needed?

**RESOLVED:** Honeycomb has an official hosted MCP server available!
- Add `.mcp.json` to repository to enable team-wide access
- Supports queries, column analysis, SLOs, triggers, trace links

### 4. Log level strategy in production?

**Current state:** Only ERROR/WARN sent
**Recommendation:** Keep default, use `OTEL_SEND_ALL_LOG_LEVELS=true` temporarily for debugging

---

## Additional Research Findings (Round 3)

### 9. Client-Logs Pipeline Deep Dive

**Flow: Browser → Server → Honeycomb**

```
┌──────────────────────────────────────────────────────────────────────┐
│ BROWSER                                                               │
│   console.log/warn/error()                                           │
│          ↓                                                            │
│   consoleInterceptor.ts intercepts                                   │
│          ↓                                                            │
│   LogEntry created with {level, message, data, timestamp, requestId} │
│          ↓                                                            │
│   localStorage queue (key: 'pending_logs')                           │
│          ↓                                                            │
│   remoteFlusher.ts (30s interval or 100 log threshold)              │
│          ↓                                                            │
│   POST /api/client-logs with JSON array                              │
└──────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────┐
│ SERVER: /api/client-logs (route.ts)                                  │
│   - Validates JSON payload                                           │
│   - Parses log entries array                                         │
│   - For each entry: emitLog(entry, context)                         │
│          ↓                                                            │
│ src/lib/logging/server/otelLogger.ts                                 │
│   - getLogger() returns OTLP-configured Logger                       │
│   - logger.emit() sends to Honeycomb via OTLP                       │
└──────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────┐
│ HONEYCOMB                                                             │
│   POST https://api.honeycomb.io/v1/logs                              │
│   Headers: x-honeycomb-team=<API_KEY>                                │
│   Body: OTLP log records                                             │
└──────────────────────────────────────────────────────────────────────┘
```

**Key Files:**
| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/logging/client/consoleInterceptor.ts` | 1-224 | Intercepts console.* calls |
| `src/lib/logging/client/remoteFlusher.ts` | 1-180 | Batches and sends to server |
| `src/app/api/client-logs/route.ts` | 1-65 | Receives logs from browser |
| `src/lib/logging/server/otelLogger.ts` | 1-150 | OTLP export to Honeycomb |

---

### 10. Auto-Instrumentation Gaps (CRITICAL)

**Key Finding:** Production may be missing auto-instrumentation.

| Issue | Detail | Severity |
|-------|--------|----------|
| NODE_OPTIONS not set in production | `--require ./instrumentation.ts` only in `dev:server` script | 🔴 Critical |
| Custom fetch wrapping dev-only | `instrumentation.ts:42-101` checks `NODE_ENV === 'development'` | 🔴 Critical |
| Next.js instrumentation hook | May not fully replace `--require` behavior | ⚠️ Medium |

**Current Dev Script (`package.json`):**
```json
"dev:server": "NODE_OPTIONS='--require ./instrumentation.ts' next dev"
```

**Production Build:**
- No equivalent `NODE_OPTIONS` configuration in Vercel
- Relies on Next.js `instrumentation.ts` export, but custom fetch wrapping is dev-only

**Custom Fetch Instrumentation (`instrumentation.ts:42-101`):**
```typescript
// ONLY runs in development!
if (process.env.NODE_ENV === 'development') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    // Traces Pinecone, Supabase, AI SDK calls
    // Adds span attributes for method, URL, status, duration
  };
}
```

**Consequence:**
- Pinecone, Supabase, and AI SDK calls are NOT traced in production
- Only the Next.js built-in instrumentation runs (which is limited)

---

### 11. Honeycomb MCP Configuration

**Official Honeycomb Hosted MCP (GA - Generally Available)**

**Installation Commands:**
```bash
# Claude Code CLI
claude mcp add honeycomb --transport http https://mcp.honeycomb.io/mcp

# Or add to .mcp.json for team-wide access:
{
  "mcpServers": {
    "honeycomb": {
      "url": "https://mcp.honeycomb.io/mcp",
      "transport": "http"
    }
  }
}
```

**Authentication:**
- Uses OAuth (will prompt for Honeycomb login)
- No API key management required
- Free for all Honeycomb tiers

**Available MCP Tools:**
| Tool | Purpose |
|------|---------|
| `list_datasets` | Enumerate all datasets |
| `get_columns` | Get column metadata for analysis |
| `run_query` | Execute analytics queries |
| `analyze_columns` | Get statistical metrics |
| `list_slos` / `get_slo` | Service Level Objectives |
| `list_triggers` / `get_trigger` | Alert configurations |
| `get_trace_link` | Generate Honeycomb UI deep links |
| `get_instrumentation_help` | OpenTelemetry guidance |

---

### 12. Connectivity Verification Commands

**Manual Test Commands (for developer verification):**

```bash
# Test Honeycomb API connectivity
curl -v -X POST https://api.honeycomb.io/v1/traces \
  -H "Content-Type: application/json" \
  -H "x-honeycomb-team: e6BHBGspbuTr8f7vQnTLXG" \
  -d '{"resourceSpans":[]}'
# Expected: 200 OK (empty spans accepted)

# Test logs endpoint
curl -v -X POST https://api.honeycomb.io/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-honeycomb-team: e6BHBGspbuTr8f7vQnTLXG" \
  -d '{"resourceLogs":[]}'
# Expected: 200 OK

# Verify dataset exists
curl -s https://api.honeycomb.io/1/datasets \
  -H "X-Honeycomb-Team: e6BHBGspbuTr8f7vQnTLXG" | jq '.[] | .name'
```

---

## Root Cause Summary

| Problem | Root Cause | Priority |
|---------|------------|----------|
| Honeycomb not receiving traces | Auto-instrumentation dev-only, browser tracing disabled | 🔴 Critical |
| No Honeycomb MCP | Not configured (but available) | 🟡 Medium |
| Sentry/OTLP not correlated | `@sentry/opentelemetry` not used | 🟢 Low |
| Limited log visibility | ERROR/WARN only in production (by design) | 🟢 Low |

## Recommended Actions

1. **Fix auto-instrumentation** - Remove `NODE_ENV === 'development'` check from custom fetch wrapper
2. **Enable browser tracing** - Set `NEXT_PUBLIC_ENABLE_BROWSER_TRACING=true` in Vercel
3. **Add Honeycomb MCP** - Add to `.mcp.json` for team-wide observability access
4. **Verify connectivity** - Run manual curl commands against production API key
5. **Consider BatchLogRecordProcessor** - Replace SimpleLogRecordProcessor for efficiency
