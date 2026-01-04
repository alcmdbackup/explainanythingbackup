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

### Workflow Comparison

| Aspect | CI | Nightly |
|--------|-----|---------|
| **Trigger** | PR to main/production | Daily 6 AM UTC |
| **Branch** | PR branch | main |
| **Test types** | Unit → Integration → E2E | E2E only |
| **E2E scope** | Critical or sharded full | Full suite |
| **Browsers** | Chromium | Chromium + Firefox |
| **On failure** | Stop immediately | Continue testing |

### GitHub Secrets

Both CI and Nightly workflows use the same secrets (dev database credentials):

| Secret | Value |
|--------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Dev Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dev anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Dev service role |
| `OPENAI_API_KEY` | OpenAI API key |
| `PINECONE_API_KEY` | Pinecone API key |
| `PINECONE_INDEX_NAME_ALL` | `explainanythingdevlarge` |
| `PINECONE_NAMESPACE` | `test` |
| `TEST_USER_EMAIL` | E2E test user |
| `TEST_USER_PASSWORD` | E2E test password |
| `TEST_USER_ID` | E2E test user UUID |

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
