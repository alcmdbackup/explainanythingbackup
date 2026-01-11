# New Tracing Logging Vendor Plan

## Background

The codebase has a production-grade observability stack using OpenTelemetry (OTLP) for distributed tracing and structured logging, with Grafana Cloud (Tempo + Loki) as the backend. Grafana has been difficult to set up and use. After evaluating 10+ vendors (see `new_tracing_logging_vendor_research.md`), Honeycomb was selected for its 60-day retention, unlimited users, graceful degradation, and strong OTLP support. The infrastructure is already OTLP-native, so migration requires only environment variable changes.

## Problem

1. Grafana Cloud is complex to configure and query
2. Current setup uses Tempo (traces) + Loki (logs) which have different query languages
3. Need a simpler unified observability platform
4. Want longer retention for debugging (Honeycomb offers 60 days vs Grafana's 14 days)
5. Need team collaboration without per-user fees

## Chosen Solution: Honeycomb

**Free Tier:**
- 20 million events/month
- 60-day retention
- Unlimited users
- 2 alert triggers
- Graceful degradation (see details below - you're never fully cut off)

**OTLP Configuration:**
- Endpoint: `https://api.honeycomb.io` (HTTP) or `api.honeycomb.io:443` (gRPC)
- Header: `x-honeycomb-team=YOUR_API_KEY`
- Protocol: HTTP/protobuf (recommended for load balancers/Refinery)
- Note: SDK auto-appends `/v1/traces`, `/v1/metrics`, `/v1/logs` to base endpoint

**Graceful Degradation (actual process):**
1. First overage month: notification email sent
2. Second consecutive month: warning that throttling will begin
3. 10-day grace period after second notification
4. After grace period: 10% sampling applied
5. Burst protection: 2X daily overages don't count (up to 3x/month)
6. You are never fully cut off

## Options Considered

| Vendor | Pros | Cons | Decision |
|--------|------|------|----------|
| **Honeycomb** | 60-day retention, unlimited users, graceful degradation, excellent tracing | 20M events may run out, only 2 alerts | **SELECTED** |
| Grafana Cloud | 150 GB free, familiar UI | Only 14-day retention, complex queries | Rejected |
| New Relic | 100 GB free | Hard cutoff at limit, PE-owned, 8-day retention | Rejected |
| Axiom Personal | 500 GB free | 2 datasets, 1 user, 3 monitors, Email/Discord only | Rejected |
| Self-hosted | Free, full control | Operational overhead | Rejected |

## Phased Execution Plan

### Phase 1: Honeycomb Account Setup
**Goal:** Get Honeycomb credentials and verify access

1. Sign up at [honeycomb.io](https://www.honeycomb.io)
2. Create team/organization
3. Navigate to Team Settings → Environments → API Keys
4. Create an Ingest API key with **"Can create datasets"** permission (required for auto-dataset creation)
5. Copy API key for the appropriate environment
6. Note endpoint: `https://api.honeycomb.io` (US) or `https://api.eu1.honeycomb.io` (EU)

**Important:** Use Ingest keys (not Configuration keys) for sending telemetry. Ensure "Can create datasets" is enabled or datasets won't be created automatically.

### Phase 2: Environment Variable Updates
**Goal:** Configure OTLP exporters to send to Honeycomb

**Server-side (`.env.local`, `.env.stage`, `.env.production`):**

```bash
# Honeycomb OTLP Configuration
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS="x-honeycomb-team=YOUR_API_KEY"

# Service name becomes the dataset name in Honeycomb
OTEL_SERVICE_NAME=explainanything

# CAUTION: Start with false! The codebase has 399+ logger calls.
# Enabling all log levels could consume 15M+ events/month.
# Only enable after monitoring event consumption for 1 week.
OTEL_SEND_ALL_LOG_LEVELS=false
```

**⚠️ Event Budget Warning:** With `OTEL_SEND_ALL_LOG_LEVELS=true`, every `logger.info/debug` call becomes a Honeycomb event. Start with `false` (error/warn only) and monitor usage before enabling.

**Note on Metrics:** If you add metrics later, they require an additional header:
```bash
# Metrics require explicit dataset (unlike traces which use service name)
OTEL_EXPORTER_OTLP_METRICS_HEADERS="x-honeycomb-team=KEY,x-honeycomb-dataset=metrics"
```

**Client-side: No changes needed!**

The browser tracing (`src/lib/tracing/browserTracing.ts`) already uses the `/api/traces` proxy route, which reads from `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` server-side. The API key is never exposed to the browser. This is the correct architecture - no client-side env vars needed.

**Files to update:**
- `.env.example` - Update to remove Grafana references, document Honeycomb config
- `.env.local` - Local development
- `.env.stage` - Staging environment
- `.env.production` - Production (via Vercel dashboard)

### Phase 3: Code Updates
**Goal:** Update configuration files and remove obsolete references

**Verified: No production code changes required for migration!**

The codebase is already OTLP-generic:
- `/api/traces/route.ts` - Already reads from `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`
- `browserTracing.ts` - Already sends to `/api/traces` proxy with no direct backend config
- Header parsing (`headers.split(',')`) already supports `x-honeycomb-team=YOUR_API_KEY` format

**Required cleanup (🔴 MUST FIX):**
1. **`.env.example`** - Remove obsolete vars: `NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT`, `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN`
2. **`.env.example`** - Update comment "Grafana Cloud OTLP" → "OTLP Backend (Honeycomb)"
3. **`docs/docs_overall/environments.md`** - Update lines 14-15 ("Grafana + Sentry" → "Honeycomb + Sentry"), lines 218-221, 274-279
4. **`docs/docs_overall/environments.md`** - **DELETE/REWRITE lines 223-254** (entire LogCLI section is Grafana Loki-specific)
5. **`/test-cors` debug page** - Update or delete `src/app/(debug)/test-cors/page.tsx` (hardcodes Grafana endpoints at lines 22-24, 133-134)
6. **`.env.local`** - Clear/update Grafana credentials (currently contains active Grafana OTLP endpoint and auth headers)
7. **`.env.prod`** - **MISSING all OTEL config** - must populate with Honeycomb configuration
8. **`.env.stage`** - **INCOMPLETE** (only 7 lines, no OTEL config) - must populate with Honeycomb configuration

**Should fix (🟡 Code comments):**
1. Update comments in `route.ts` from "Grafana Cloud" to "OTLP backend" (lines 2, 4, 43, 52)
2. Update comments in `browserTracing.ts` from "Grafana" to "backend" (lines 5, 60)
3. **`src/lib/logging/server/otelLogger.ts`** - Update Grafana comments (lines 2, 4, 94)
4. **`src/app/api/client-logs/route.ts`** - Update Grafana comment (line 39)
5. **`src/components/ClientInitializer.tsx`** - Update Grafana comments (lines 14, 35)
6. **`src/lib/server_utilities.ts`** - Update Grafana comment (line 65)

**Optional cleanup (🟢 cosmetic only):**
1. Update test mocks that use `mock.grafana.net` endpoints in:
   - `src/lib/logging/server/otelLogger.test.ts` (lines 76, 85, 176, 226, 246)
   - `__tests__/integration/logging/otelLogger.integration.test.ts` (lines 31, 61, 72, 88)
   - `src/app/api/traces/route.test.ts` (verify if has mock.grafana.net)

### Phase 4: Local Verification
**Goal:** Verify traces and logs appear in Honeycomb

1. Start local dev server: `npm run dev`
2. Perform some actions that generate traces (page loads, API calls)
3. Open Honeycomb dashboard → Query
4. Verify:
   - Traces appear with correct service name
   - Spans have expected attributes
   - Logs appear (if using log exporter)
5. Test BubbleUp feature on sample data

### Phase 4.5: Event Budget Monitoring
**Goal:** Establish baseline event consumption before staging/production

1. Run local environment for 1-2 hours with typical usage patterns
2. Check Honeycomb → Team Settings → Usage
3. Calculate projected monthly events:
   - Daily budget: ~666,667 events (20M / 30 days)
   - If local testing shows >10K events/hour, investigate high-frequency sources
4. Identify any high-cardinality spans or excessive logging
5. **Decision point:** If projected usage >15M/month, implement sampling or reduce log levels before proceeding

**Only proceed to staging after confirming event consumption is sustainable.**

### Phase 5: Staging Deployment
**Goal:** Verify in staging environment

1. Update Vercel environment variables for staging
2. Deploy to staging
3. Run smoke tests
4. Verify traces appear in Honeycomb
5. Check for any errors in Vercel logs

### Phase 6: Production Deployment
**Goal:** Go live with Honeycomb

1. Update Vercel environment variables for production
2. Deploy to production
3. Monitor for 24-48 hours:
   - Event count (stay under 20M/month)
   - Error rates
   - Trace completeness
   - Browser traces arriving via proxy
4. Set up 2 alert triggers (free tier limit):
   - **Alert 1: Error Rate Spike** - `count() where severity = ERROR` > 10/minute sustained 5min
   - **Alert 2: API Latency P95** - `P95(duration_ms) where service.name = explainanything` > 5000ms

   *Alternative:* If Sentry handles errors, consider using alerts for event budget (>15M/month) or high-cardinality detection instead.

### Phase 7: Cleanup
**Goal:** Remove Grafana dependencies

1. **Vercel Dashboard:** Remove Grafana-specific environment variables from all environments
2. **`.env.example`:** Remove `NEXT_PUBLIC_GRAFANA_OTLP_*`, `LOKI_*` variables
3. **Documentation:** Complete updates to `environments.md`, `getting_started.md`
4. **Scripts:** Archive `scripts/query-logs.sh` (Grafana Loki-specific) and create `scripts/query-honeycomb.md` guide
5. **Debug pages:** Delete or update `/test-cors` page if not done in Phase 3
6. (Optional) Cancel Grafana Cloud subscription if paid
7. **Keep Grafana credentials accessible for 30 days** to access historical data during transition

## Critical Order of Operations

**⚠️ Hidden Dependencies:** Phases must consider these dependencies:

| Step | Dependency | Risk if Wrong Order |
|------|------------|---------------------|
| Update `/test-cors` | BEFORE Vercel env vars | Confusing errors during debugging |
| Create query guide | BEFORE Phase 5 (staging) | Can't debug production logs |
| Populate `.env.prod`/`.env.stage` | BEFORE Vercel deployment | Staging/production breakage |
| Write Honeycomb test | BEFORE Phase 4 | No verification of header format |

**Recommended Execution Order:**
1. ✅ Write Honeycomb header format test (`route.test.ts`)
2. ✅ Create `scripts/query-honeycomb.md` (replacement guide)
3. ✅ Delete/update `src/app/(debug)/test-cors/page.tsx`
4. ✅ Update `.env.local` (local development)
5. ✅ Update `.env.example` (documentation)
6. ✅ Update `.env.stage` and `.env.prod` templates
7. ✅ Update `docs/docs_overall/environments.md`
8. ✅ Deploy to staging with new Vercel env vars (Preview environment)
9. ✅ Verify Honeycomb receives traces/logs for 24-48 hours
10. ✅ Deploy to production with new Vercel env vars (Production environment)
11. ✅ Archive Grafana script and remaining comments (Phase 7 cleanup)

## Process Requirements

### Completion Criteria ("Done" Definition)

Migration is complete when ALL of the following are true:
- [ ] All MUST FIX items completed
- [ ] All SHOULD FIX items completed (or explicitly deferred)
- [ ] Honeycomb receiving data for 24+ hours in production
- [ ] Alert triggers firing correctly (tested)
- [ ] Event budget tracking verified
- [ ] Team notified of new dashboard location
- [ ] Grafana credentials archived in 1Password (30-day retention)

### Pre-Migration Checklist

Before starting Phase 1:
- [ ] Honeycomb account created
- [ ] API key has "Can create datasets" permission
- [ ] Separate API keys created for staging vs production
- [ ] Team informed of migration timeline

### Incident Response

**If traces don't appear in Honeycomb:**
1. Check Vercel function logs for OTLP errors
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is `https://api.honeycomb.io` (not gRPC)
3. Verify `OTEL_EXPORTER_OTLP_HEADERS` format: `x-honeycomb-team=YOUR_KEY`
4. Check Honeycomb Team Settings → API Keys for key status

**If event budget overrun detected:**
1. Check `OTEL_SEND_ALL_LOG_LEVELS` - should be `false`
2. Review high-frequency spans in Honeycomb → Query
3. Implement sampling if needed (see Honeycomb docs)
4. Graceful degradation kicks in after 2 months + 10-day grace period

### Team Communication Plan

| When | Who | What |
|------|-----|------|
| Before migration | All engineers | Announce timeline, share Honeycomb access |
| After staging deploy | QA/test team | Request smoke testing, share staging dashboard |
| After production deploy | All engineers | Announce go-live, share production dashboard links |
| 30 days post-migration | All engineers | Confirm Grafana credentials archived, final cleanup |

## CI/CD Changes

### Vercel Environment Variables

Add to Vercel Dashboard (Settings → Environment Variables) for each environment:

| Variable | Staging | Production |
|----------|---------|------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://api.honeycomb.io` | `https://api.honeycomb.io` |
| `OTEL_EXPORTER_OTLP_HEADERS` | `x-honeycomb-team=STAGING_KEY` | `x-honeycomb-team=PROD_KEY` |
| `OTEL_SERVICE_NAME` | `explainanything-staging` | `explainanything` |

**Important:** Use different API keys for staging vs production to separate data in Honeycomb.

### GitHub Actions (if applicable)

If any GitHub Actions workflows use observability (unlikely for this project), update:
```yaml
env:
  OTEL_EXPORTER_OTLP_ENDPOINT: ${{ secrets.HONEYCOMB_OTLP_ENDPOINT }}
  OTEL_EXPORTER_OTLP_HEADERS: x-honeycomb-team=${{ secrets.HONEYCOMB_API_KEY }}
```

### Secrets Management

1. **Create Honeycomb API keys:**
   - Go to Honeycomb → Team Settings → API Keys
   - Create separate keys for `local`, `staging`, `production`
   - Store production key in 1Password/secrets manager

2. **Never commit API keys:**
   - `.env.local` is gitignored - safe for local keys
   - Use Vercel Dashboard for staging/production keys
   - Consider Vercel's integration with secrets managers for production

## Security Considerations

### Rate Limiting (Known Limitation)

The `/api/traces` proxy currently has no rate limiting.

**Risks:**
| Risk | Severity | Description |
|------|----------|-------------|
| Budget exhaustion | MEDIUM | Attacker could exhaust 20M event quota by flooding endpoint |
| Server resource abuse | MEDIUM | Large payloads consume memory via `request.arrayBuffer()` |
| Data pollution | LOW | Garbage trace data could pollute Honeycomb datasets |

**Mitigations in place:**
- Honeycomb's graceful degradation (eventual 10% sampling after grace period)
- Endpoint not publicly advertised
- No credentials to steal (API key is server-side)

**Recommended improvements:**
```typescript
// 1. Add payload size limit (route.ts)
const body = await request.arrayBuffer();
if (body.byteLength > 1_000_000) { // 1MB limit
  return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
}

// 2. Add rate limiting (consider Upstash or Vercel KV)
import { Ratelimit } from '@upstash/ratelimit';
const ratelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(100, '1m') });
```

### Request Size Limit

Honeycomb has a **15 MB max request size**. The proxy currently has no size check. While browser traces are typically small (<1MB), consider adding a size limit if sending large span attributes.

### API Key Protection

- API keys are server-side only (`OTEL_EXPORTER_OTLP_HEADERS`)
- Browser traces go through proxy - key never exposed to client
- No `NEXT_PUBLIC_` prefix means key not bundled into client code

## Testing

### Automated Tests
- No new tests strictly required (env var change only, no code changes)
- Existing tests in `route.test.ts` verify header parsing works generically
- Existing `otelLogger.test.ts` verifies OTEL logger initialization

**Recommended:** Add explicit Honeycomb format test to `route.test.ts`:
```typescript
it('should handle Honeycomb header format', async () => {
  process.env.OTEL_EXPORTER_OTLP_HEADERS = 'x-honeycomb-team=abc123xyz';
  const request = createMockRequest();
  const response = await POST(request);
  // Verify x-honeycomb-team header is forwarded correctly
  expect(mockFetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: expect.objectContaining({ 'x-honeycomb-team': 'abc123xyz' })
    })
  );
});
```

### Smoke Test Script

Create a simple verification script (`scripts/verify-honeycomb.sh`):

```bash
#!/bin/bash
# Verify Honeycomb is receiving traces

echo "Starting dev server..."
npm run dev &
DEV_PID=$!
sleep 10

echo "Generating test traces..."
curl -s http://localhost:3000/ > /dev/null
curl -s http://localhost:3000/api/health > /dev/null

echo "Waiting for traces to flush..."
sleep 5

echo "Check Honeycomb dashboard for traces from service: explainanything"
echo "URL: https://ui.honeycomb.io"

kill $DEV_PID
```

### Manual Verification Checklist

**Local:**
- [ ] Server-side traces appear in Honeycomb
- [ ] Browser traces appear in Honeycomb (via proxy)
- [ ] Logs appear in Honeycomb
- [ ] Service name is correct
- [ ] Trace context propagates across services

**Staging:**
- [ ] All above checks pass
- [ ] No errors in Vercel function logs
- [ ] Smoke tests pass

**Production:**
- [ ] All above checks pass
- [ ] Event count is reasonable (<20M/month)
- [ ] Alert triggers work
- [ ] BubbleUp provides useful debugging info

## Documentation Updates

### Files to Update

1. **`docs/docs_overall/environments.md`** ✅ EXISTS - CRITICAL
   - Line 14-15: Change "Grafana + Sentry" → "Honeycomb + Sentry"
   - Lines 218-221: Update Grafana OTLP references
   - Lines 274-279: Update OTLP variable descriptions

2. **`docs/docs_overall/getting_started.md`** ✅ EXISTS
   - Update observability section to reference Honeycomb
   - Add Honeycomb dashboard link

3. **`docs/docs_overall/environment_variables.md`** ❌ DOES NOT EXIST
   - Consider creating, or add content to `environments.md`

4. **`docs/feature_deep_dives/observability.md`** ❌ DOES NOT EXIST
   - Consider creating for Honeycomb-specific querying tips and BubbleUp usage

5. **`.env.example`** ✅ EXISTS - CRITICAL
   - Remove: `NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT`, `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN`
   - Update comment: "Grafana Cloud OTLP" → "OTLP Backend (Honeycomb)"
   - Consider removing/archiving `LOKI_*` variables

6. **`README.md`** (if observability mentioned)
   - Update vendor reference

## Rollback Plan

If issues arise after production deployment:

1. **Immediate:** Revert environment variables to Grafana configuration in Vercel Dashboard
2. **Redeploy:** Trigger new deployment with old config (env vars are cached - redeploy required)
3. **Investigate:** Use Honeycomb's 60-day retention to debug issues

No code changes required for rollback since the codebase is OTLP-generic.

**Important:** Keep Grafana credentials accessible for at least 30 days post-migration:
- Historical data remains in Grafana during transition
- No automatic data migration between vendors
- You may need to cross-reference old traces during debugging

## Monitoring Event Usage

Honeycomb free tier is 20 million events/month. To stay within limits:

1. **Check usage:** Honeycomb → Team Settings → Usage
2. **If approaching limit:**
   - Reduce trace sampling rate
   - Filter out noisy spans
   - Consolidate logs

**Graceful degradation:** If you exceed 20M events for two consecutive months and don't respond within the 10-day grace period, Honeycomb applies 10% sampling. You're never fully cut off. Burst protection also means 2X daily overages (up to 3x/month) don't count against your limit.

## Links

- [Honeycomb OpenTelemetry Docs](https://docs.honeycomb.io/send-data/opentelemetry/)
- [Honeycomb Node.js SDK](https://docs.honeycomb.io/send-data/javascript-nodejs/opentelemetry-sdk/)
- [OTLP Exporter Configuration](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/)
- [Research Document](./new_tracing_logging_vendor_research.md)
