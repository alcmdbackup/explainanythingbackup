# Environments

## Overview

| Environment | Config Source | Supabase | Pinecone | Grafana | Sentry |
|-------------|---------------|----------|----------|---------|--------|
| **Local Dev** | `.env.local` | Dev (`ifubinffdbyewoezcidz`) | `explainanythingdevlarge` | ❌ | ❌ |
| **Integration Tests** | `.env.test` | Dev (`ifubinffdbyewoezcidz`) | `explainanythingdevlarge` (ns: `test`) | ❌ | ❌ |
| **GitHub CI** | GitHub Secrets | Dev (`ifubinffdbyewoezcidz`) | `explainanythingdevlarge` (ns: `test`) | ❌ | ❌ |
| **Vercel Preview** | Vercel Env Vars | Dev (`ifubinffdbyewoezcidz`) | `explainanythingdevlarge` | ✅ | ✅ |
| **Vercel Production** | Vercel Env Vars | Prod (`qbxhivoezkfbjbsctdzo`) | `explainanythingprodlarge` | ✅ | ✅ |

---

## .env Files

| File | Used By | Purpose |
|------|---------|---------|
| `.env.local` | `npm run dev`, E2E tests | Primary local development. Next.js auto-loads this. |
| `.env.test` | `npm run test:integration` | Jest integration tests. Loaded by `jest.integration-setup.js`. |
| `.env.example` | New developers | Template to copy to `.env.local`. Safe to commit (no secrets). |

> **Note**: Production and staging environments are configured via **Vercel's environment variables panel**, not local files. There are no `.env.prod` or `.env.stage` files.

---

## Environment Details

### Local Development

**Purpose**: Day-to-day development on your machine.

| Aspect | Configuration |
|--------|---------------|
| **Config Source** | `.env.local` file |
| **How to use** | `npm run dev` (Next.js auto-loads `.env.local`) |
| **Database** | Dev Supabase (`ifubinffdbyewoezcidz`) |
| **Pinecone** | `explainanythingdevlarge` |
| **Grafana OTLP** | ❌ Not configured (optional) |
| **Sentry** | ❌ Not configured |

---

### Jest Integration Tests

**Purpose**: Automated integration tests that run against real Supabase.

| Aspect | Configuration |
|--------|---------------|
| **Config Source** | `.env.test` file (loaded by `jest.integration-setup.js`) |
| **How to use** | `npm run test:integration` |
| **Database** | Dev Supabase (`ifubinffdbyewoezcidz`) |
| **Pinecone** | `explainanythingdevlarge`, namespace: `test` |
| **Grafana OTLP** | ❌ Not configured |
| **Sentry** | ❌ Not configured |

---

### GitHub Actions CI

**Purpose**: Automated CI pipeline for PRs (typecheck, lint, unit, integration, E2E).

| Aspect | Configuration |
|--------|---------------|
| **Config Source** | GitHub Secrets (injected as env vars in workflows) |
| **How to use** | Triggered automatically on PRs to `main` or `production` |
| **Database** | Dev Supabase (`ifubinffdbyewoezcidz`) |
| **Pinecone** | `explainanythingdevlarge`, namespace: `test` |
| **Grafana OTLP** | ❌ Not configured |
| **Sentry** | ❌ Not configured |

---

### Vercel Preview (Staging)

**Purpose**: Preview deployments for PRs before merging.

| Aspect | Configuration |
|--------|---------------|
| **Config Source** | Vercel Environment Variables (Preview environment) |
| **How to use** | Automatic on PR creation |
| **Database** | Dev Supabase (`ifubinffdbyewoezcidz`) |
| **Pinecone** | `explainanythingdevlarge` |
| **Grafana OTLP** | ✅ Configured in Vercel |
| **Sentry** | ✅ Configured in Vercel |

---

### Vercel Production

**Purpose**: Live application for end users.

| Aspect | Configuration |
|--------|---------------|
| **Config Source** | Vercel Environment Variables (Production environment) |
| **URL** | https://explainanything.vercel.app |
| **Database** | Prod Supabase (`qbxhivoezkfbjbsctdzo`) |
| **Pinecone** | `explainanythingprodlarge` |
| **Grafana OTLP** | ✅ Configured in Vercel |
| **Sentry** | ✅ Configured in Vercel |

---

## Supabase

### Development Database
- **Project ID**: `ifubinffdbyewoezcidz`
- **URL**: https://ifubinffdbyewoezcidz.supabase.co
- **Dashboard**: https://supabase.com/dashboard/project/ifubinffdbyewoezcidz
- **Used by**: Local dev, integration tests, CI, Vercel preview

### Production Database
- **Project ID**: `qbxhivoezkfbjbsctdzo`
- **URL**: https://qbxhivoezkfbjbsctdzo.supabase.co
- **Dashboard**: https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo
- **Used by**: Vercel production only

---

## Pinecone

| Index | Environment | Notes |
|-------|-------------|-------|
| `explainanythingdevlarge` | Dev/Stage/Test | Test namespace: `test` for CI isolation |
| `explainanythingprodlarge` | Production | Production embeddings |

---

## Vercel

- **Team**: acs-projects-dcdb9943
- **Project**: explainanything
- **Production URL**: https://explainanything.vercel.app

### Vercel Environment Variables

Vercel has separate environment variable sets for:
- **Production**: Uses prod Supabase/Pinecone, has Grafana OTLP and Sentry configured
- **Preview**: Uses dev Supabase/Pinecone, has Grafana OTLP and Sentry configured
- **Development**: Rarely used (local dev uses `.env.local` instead)

---

## Observability

### Grafana Cloud (OpenTelemetry)
- **Endpoint**: `https://otlp-gateway-prod-us-west-0.grafana.net/otlp`
- **Instance ID**: `1328063`
- **Browser tracing**: Enable with `NEXT_PUBLIC_ENABLE_BROWSER_TRACING=true`

**Note**: `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` is intentionally public - it's designed for browser-side OpenTelemetry tracing with limited scope (write traces only).

### Sentry
- **Tunnel**: `/api/monitoring` (bypasses ad blockers)
- **Sampling**: 20% traces in prod, 100% in dev

---

## Environment Variables

### Required Variables
| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | JWT token |
| `OPENAI_API_KEY` | OpenAI API key | `sk-proj-...` |
| `PINECONE_API_KEY` | Pinecone API key | `pcsk_...` |
| `PINECONE_INDEX_NAME_ALL` | Pinecone index | `explainanythingdevlarge` |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin key (server-only) | JWT token |

### Optional Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Grafana OTLP endpoint | (disabled) |
| `OTEL_EXPORTER_OTLP_HEADERS` | OTLP auth header | `Authorization=Basic base64(id:token)` |
| `NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT` | Browser OTLP endpoint | (disabled) |
| `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` | Browser OTLP token | (disabled) |
| `NEXT_PUBLIC_ENABLE_BROWSER_TRACING` | Enable browser traces | `false` |
| `SENTRY_DSN` | Sentry server DSN | (disabled) |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry client DSN | (disabled) |

### Testing Variables
| Variable | Description | Notes |
|----------|-------------|-------|
| `TEST_USER_EMAIL` | E2E test user email | For local E2E tests |
| `TEST_USER_PASSWORD` | E2E test user password | For local E2E tests |
| `TEST_USER_ID` | E2E test user UUID | For local E2E tests |
| `PINECONE_NAMESPACE` | Test namespace | `test` in CI |
| `NEXT_PUBLIC_USE_AI_API_ROUTE` | Enable AI route mocking | `true` in E2E |

---

## Local Development Setup

1. Copy `.env.example` to `.env.local`
2. Fill in values from Supabase/Pinecone/OpenAI dashboards
3. Run `npm run dev`

---

## GitHub Secrets (CI)

| Secret | Purpose |
|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Dev Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dev anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Dev service role |
| `OPENAI_API_KEY` | OpenAI API |
| `PINECONE_API_KEY` | Pinecone API |
| `PINECONE_INDEX_NAME_ALL` | Dev index |
| `PINECONE_NAMESPACE` | `test` |
| `TEST_USER_EMAIL` | E2E user email |
| `TEST_USER_PASSWORD` | E2E user password |
| `TEST_USER_ID` | E2E user UUID |

---

## CI/CD Workflows

| Workflow | Trigger | Tests | Notes |
|----------|---------|-------|-------|
| `ci.yml` | PRs to main/production | Unit, Integration, E2E | E2E sharded (2 or 4) |
| `e2e-nightly.yml` | Daily 6AM UTC | Full E2E | Chromium + Firefox |

Both workflows use the **same GitHub Secrets** for configuration. The nightly job runs against the `main` branch, while CI runs against the PR branch.

---

## Test Configuration

### Unit Tests (`npm test`)

| Aspect | Configuration |
|--------|---------------|
| **Config file** | `jest.config.js` |
| **Setup file** | `jest.setup.js` |
| **Environment** | `jsdom` (browser-like) |
| **External services** | All mocked (Supabase, Pinecone, OpenAI) |
| **Env vars** | Hardcoded test values in `jest.setup.js` |

Unit tests are fully isolated with no external dependencies. All services are mocked via `moduleNameMapper` in the Jest config.

### Integration Tests (`npm run test:integration`)

| Aspect | Configuration |
|--------|---------------|
| **Config file** | `jest.integration.config.js` |
| **Setup file** | `jest.integration-setup.js` |
| **Environment** | `node` |
| **Supabase** | **Real** (dev database) |
| **Pinecone/OpenAI** | Mocked (for speed/cost) |
| **Env vars** | Loaded from `.env.test` |

Integration tests use the real Supabase database but mock external AI services. The `.env.test` file configures `PINECONE_NAMESPACE=test` for isolation.

### E2E Tests (`npm run test:e2e`)

| Aspect | Configuration |
|--------|---------------|
| **Config file** | `playwright.config.ts` |
| **Setup file** | `src/__tests__/e2e/setup/global-setup.ts` |
| **Environment** | Real browser (Chromium/Firefox) |
| **All services** | **Real** (dev database, real API calls) |
| **Env vars** | Loaded from `.env.local` (local) or GitHub Secrets (CI) |

E2E tests run the full application in a real browser. Locally uses `npm run dev`, CI uses a production build with `E2E_TEST_MODE=true`.
