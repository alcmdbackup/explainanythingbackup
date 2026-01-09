# Persist and Access Production Logs - Research

## Problem Statement
Production logs are currently filtered to only ERROR/WARN levels, making it impossible to debug issues by looking up request IDs. Debug and info level logs that would provide context around errors are silently dropped.

## High Level Summary
The logging infrastructure is already well-built with request ID propagation via AsyncLocalStorage. The issue is purely configuration - production log level filtering in `otelLogger.ts` (server) and `logConfig.ts` (client) drops non-error logs before sending to Grafana Loki.

**Solution**: Add environment variable toggles to enable all log levels in production, plus install LogCLI for terminal-based log queries.

## Documents Read
- `docs/docs_overall/environments.md` - Environment configuration overview
- `docs/docs_overall/testing_overview.md` - Testing tiers and CI/CD
- `docs/feature_deep_dives/request_tracing_observability.md` - Request ID system

## Code Files Read
- `src/lib/logging/server/otelLogger.ts` - OTLP logger with production filter (line 112)
- `src/lib/logging/client/logConfig.ts` - Client log config with level filters
- `src/lib/logging/client/consoleInterceptor.ts` - Console interception
- `src/lib/logging/client/remoteFlusher.ts` - Client log batching
- `src/lib/server_utilities.ts` - Server logger entry point
- `src/lib/requestIdContext.ts` - Request ID context propagation
- `instrumentation.ts` - OpenTelemetry setup

## Key Findings

### Current Architecture
| Component | Location | Current Behavior |
|-----------|----------|------------------|
| Server OTLP | `otelLogger.ts:112` | Production: ERROR/WARN only |
| Client Config | `logConfig.ts:36-41` | Production: persist WARN+, send ERROR only |
| Request IDs | `requestIdContext.ts` | Working - attached to all logs |
| Trace Correlation | `otelLogger.ts:129` | Working - `trace_id`/`span_id` included |

### Options Evaluated
1. **Grafana Loki** (recommended) - Already integrated, just needs filter change
2. **Sentry Logs** - Expensive for high volume, better for errors only
3. **Vercel Log Drain** - Requires external aggregator anyway

### Access Method
- **LogCLI** - Official Grafana CLI for querying Loki
- No official Grafana MCP server available yet
