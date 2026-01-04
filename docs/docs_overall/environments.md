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

## Local Setup

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

| Test Type | Command | Config | External Services |
|-----------|---------|--------|-------------------|
| **Unit** | `npm test` | `jest.config.js` | All mocked |
| **Integration** | `npm run test:integration` | `jest.integration.config.js` | Real Supabase, mocked AI |
| **E2E** | `npm run test:e2e` | `playwright.config.ts` | All real |

---

## CI/CD

| Workflow | Trigger | Branch | Tests |
|----------|---------|--------|-------|
| `ci.yml` | PRs to main/production | PR branch | Unit, Integration, E2E |
| `e2e-nightly.yml` | Daily 6AM UTC | main | Full E2E (Chromium + Firefox) |

Both workflows use the same **GitHub Secrets** (dev database credentials).

### GitHub Secrets

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
