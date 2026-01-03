# Environment Setup Cleanup - Research

## 1. Problem Statement

The project has inconsistent environment configuration across local, staging, production, and CI environments. `.env.stage` has placeholder values making it unusable, and there's no `.env.example` template for onboarding new developers. Documentation about environment setup is scattered or missing.

**Key Finding**: The `.gitignore` already has `.env*` pattern - env files are NOT tracked in git (security is in place). The issue is documentation and consistency, not security.

## 2. High Level Summary

This project will:
1. Document all environment configurations (Supabase, Pinecone, Vercel, Grafana, Sentry)
2. Create `.env.example` template for new developer onboarding
3. Fix the broken `.env.stage` file
4. Create comprehensive documentation at `docs/docs_overall/environments.md`
5. Update `docs/docs_overall/getting_started.md` to reference new documentation

## 3. Documents Read

| Document | Key Insights |
|----------|--------------|
| `docs/docs_overall/getting_started.md` | Entry point, references architecture.md |
| `docs/docs_overall/architecture.md` | Tech stack, CI/CD overview, observability mentions Grafana/OTEL |
| `docs/docs_overall/start_project.md` | Project setup template |
| `docs/docs_overall/project_instructions.md` | Execution workflow |
| `docs/feature_deep_dives/request_tracing_observability.md` | OTEL tracing, Grafana integration details |
| `docs/feature_deep_dives/testing_setup.md` | Test tiers, CI secrets, E2E configuration |
| `.github/workflows/ci.yml` | CI workflow, all secrets listed |
| `.github/workflows/e2e-nightly.yml` | Nightly E2E, E2E_TEST_MODE flag |

## 4. Code Files Read

### Environment Files
| File | Status | Variables | Notes |
|------|--------|-----------|-------|
| `.env.local` | ✅ Complete | 16 vars | Dev Supabase, Grafana OTLP, test user credentials |
| `.env.prod` | ⚠️ Partial | 6 vars | Prod Supabase/Pinecone, Vercel OIDC, missing service role key |
| `.env.stage` | ❌ Broken | 7 vars | Has placeholder `<YOUR_SERVICE_ROLE_KEY_HERE>` |
| `.env.test` | ✅ Complete | 11 vars | Test namespace, NODE_ENV=test, test prefixes |

### Git Security Status
```bash
# .gitignore already contains:
.env*
.env.local

# Verification: No .env files are tracked
$ git ls-files | grep -E '\.env'  # Returns empty
```

### Configuration Files Reviewed
| File | Purpose |
|------|---------|
| `next.config.ts` | Sentry integration, source maps |
| `sentry.client.config.ts` | Browser error tracking |
| `sentry.server.config.ts` | Server error tracking |
| `sentry.edge.config.ts` | Edge runtime errors |
| `instrumentation.ts` | OpenTelemetry tracers setup |
| `playwright.config.ts` | E2E projects, env vars, timeouts |
| `jest.config.js` | Unit test mocks |
| `jest.integration.config.js` | Integration with real Supabase |

## 5. Key Findings

### Environment Matrix

| Environment | Supabase Project | Pinecone Index | URL | Purpose |
|-------------|------------------|----------------|-----|---------|
| **Local Dev** | `ifubinffdbyewoezcidz` | `explainanythingdevlarge` | localhost:3000 | Development |
| **Staging** | `ifubinffdbyewoezcidz` | `explainanythingdevlarge` | Vercel preview | Pre-production |
| **Production** | `qbxhivoezkfbjbsctdzo` | `explainanythingprodlarge` | explainanything.vercel.app | Live |
| **CI/Test** | `ifubinffdbyewoezcidz` | `explainanythingdevlarge` (ns: `test`) | N/A | Automated tests |

### Supabase Projects
- **Dev/Test/Stage**: `ifubinffdbyewoezcidz`
  - Dashboard: https://supabase.com/dashboard/project/ifubinffdbyewoezcidz
- **Production**: `qbxhivoezkfbjbsctdzo`
  - Dashboard: https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo

### Pinecone Configuration
| Index | Environment | Notes |
|-------|-------------|-------|
| `explainanythingdevlarge` | Dev/Stage/Test | Test namespace: `test` for isolation |
| `explainanythingprodlarge` | Production | Production data |

### Vercel Deployment
- **Team ID**: `team_0stLdE0E29VbT5gPz3N3Qp3H` (acs-projects-dcdb9943)
- **Project ID**: `prj_I9Uivc7ZKmp8JoFo4cAaudf8ciuB4`
- **Project Name**: `explainanything`
- **Production URL**: https://explainanything.vercel.app

### Grafana Cloud (OpenTelemetry)
- **Endpoint**: `https://otlp-gateway-prod-us-west-0.grafana.net/otlp`
- **Instance ID**: `1328063`
- **Used for**: Server traces, client logs, LLM/DB/Vector operation tracking
- **Browser tracing**: Enabled via `NEXT_PUBLIC_ENABLE_BROWSER_TRACING=true`

### Sentry Configuration
- **Configured via**: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`
- **Tunnel Route**: `/api/monitoring` (bypasses ad blockers)
- **Sampling**: 20% traces in prod, 100% in dev
- **Features**: Session replay, browser tracing, source maps

### GitHub Secrets Required
| Secret | Used In | Purpose |
|--------|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | All CI jobs | Supabase API endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All CI jobs | Public Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | Integration/E2E | Admin database access |
| `OPENAI_API_KEY` | Integration/E2E | LLM API calls |
| `PINECONE_API_KEY` | Integration/E2E | Vector database |
| `PINECONE_INDEX_NAME_ALL` | Integration/E2E | Index name |
| `PINECONE_INDEX` | Integration/E2E | Legacy index reference |
| `PINECONE_NAMESPACE` | Integration/E2E | Test isolation (`test`) |
| `TEST_USER_EMAIL` | E2E tests | Test account login |
| `TEST_USER_PASSWORD` | E2E tests | Test account password |
| `TEST_USER_ID` | E2E tests | Test user UUID |

### CI/CD Workflows
| Workflow | Trigger | Tests | Notes |
|----------|---------|-------|-------|
| `ci.yml` | PRs to main/production | Unit, Integration, E2E | E2E sharded (2 or 4) |
| `e2e-nightly.yml` | Daily 6AM UTC | Full E2E | Chromium only, E2E_TEST_MODE=true |

### Variable Categories
1. **Supabase** (3): URL, anon key, service role key
2. **AI Services** (3): OpenAI key, Pinecone key, Pinecone index
3. **Observability** (5): OTEL endpoint/headers, Grafana token, browser tracing flag
4. **Sentry** (2): DSN, public DSN
5. **Testing** (4): Test user email/password/ID, namespace
