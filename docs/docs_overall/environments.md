# Environments

## Overview

| Environment | Supabase Project | Pinecone Index | URL |
|-------------|------------------|----------------|-----|
| **Local Dev** | `ifubinffdbyewoezcidz` | `explainanythingdevlarge` | localhost:3000 |
| **Staging** | `ifubinffdbyewoezcidz` | `explainanythingdevlarge` | Vercel preview |
| **Production** | `qbxhivoezkfbjbsctdzo` | `explainanythingprodlarge` | explainanything.vercel.app |
| **CI/Test** | `ifubinffdbyewoezcidz` | `explainanythingdevlarge` (ns: `test`) | N/A |

---

## Supabase

### Development Database
- **Project ID**: `ifubinffdbyewoezcidz`
- **URL**: https://ifubinffdbyewoezcidz.supabase.co
- **Dashboard**: https://supabase.com/dashboard/project/ifubinffdbyewoezcidz
- **Used by**: Local dev, staging, CI tests

### Production Database
- **Project ID**: `qbxhivoezkfbjbsctdzo`
- **URL**: https://qbxhivoezkfbjbsctdzo.supabase.co
- **Dashboard**: https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo

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
| `SUPABASE_SERVICE_ROLE_KEY` | Admin key (server-only) | JWT token |
| `OPENAI_API_KEY` | OpenAI API key | `sk-proj-...` |
| `PINECONE_API_KEY` | Pinecone API key | `pcsk_...` |
| `PINECONE_INDEX_NAME_ALL` | Pinecone index | `explainanythingdevlarge` |
| `PINECONE_INDEX` | Legacy index reference | `explainanythingdevlarge` |

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
| `PINECONE_INDEX` | Legacy index reference |
| `PINECONE_NAMESPACE` | `test` |
| `TEST_USER_EMAIL` | E2E user email |
| `TEST_USER_PASSWORD` | E2E user password |
| `TEST_USER_ID` | E2E user UUID |

---

## CI/CD Workflows

| Workflow | Trigger | Tests | Notes |
|----------|---------|-------|-------|
| `ci.yml` | PRs to main/production | Unit, Integration, E2E | E2E sharded (2 or 4) |
| `e2e-nightly.yml` | Daily 6AM UTC | Full E2E | Chromium, E2E_TEST_MODE=true |
