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
| `.env.local` | Local development (also used by app during E2E tests) |
| `.env.test` | Integration tests (`PINECONE_NAMESPACE=test`) |
| `.env.example` | Template for new developers (safe to commit) |

> **Note:** Unit tests don't use `.env` files - they use mocked values defined in `jest.setup.js`. E2E tests use `playwright.config.ts` for test configuration, but the Next.js app under test loads `.env.local`.

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
