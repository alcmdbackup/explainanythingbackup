# Environments

> **For CI/CD and GitHub Actions workflows, see [testing_overview.md](testing_overview.md).**

## Overview

| Environment | Config Source | Supabase | Pinecone | Observability |
|-------------|---------------|----------|----------|---------------|
| **Local Dev** | `.env.local` | Dev | `explainanythingdevlarge` | ❌ |
| **Unit Tests (Local)** | `jest.setup.js` | Mocked | Mocked | ❌ |
| **Integration Tests (Local)** | `.env.test` | Dev | Mocked (ns: `test`) | ❌ |
| **E2E Tests (Local)** | `playwright.config.ts` (app uses `.env.local`) | Dev | `explainanythingdevlarge` | ❌ |
| **GitHub CI** | GitHub Secrets | Dev | Dev (ns: `test`) | ❌ |
| **Vercel Preview** | Vercel Env Vars | Dev | `explainanythingdevlarge` | ✅ Honeycomb + Sentry |
| **Vercel Production** | Vercel Env Vars | Prod | `explainanythingprodlarge` | ✅ Honeycomb + Sentry |

---

## Databases

| Database | Project ID | Used By |
|----------|------------|---------|
| **Dev** | `ifubinffdbyewoezcidz` | Local, tests, CI, Vercel preview |
| **Prod** | `qbxhivoezkfbjbsctdzo` | Vercel production only |

Dashboards:
- Dev: https://supabase.com/dashboard/project/ifubinffdbyewoezcidz
- Prod: https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo

### Database Migrations

Migrations are stored in `supabase/migrations/` and deployed automatically via GitHub Actions.

**Workflow**: `.github/workflows/supabase-migrations.yml`

| Trigger | Staging | Production |
|---------|---------|------------|
| Push to `main` with changes in `supabase/migrations/**` | Auto-deploy | Auto-deploy (after staging succeeds) |
| Manual dispatch | Optional skip | Requires staging success or explicit skip |

**Manual deployment** (if needed):
```bash
# Link to project
supabase link --project-ref <project-id>

# Check pending migrations
supabase migration list

# Apply migrations
supabase db push
```

**Safety**: Production environment in GitHub should have "Required reviewers" enabled for manual approval gate.

---

## Local Development

1. Copy `.env.example` to `.env.local`
2. Fill in values from Supabase/Pinecone/OpenAI dashboards
3. Run `npm run dev`

### .env Files

| File | Purpose |
|------|---------|
| `.env.local` | Local development (also used by app during E2E tests) |
| `.env.test` | Integration tests (`PINECONE_NAMESPACE=test`) |
| `.env.example` | Template for new developers (safe to commit) |

> **Note:** Unit tests don't use `.env` files - they use mocked values defined in `jest.setup.js`. E2E tests use `playwright.config.ts` for test configuration, but the Next.js app under test loads `.env.local`.

---

## Testing

### Test Types Comparison

| Aspect | Unit | Integration | E2E |
|--------|------|-------------|-----|
| **Command** | `npm test` | `npm run test:integration` | `npm run test:e2e` |
| **Config** | `jest.config.js` | `jest.integration.config.js` | `playwright.config.ts` |
| **Environment** | jsdom | Node.js | Real browser |
| **Supabase** | Mocked | Real (service role) | Real (anon key) |
| **OpenAI** | Mocked | Mocked | Real (mockable) |
| **Pinecone** | Mocked | Mocked | Real |
| **Timeout** | 5s | 30s | 30s (local) / 60s (CI) |

### Local vs CI Execution

| Aspect | Local | CI |
|--------|-------|-----|
| **Unit tests** | Same behavior | `--maxWorkers=2` |
| **Integration** | Same behavior | Same behavior |
| **E2E server** | `npm run dev` (HMR) | `npm run build && npm start` |
| **E2E retries** | 0 | 2 |
| **E2E timeout** | 30s test / 10s expect | 60s test / 20s expect |
| **E2E mode** | `E2E_TEST_MODE` via env | `E2E_TEST_MODE` inline at runtime |

---

## GitHub Actions

### CI Workflow (`ci.yml`)

**Trigger:** Pull requests to `main` or `production`

**Change Detection (Fast Path vs Full Path):**

| Path | Trigger | Jobs Run |
|------|---------|----------|
| **Fast** | Only docs/migrations changed | lint + tsc only (~1 min) |
| **Full** | Any code file changed | All tests (~2.5-3 min) |

**Pipeline (Full Path):**
```
detect-changes → typecheck + lint (parallel)
                      ↓
              unit tests (affected only)
                      ↓
     integration-critical + e2e-critical (parallel)
```

**Test Behavior by Target Branch:**

| Target Branch | Integration | E2E | Sharding |
|---------------|------------|-----|----------|
| `main` | Critical (5 tests) | Critical (10 tests) | None |
| `production` | Full (15 tests) | Full (163 tests) | 4 shards |

- **Browser:** Chromium only
- **Fail strategy:** fail-fast (stops on first failure)

### Nightly Workflow (`e2e-nightly.yml`)

**Trigger:** Daily at 6 AM UTC (or manual dispatch)

**Behavior:**
- Runs on `main` branch
- Full E2E test suite (no sharding)
- **Browser matrix:** Chromium + Firefox
- `E2E_TEST_MODE=true` for SSE streaming compatibility
- **Fail strategy:** Continues on failure (tests all browsers)

### Post-Deploy Smoke Tests (`post-deploy-smoke.yml`)

**Trigger:** Vercel deployment completes successfully to Production

**Behavior:**
- Runs `@smoke` tagged E2E tests against the live production URL
- Uses **Production environment secrets** (separate from repository secrets)
- Health check before running tests
- Chromium only
- **Slack notification** on failure (if `SLACK_WEBHOOK_URL` is configured)

### Workflow Comparison

| Aspect | CI | Nightly | Post-Deploy Smoke |
|--------|-----|---------|-------------------|
| **Trigger** | PR to main/production | Daily 6 AM UTC | Vercel deploy success |
| **Branch** | PR branch | main | production |
| **Test types** | Unit → Integration + E2E (parallel) | E2E only | E2E `@smoke` only |
| **Target** | Local build | Local build | Live production URL |
| **Secrets** | Development environment | Development environment | Production environment |
| **Browsers** | Chromium | Chromium + Firefox | Chromium |

> **Note:** CI and Nightly workflows build and run the app locally on the GitHub runner (`npm run build && npm start`). They do NOT test against any deployed environment. Only the Post-Deploy Smoke workflow tests against a live deployment.

### GitHub Secrets

Secrets are organized using GitHub Environments for clear separation:

#### Repository Secrets (Shared)

Available to all workflows - API keys that don't change between environments:

| Secret | Purpose |
|--------|---------|
| `OPENAI_API_KEY` | OpenAI API key |
| `PINECONE_API_KEY` | Pinecone API key |

#### Development Environment Secrets

Used by `ci.yml` and `e2e-nightly.yml` with `environment: Development`:

| Secret | Value |
|--------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Dev Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dev anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Dev service role |
| `PINECONE_INDEX_NAME_ALL` | `explainanythingdevlarge` |
| `PINECONE_NAMESPACE` | `test` |
| `TEST_USER_EMAIL` | Dev test user email |
| `TEST_USER_PASSWORD` | Dev test user password |
| `TEST_USER_ID` | Dev test user UUID |

#### Production Environment Secrets

Used by `post-deploy-smoke.yml` with `environment: Production`:

| Secret | Value |
|--------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Prod Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod anon key |
| `TEST_USER_EMAIL` | Prod test user email |
| `TEST_USER_PASSWORD` | Prod test user password |
| `TEST_USER_ID` | Prod test user UUID |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Bypass Vercel deployment protection |
| `SLACK_WEBHOOK_URL` | Slack webhook for smoke test failure alerts (optional) |

> **Note:** Same secret names (`TEST_USER_*`) are used in both environments with different values. GitHub's environment override behavior ensures the correct credentials are used.

---

## Vercel

- **Project**: explainanything
- **Production URL**: https://explainanything.vercel.app

Vercel has separate env var sets for Production and Preview. Both have Honeycomb (OTLP) and Sentry configured.

---

## Observability

Only deployed environments (Vercel) have observability configured.

| Tool | Purpose | Config |
|------|---------|--------|
| **Honeycomb** | Distributed tracing & logs | `OTEL_EXPORTER_OTLP_ENDPOINT` |
| **Sentry** | Error tracking | Tunnel: `/api/monitoring` |

### Log Levels

By default, production only sends ERROR/WARN logs to Honeycomb. Enable all log levels for debugging:

| Variable | Type | Purpose | Default |
|----------|------|---------|---------|
| `OTEL_SEND_ALL_LOG_LEVELS` | Runtime | Server sends debug/info logs to Honeycomb | `false` |
| `NEXT_PUBLIC_LOG_ALL_LEVELS` | Build-time | Client sends debug logs to server | `false` |

**Important**: `NEXT_PUBLIC_*` variables are baked into the JavaScript bundle at build time. Changing them requires a new deployment, not just an env var update.

**Warning**: Enabling `OTEL_SEND_ALL_LOG_LEVELS=true` can consume significant event budget. Honeycomb free tier is 20M events/month. Start with `false` and monitor usage.

### Querying Logs in Honeycomb

See `scripts/query-honeycomb.md` for detailed instructions on querying logs and traces.

**Quick start:**
1. Go to [ui.honeycomb.io](https://ui.honeycomb.io)
2. Select the `explainanything` dataset
3. Filter by `requestId = <your-request-id>`
4. Use **BubbleUp** to identify what's different about slow/failing requests

---

## Environment Variables Reference

### Required

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key (server-only) |
| `OPENAI_API_KEY` | OpenAI API key |
| `PINECONE_API_KEY` | Pinecone API key |
| `PINECONE_INDEX_NAME_ALL` | Pinecone index name |

### Optional (Observability)

| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Honeycomb OTLP endpoint (`https://api.honeycomb.io`) |
| `OTEL_EXPORTER_OTLP_HEADERS` | Honeycomb auth header (`x-honeycomb-team=YOUR_KEY`) |
| `OTEL_SERVICE_NAME` | Service/dataset name in Honeycomb |
| `OTEL_SEND_ALL_LOG_LEVELS` | Send debug/info logs to Honeycomb (runtime) |
| `NEXT_PUBLIC_ENABLE_BROWSER_TRACING` | Enable browser tracing via `/api/traces` proxy |
| `NEXT_PUBLIC_LOG_ALL_LEVELS` | Client sends all log levels (build-time) |
| `SENTRY_DSN` | Sentry DSN |

### Testing

| Variable | Description |
|----------|-------------|
| `TEST_USER_EMAIL` | E2E test user email |
| `TEST_USER_PASSWORD` | E2E test user password |
| `TEST_USER_ID` | E2E test user UUID |
| `PINECONE_NAMESPACE` | Namespace for test isolation (`test` in CI) |
