# Environments

## Overview

| Environment | Config Source | Supabase | Pinecone | Observability |
|-------------|---------------|----------|----------|---------------|
| **Local Dev** | `.env.local` | Dev | `explainanythingdevlarge` | ❌ |
| **Unit Tests** | `jest.setup.js` | Mocked | Mocked | ❌ |
| **Integration Tests** | `.env.test` | Dev | Mocked (ns: `test`) | ❌ |
| **GitHub CI** | GitHub Secrets | Dev | Dev (ns: `test`) | ❌ |
| **Vercel Preview** | Vercel Env Vars | Dev | `explainanythingdevlarge` | ✅ Grafana + Sentry |
| **Vercel Production** | Vercel Env Vars | Prod | `explainanythingprodlarge` | ✅ Grafana + Sentry |

---

## Databases

| Database | Project ID | Used By |
|----------|------------|---------|
| **Dev** | `ifubinffdbyewoezcidz` | Local, tests, CI, Vercel preview |
| **Prod** | `qbxhivoezkfbjbsctdzo` | Vercel production only |

Dashboards:
- Dev: https://supabase.com/dashboard/project/ifubinffdbyewoezcidz
- Prod: https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo

---

## Local Development

1. Copy `.env.example` to `.env.local`
2. Fill in values from Supabase/Pinecone/OpenAI dashboards
3. Run `npm run dev`

### .env Files

| File | Purpose |
|------|---------|
| `.env.local` | Local development and E2E tests |
| `.env.test` | Integration tests (`PINECONE_NAMESPACE=test`) |
| `.env.example` | Template for new developers (safe to commit) |

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

**Pipeline:**
```
typecheck → lint → unit tests → integration tests → E2E tests
```

**E2E Behavior by Target Branch:**

| Target Branch | E2E Scope | Tests | Sharding |
|---------------|-----------|-------|----------|
| `main` | Critical only | ~36 `@critical` tagged | None |
| `production` | Full suite | All tests | 4 shards |

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
| **Test types** | Unit → Integration → E2E | E2E only | E2E `@smoke` only |
| **Target** | Local build | Local build | Live production URL |
| **Secrets** | Repository (dev) | Repository (dev) | Production environment |
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

Vercel has separate env var sets for Production and Preview. Both have Grafana OTLP and Sentry configured.

---

## Observability

Only deployed environments (Vercel) have observability configured.

| Tool | Purpose | Config |
|------|---------|--------|
| **Grafana OTLP** | Distributed tracing | `OTEL_EXPORTER_OTLP_ENDPOINT` |
| **Sentry** | Error tracking | Tunnel: `/api/monitoring` |

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
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Grafana OTLP endpoint |
| `OTEL_EXPORTER_OTLP_HEADERS` | OTLP auth header |
| `NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT` | Browser OTLP endpoint |
| `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` | Browser OTLP token (intentionally public) |
| `SENTRY_DSN` | Sentry DSN |

### Testing

| Variable | Description |
|----------|-------------|
| `TEST_USER_EMAIL` | E2E test user email |
| `TEST_USER_PASSWORD` | E2E test user password |
| `TEST_USER_ID` | E2E test user UUID |
| `PINECONE_NAMESPACE` | Namespace for test isolation (`test` in CI) |
