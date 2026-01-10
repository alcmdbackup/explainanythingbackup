# Persist and Access Production Logs - Plan

## Background
The application has robust request ID tracing via AsyncLocalStorage, with IDs attached to all logs. However, production environments filter logs to ERROR/WARN only before sending to Grafana Loki, making it impossible to see the full context around errors when debugging.

## Problem
When debugging production issues, developers need to look up all logs for a specific request ID to understand what happened. Currently, debug/info level logs are dropped in production (line 112 of `otelLogger.ts`), so only error/warn context is available. This makes root cause analysis difficult.

## Options Considered
1. **Grafana Loki (extend existing)** - Just change the log level filter. Already integrated, has LogQL queries.
2. **Sentry Logs** - New feature, but expensive for high-volume debug logs.
3. **Vercel Log Drain** - Native but requires external aggregator anyway.
4. **Smart Buffering** - Buffer in memory, flush on error only. Complex implementation.

**Decision**: Option 1 (Grafana Loki) with simple env var toggle.

---

## Log Flow Architecture

Understanding the full data flow is critical for this change:

### Server-Side Flow
```
server_utilities.ts (logger.info/debug/etc)
  → emitLog() in otelLogger.ts
  → [FILTER: line 112 - PROD_LEVELS check] ← WE MODIFY HERE (runtime env var)
  → OTLPLogExporter → Grafana Loki
```

### Client-Side Flow
```
console.log/info/etc (browser)
  → consoleInterceptor.ts (captures to localStorage)
  → [FILTER: logConfig.ts - minRemoteLevel] ← WE MODIFY HERE (build-time env var)
  → remoteFlusher.ts (batches every 30s)
  → POST /api/client-logs
  → client-logs/route.ts calls emitLog(level, msg, data, 'client')
  → [FILTER: line 112 - PROD_LEVELS check] ← SECOND FILTER (defense in depth)
  → Grafana Loki
```

### Key Architecture Notes

1. **Dual Filtering (Intentional)**: Client logs pass through TWO filters - client-side `minRemoteLevel` AND server-side `PROD_LEVELS`. This is defense-in-depth: even if client sends debug logs, server can block them.

2. **NEXT_PUBLIC_ is BUILD-TIME**: Unlike `OTEL_SEND_ALL_LOG_LEVELS` which is read at runtime, `NEXT_PUBLIC_LOG_ALL_LEVELS` is baked into the JavaScript bundle at build time. **Changing it requires a new Vercel deployment**, not just an env var update.

3. **Browser DevTools**: Users will still see ALL console.log() calls in browser DevTools regardless of `minRemoteLevel`. The filter only controls what gets sent to the server.

---

## Phased Execution Plan

### Phase 1: Enable All Logs (Server + Client)

#### 1.1 Modify `src/lib/logging/server/otelLogger.ts` (line 112)
```typescript
// Before:
if (process.env.NODE_ENV === 'production' && !PROD_LEVELS.has(upperLevel)) {
  return;
}

// After:
const sendAllLevels = process.env.OTEL_SEND_ALL_LOG_LEVELS === 'true';
if (process.env.NODE_ENV === 'production' && !sendAllLevels && !PROD_LEVELS.has(upperLevel)) {
  return;
}
```

#### 1.2 Modify `src/lib/logging/client/logConfig.ts`
Modify `DEFAULT_PROD_CONFIG` (lines 36-41):

```typescript
const DEFAULT_PROD_CONFIG: ClientLogConfig = {
  minPersistLevel: 'warn',  // Keep localStorage conservative (avoid quota issues)
  minRemoteLevel: process.env.NEXT_PUBLIC_LOG_ALL_LEVELS === 'true' ? 'debug' : 'error',
  remoteEnabled: true,
  maxLocalLogs: 200,
};
```

**Note**: `minPersistLevel` stays at 'warn' to avoid localStorage quota exhaustion (200 log limit). Only `minRemoteLevel` changes.

#### 1.3 Update `.env.example` (NON-SECRET values only)
```bash
# === Observability: Full Log Levels ===
# Server-side (runtime): Send all log levels to Grafana
OTEL_SEND_ALL_LOG_LEVELS=false

# Client-side (BUILD-TIME): Client sends all log levels to server
# NOTE: Changing this requires a new deployment (not just env var update)
NEXT_PUBLIC_LOG_ALL_LEVELS=false
```

#### 1.4 Vercel Environment Variables

**Server-side** (runtime, can toggle without redeploy):
- `OTEL_SEND_ALL_LOG_LEVELS=true` → Production

**Client-side** (build-time, requires redeploy):
- `NEXT_PUBLIC_LOG_ALL_LEVELS=true` → Production

**Deployment Strategy**:
1. First, set server-side only (`OTEL_SEND_ALL_LOG_LEVELS=true`)
2. Trigger redeploy to pick up client-side change
3. Monitor log volume before enabling both

---

### Phase 2: Install LogCLI Access

#### 2.1 Document LogCLI Installation
Add to `docs/docs_overall/environments.md`:
```bash
brew install grafana/tap/logcli
```

#### 2.2 LogCLI Authentication (SECRETS MANAGEMENT)
**Do NOT add credentials to `.env.example`**. Instead:

1. Add placeholder documentation to `.env.example`:
```bash
# === LogCLI Access (for local debugging) ===
# Get credentials from Grafana Cloud → My Account → API Keys
# Store in .env.local (gitignored), NOT here
# LOKI_ADDR=https://logs-prod-us-central-0.grafana.net
# LOKI_USERNAME=<see-1password-or-grafana-cloud>
# LOKI_PASSWORD=<see-1password-or-grafana-cloud>
```

2. Store actual credentials in:
   - **Local dev**: `.env.local` (gitignored)
   - **CI/CD**: GitHub Secrets (if needed for automated queries)
   - **Team access**: 1Password or team secrets manager

#### 2.3 Create `scripts/query-logs.sh` (with injection protection)
```bash
#!/bin/bash
# Query production logs by request ID
# Usage: ./scripts/query-logs.sh <request-id> [time-range]
#
# Prerequisites:
#   - brew install grafana/tap/logcli
#   - Set LOKI_ADDR, LOKI_USERNAME, LOKI_PASSWORD in .env.local

set -euo pipefail

REQUEST_ID="${1:?Usage: $0 <request-id> [time-range]}"
RANGE="${2:-1h}"

# === INPUT VALIDATION (prevent LogQL injection) ===
if [[ ! "$REQUEST_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "Error: REQUEST_ID must be alphanumeric with hyphens/underscores only"
  exit 1
fi

if [[ ! "$RANGE" =~ ^[0-9]+[smhd]$ ]]; then
  echo "Error: RANGE must be like '1h', '30m', '7d'"
  exit 1
fi

# === SAFE CREDENTIAL LOADING (avoid shell injection) ===
if [[ -f .env.local ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      LOKI_ADDR|LOKI_USERNAME|LOKI_PASSWORD)
        export "$key=$value"
        ;;
    esac
  done < <(grep -E '^LOKI_(ADDR|USERNAME|PASSWORD)=' .env.local)
fi

# === VALIDATE PREREQUISITES ===
if [[ -z "${LOKI_ADDR:-}" ]]; then
  echo "Error: LOKI_ADDR not set. Add to .env.local or export manually."
  exit 1
fi

if ! command -v logcli &> /dev/null; then
  echo "Error: logcli not found. Install with: brew install grafana/tap/logcli"
  exit 1
fi

# === EXECUTE QUERY ===
logcli query "{service_name=\"explainanything\"} |= \"requestId=$REQUEST_ID\"" \
  --since="$RANGE" \
  --limit=500 \
  --output=jsonl
```

---

### Phase 3: Documentation

#### 3.1 Update `docs/docs_overall/environments.md`
Add new section for log level configuration:

| Variable | Type | Purpose | Default |
|----------|------|---------|---------|
| `OTEL_SEND_ALL_LOG_LEVELS` | Runtime | Server sends debug/info logs to Grafana | `false` |
| `NEXT_PUBLIC_LOG_ALL_LEVELS` | Build-time | Client sends debug logs to server | `false` |

**Important**: `NEXT_PUBLIC_*` variables are baked into the build. Changing them requires a new deployment.

#### 3.2 Add LogCLI Usage to Debugging Docs
- Installation steps
- Query examples by request ID, user ID, time range
- Link to LogQL documentation

---

## Security Considerations

### Log Data Sanitization
The existing `sanitizeValue()` in `src/lib/logging/server/automaticServerLoggingBase.ts` redacts:
- `password`, `apiKey`, `token`, `secret`, `pass` fields
- Truncates long strings (500/1000 chars)

**Caveat**: Direct `logger.debug(message, data)` calls bypass the wrapper sanitization. The `emitLog()` function in otelLogger.ts uses `flattenData()` which does NOT sanitize. This includes the `/api/client-logs` route which passes `logEntry.data` directly to `emitLog()`.

**Mitigations**:
1. Developer convention - never log raw user input or credentials via direct logger calls
2. Use `withServerLogging` wrapper for sensitive operations
3. **Future improvement** (out of scope): Add sanitization layer to `/api/client-logs/route.ts` before `emitLog()` call

**Risk assessment**: Low - client logs are client-originated and already considered untrusted. Sensitive server-side data (passwords, API keys) are not present in client log payloads.

### Error Handling for OTLP Failures
The existing `otelLogger.ts` wraps initialization in try/catch (lines 65-89) and silently fails if OTLP is unavailable. Logs are best-effort and should not block application execution.

### Rate Limiting / Volume Control
**Existing protection**: `/api/client-logs` inherits Vercel's default rate limiting.

**Additional mitigation via configuration:**
1. Start with env vars disabled (`false`)
2. Enable server-side first, monitor 48 hours
3. Then enable client-side with redeploy
4. If volume exceeds free tier (50GB/month), disable or implement sampling

### Input Validation in LogCLI Script
The `query-logs.sh` script validates:
- `REQUEST_ID`: alphanumeric, hyphens, underscores only (prevents LogQL injection)
- `RANGE`: numeric + time unit only (e.g., `1h`, `30m`)
- Credentials loaded via safe `while read` pattern (prevents shell injection)

---

## Testing Strategy

### Prerequisites
Install `msw` (Mock Service Worker) for HTTP mocking:
```bash
npm install -D msw
```

Verify installation:
```bash
npm ls msw  # Should show msw@2.x.x
```

### Unit Tests
**New file**: `src/lib/logging/server/otelLogger.test.ts`

```typescript
import { emitLog } from './otelLogger';

describe('emitLog', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Isolate environment for each test
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('production filtering', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://mock.grafana.net';
    });

    it('filters debug/info by default', () => {
      delete process.env.OTEL_SEND_ALL_LOG_LEVELS;
      // Mock logger, call emitLog('DEBUG', ...), verify not called
    });

    it('sends all levels when OTEL_SEND_ALL_LOG_LEVELS=true', () => {
      process.env.OTEL_SEND_ALL_LOG_LEVELS = 'true';
      // Mock logger, call emitLog('DEBUG', ...), verify called
    });

    it('always sends ERROR regardless of env var', () => {
      delete process.env.OTEL_SEND_ALL_LOG_LEVELS;
      // Mock logger, call emitLog('ERROR', ...), verify called
    });
  });

  describe('env var edge cases', () => {
    it('treats undefined as false', () => { /* ... */ });
    it('treats "false" string as false', () => { /* ... */ });
    it('only "true" enables all levels', () => { /* ... */ });
  });
});
```

### Integration Test
**New file**: `__tests__/integration/logging/otelLogger.integration.test.ts`

**Setup steps** (run before creating test file):
```bash
# Create integration test directory (doesn't exist yet)
mkdir -p __tests__/integration/logging

# Install MSW
npm install -D msw
```

Note: Integration tests must be in `__tests__/integration/` per `jest.integration.config.js` testMatch pattern.

```typescript
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer();

describe('OTLP Integration', () => {
  beforeAll(() => server.listen());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('sends logs to configured OTLP endpoint', async () => {
    const receivedLogs: unknown[] = [];

    server.use(
      http.post('https://mock.grafana.net/v1/logs', async ({ request }) => {
        receivedLogs.push(await request.json());
        return HttpResponse.json({ success: true });
      })
    );

    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://mock.grafana.net';
    process.env.OTEL_SEND_ALL_LOG_LEVELS = 'true';

    // Trigger log emission
    // Verify receivedLogs contains expected payload
  });
});
```

### Manual Verification
1. Deploy to Vercel Preview with env vars enabled
2. Generate traffic with known request ID (check `x-request-id` response header)
3. Query via LogCLI: `./scripts/query-logs.sh <request-id>`
4. Verify DEBUG/INFO logs appear alongside ERROR/WARN

---

## CI/CD Updates

### GitHub Secrets (optional, for LogCLI in CI)
- `LOKI_ADDR`
- `LOKI_USERNAME`
- `LOKI_PASSWORD`

### Vercel Environment Variables
Add via Vercel Dashboard → Settings → Environment Variables:

| Variable | Environment | Requires Redeploy |
|----------|-------------|-------------------|
| `OTEL_SEND_ALL_LOG_LEVELS` | Production | No (runtime) |
| `NEXT_PUBLIC_LOG_ALL_LEVELS` | Production | **Yes (build-time)** |

### GitHub Actions
No workflow file changes needed. Tests run via existing `npm run test:ci`.

New test files will be auto-discovered by Jest config (`**/*.test.ts`).

---

## Rollback Plan

### Server-Side (Immediate, No Redeploy)
1. Set `OTEL_SEND_ALL_LOG_LEVELS=false` in Vercel Dashboard
2. Effect: Immediate on next request (runtime env var)
3. Verify: Check Grafana log volume drops

### Client-Side (Requires Redeploy)
1. Set `NEXT_PUBLIC_LOG_ALL_LEVELS=false` in Vercel Dashboard
2. Trigger redeploy (Deployments → Redeploy)
3. Effect: After new build completes (~2-3 minutes)
4. Verify: Check `/api/client-logs` request volume drops

**Total rollback time**: < 5 minutes (server) or ~5 minutes (client)

---

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/logging/server/otelLogger.ts` | Add `OTEL_SEND_ALL_LOG_LEVELS` env check (line 112) |
| `src/lib/logging/client/logConfig.ts` | Add `NEXT_PUBLIC_LOG_ALL_LEVELS` env check for `minRemoteLevel` |
| `.env.example` | Document new env vars (non-secret placeholders only) |
| `docs/docs_overall/environments.md` | Add env var documentation with build-time note |
| `scripts/query-logs.sh` | New file - LogCLI helper script with input validation |
| `src/lib/logging/server/otelLogger.test.ts` | New file - unit tests with env isolation |
| `__tests__/integration/logging/otelLogger.integration.test.ts` | New file - integration tests with msw |
| `package.json` | Add `msw` to devDependencies |

---

## Cost Estimate

| Scenario | Log Volume | Grafana Cost |
|----------|------------|--------------|
| Current (ERROR/WARN) | ~500/day | Free tier |
| All Levels | ~5,000-50,000/day | ~$0-10/month |

Grafana Free Tier: 50GB logs/month. Likely within limits for moderate traffic.

---

## Success Criteria

1. ✅ Can query any request ID and see full debug/info/warn/error context
2. ✅ No secrets committed to repository
3. ✅ Rollback possible in < 5 minutes via env var toggle
4. ✅ Unit tests cover the new filtering logic with proper env isolation
5. ✅ Integration tests verify OTLP payload delivery
6. ✅ LogCLI script validates input to prevent injection
7. ✅ Documentation clarifies build-time vs runtime env vars
