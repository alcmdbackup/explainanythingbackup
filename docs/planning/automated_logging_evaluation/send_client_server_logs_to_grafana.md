# Plan: Send Server & Client Logs to Grafana via OTLP

## Goal
Send production logs (both server and client) to Grafana Loki via the existing OTLP endpoint.

## Current State
- **Server logs**: Write to local `server.log` via `logger` in `src/lib/server_utilities.ts`
- **Client logs**: Write to local `client.log` via `/api/client-logs` (dev only, returns 403 in prod)
- **Traces**: Already working via OTLP to Grafana Tempo

## Approach: Use OTLP Logs (same endpoint as traces)

Grafana's OTLP gateway accepts logs at `/v1/logs` using the same auth as traces.

### Phase 1: Server Logs to Grafana (~30 min)

1. **Install packages**:
   ```bash
   npm install @opentelemetry/api-logs @opentelemetry/sdk-logs @opentelemetry/exporter-logs-otlp-http
   ```

2. **Create OTLP logger** (`src/lib/logging/server/otelLogger.ts`):
   - Initialize `LoggerProvider` with `OTLPLogExporter`
   - Use same endpoint + headers as traces
   - Export `emitLog(level, message, data)` function

3. **Integrate with existing `logger`** (`src/lib/server_utilities.ts`):
   - In `writeToFile()`, also call `emitLog()` in production
   - Include `trace_id`/`span_id` for correlation
   - Keep file logging for dev, add OTLP for prod

### Phase 2: Client Logs to Grafana (~20 min)

4. **Update `/api/client-logs/route.ts`**:
   - Remove 403 block in production
   - Forward received logs to Grafana via same OTLP logger
   - Add `source: 'client'` attribute to distinguish from server logs

5. **Update client `remoteFlusher.ts`** (optional):
   - Enable remote flushing in production (currently dev-only)
   - Only send `error`/`warn` level in prod (as configured in `logConfig.ts`)

### Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add 3 OTLP log packages |
| `src/lib/logging/server/otelLogger.ts` | **NEW** - OTLP log exporter |
| `src/lib/server_utilities.ts` | Call OTLP logger in production |
| `src/app/api/client-logs/route.ts` | Forward to OTLP in production |
| `src/components/ClientInitializer.tsx` | Enable remoteFlusher in prod |

### Environment Variables

No new env vars needed - reuses existing:
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`

### Log Format in Grafana

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "severity": "INFO",
  "body": "Function searchExplanations completed",
  "attributes": {
    "service.name": "explainanything",
    "source": "server|client",
    "trace_id": "abc123...",
    "request_id": "req-456",
    "user_id": "user-789"
  }
}
```

### Querying in Grafana

- Logs appear in **Loki** (not Tempo)
- Query by: `{service_name="explainanything"} | json`
- Filter: `{service_name="explainanything", source="client"} |= "error"`
- Correlate with traces using `trace_id`

### Log Level Policy

| Environment | Levels Sent to Grafana |
|-------------|------------------------|
| **Production** | `error`, `warn` only |
| **Development/Staging** | All levels (`debug`, `info`, `warn`, `error`) |

This keeps production log volume manageable while providing full visibility in non-production environments.

## Out of Scope
- Browser-side direct OTLP (would need proxy like traces)
- Log aggregation/buffering (OTLP BatchProcessor handles this)
- Log retention settings (Grafana Cloud default)
