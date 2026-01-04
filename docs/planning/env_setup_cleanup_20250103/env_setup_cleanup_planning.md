# Environment Setup Cleanup - Planning

## 1. Background

ExplainAnything uses multiple environments (local dev, staging, production, CI) with different Supabase databases, Pinecone indexes, and observability configurations. The `.gitignore` already protects sensitive files from being committed, but there's no documentation explaining the environment setup, no `.env.example` template for onboarding, and `.env.stage` is broken with placeholder values.

## 2. Problem

1. **No Onboarding Guide**: New developers have no `.env.example` template or documentation explaining what variables are needed
2. **Broken Configuration**: `.env.stage` has `<YOUR_SERVICE_ROLE_KEY_HERE>` placeholder - unusable
3. **Scattered Knowledge**: Environment details are not documented in one place
4. **No Reference**: `getting_started.md` doesn't reference environment setup

**Note**: Security is already handled - `.gitignore` has `.env*` pattern and no env files are tracked in git.

**Security Note on NEXT_PUBLIC_GRAFANA_OTLP_TOKEN**: This token is intentionally public because it's used for browser-side OpenTelemetry tracing. The token has limited scope (write traces only) and is designed to be exposed to browsers for client-side telemetry.

## 3. Options Considered

### Option A: Minimal Fix (Not Recommended)
- Just fix `.env.stage`
- Pros: Quick
- Cons: Doesn't address documentation or onboarding

### Option B: Full Documentation (Recommended)
- Create `.env.example` template
- Create comprehensive `environments.md` documentation
- Fix `.env.stage`
- Update `getting_started.md`
- Pros: Complete solution, improves DX
- Cons: More work upfront

**Selected: Option B**

## 4. Phased Execution Plan

### Phase 1: Create environments.md Documentation

Create comprehensive environment documentation at `docs/docs_overall/environments.md`.

**File to Create**: `docs/docs_overall/environments.md`

```markdown
# Environments

## Overview

| Environment | Supabase Project | Pinecone Index | URL |
|-------------|------------------|----------------|-----|
| **Local Dev** | `ifubinffdbyewoezcidz` | `explainanythingdevlarge` | localhost:3000 |
| **Staging** | `ifubinffdbyewoezcidz` | `explainanythingdevlarge` | Vercel preview |
| **Production** | `qbxhivoezkfbjbsctdzo` | `explainanythingprodlarge` | explainanything.vercel.app |
| **CI/Test** | `ifubinffdbyewoezcidz` | `explainanythingdevlarge` (ns: `test`) | N/A |

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

## Pinecone

| Index | Environment | Notes |
|-------|-------------|-------|
| `explainanythingdevlarge` | Dev/Stage/Test | Test namespace: `test` |
| `explainanythingprodlarge` | Production | Production embeddings |

## Vercel

- **Team**: acs-projects-dcdb9943
- **Project**: explainanything
- **Production URL**: https://explainanything.vercel.app

## Observability

### Grafana Cloud (OpenTelemetry)
- **Endpoint**: `https://otlp-gateway-prod-us-west-0.grafana.net/otlp`
- **Instance ID**: `1328063`
- **Browser tracing**: `NEXT_PUBLIC_ENABLE_BROWSER_TRACING=true`

### Sentry
- **Tunnel**: `/api/monitoring`
- **Sampling**: 20% prod, 100% dev

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
| `NEXT_PUBLIC_ENABLE_BROWSER_TRACING` | Enable browser traces | `false` |
| `SENTRY_DSN` | Sentry DSN | (disabled) |
| `TEST_USER_EMAIL` | E2E test user | (for testing) |

## Local Development Setup

1. Copy `.env.example` to `.env.local`
2. Fill in values from Supabase/Pinecone/OpenAI dashboards
3. Run `npm run dev`

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
```

---

### Phase 2: Create .env.example Template

Create a template for new developers.

**File to Create**: `.env.example`

```bash
# ===========================================
# ExplainAnything Environment Configuration
# ===========================================
# Copy this file to .env.local and fill in values
# See docs/docs_overall/environments.md for details

# --- Supabase ---
# Get these from: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# --- AI Services ---
# OpenAI: https://platform.openai.com/api-keys
OPENAI_API_KEY=

# Pinecone: https://app.pinecone.io
PINECONE_API_KEY=
PINECONE_INDEX_NAME_ALL=explainanythingdevlarge
PINECONE_INDEX=explainanythingdevlarge

# --- Observability (optional) ---
# Grafana Cloud OTLP - leave blank to disable tracing
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_EXPORTER_OTLP_HEADERS=
NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT=
NEXT_PUBLIC_GRAFANA_OTLP_TOKEN=
NEXT_PUBLIC_ENABLE_BROWSER_TRACING=false

# --- Sentry (optional) ---
# Leave blank to disable error tracking
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# --- E2E Testing (optional) ---
# Only needed if running E2E tests locally
TEST_USER_EMAIL=
TEST_USER_PASSWORD=
TEST_USER_ID=
PINECONE_NAMESPACE=
NEXT_PUBLIC_USE_AI_API_ROUTE=true
```

---

### Phase 3: Fix .env.stage

Update `.env.stage` to be a proper template (like `.env.example` but for staging context).

**Approach**: Rather than shipping partial configs with some keys filled in and some empty, make `.env.stage` a clean template. Developers should copy their credentials from `.env.local` or the dashboards. This avoids:
1. Hardcoding any keys (even public ones) in documentation
2. Confusing partial configurations
3. Accidental copy-paste of wrong environment keys

**File to Modify**: `.env.stage`

```bash
# ===========================================
# Staging Environment Configuration
# ===========================================
# Copy values from .env.local for staging testing
# Uses development Supabase/Pinecone (same databases as local)
#
# Setup:
# 1. Copy this file or fill in from .env.local
# 2. All values use the DEVELOPMENT database (ifubinffdbyewoezcidz)
# 3. This is for testing Vercel preview deployments locally

# --- Supabase (Development Database) ---
# Get from: https://supabase.com/dashboard/project/ifubinffdbyewoezcidz/settings/api
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# --- AI Services ---
OPENAI_API_KEY=
PINECONE_API_KEY=
PINECONE_INDEX_NAME_ALL=explainanythingdevlarge
PINECONE_INDEX=explainanythingdevlarge
```

---

### Phase 4: Update getting_started.md

Add reference to environments documentation.

**File to Modify**: `docs/docs_overall/getting_started.md`

Add after line 4:

```markdown
- For environment setup, read /docs/docs_overall/environments.md
```

## 5. Testing

### Manual Verification Checklist
- [ ] `.env.example` can be copied to `.env.local`
- [ ] Variables in `.env.example` match what's documented in `environments.md`
- [ ] `environments.md` accurately describes all environments
- [ ] `getting_started.md` links to `environments.md`
- [ ] `.env.stage` has proper structure (verify manually)

### No Code Tests Required
This is a documentation-only change - no functional code is modified, so no unit/integration/E2E tests are needed.

### Build Verification
Run full test suite to ensure no regressions:
```bash
npm run build
npx tsc --noEmit
npm run lint
npm test
npm run test:integration
npm run test:e2e:critical
```

## 6. Rollback Plan

This is a documentation-only change with no functional code modifications. If issues arise:

1. **Revert commits**: `git revert <commit-hash>` for any problematic changes
2. **Files are additive**: New files (`.env.example`, `environments.md`) can simply be deleted
3. **No runtime impact**: These changes don't affect application behavior

## 7. Documentation Updates

| File | Action |
|------|--------|
| `docs/docs_overall/environments.md` | CREATE - comprehensive environment docs |
| `docs/docs_overall/getting_started.md` | MODIFY - add link to environments.md |
| `.env.example` | CREATE - template for onboarding |
| `.env.stage` | MODIFY - fix placeholder values |

## 8. Files Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `docs/docs_overall/environments.md` | CREATE | ~100 lines |
| `.env.example` | CREATE | ~35 lines |
| `.env.stage` | MODIFY | ~20 lines |
| `docs/docs_overall/getting_started.md` | MODIFY | +1 line |

---

## 9. GitHub Secrets Consolidation

### Background

Currently, GitHub secrets are split between repository-level and environment-level without a clear structure:
- **Repository Secrets**: 11 secrets, all pointing to dev database
- **Production Environment Secrets**: 6 secrets with `PROD_` prefix for test users

This creates inconsistent naming and makes it unclear which secrets belong to which environment.

### Goal

Use GitHub Environments for everything, with consistent naming:
- **Repository Secrets**: Only shared secrets (API keys that don't change between environments)
- **Development Environment**: Dev database credentials and test users
- **Production Environment**: Prod database credentials and test users (same names, different values)

### Proposed Structure

**Repository Secrets (shared across all environments):**

| Secret | Purpose |
|--------|---------|
| `OPENAI_API_KEY` | OpenAI API key (same for dev/prod) |
| `PINECONE_API_KEY` | Pinecone API key (same for dev/prod) |

**Development Environment Secrets:**

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

**Production Environment Secrets:**

| Secret | Value |
|--------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Prod Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod anon key |
| `TEST_USER_EMAIL` | Prod test user email |
| `TEST_USER_PASSWORD` | Prod test user password |
| `TEST_USER_ID` | Prod test user UUID |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel bypass secret |

### Benefits

1. **Consistent naming**: `TEST_USER_*` everywhere, no `PROD_` prefix needed
2. **Clear separation**: Dev vs Prod credentials in their respective environments
3. **Environment-level controls**: Can add approval requirements for Production
4. **Easier auditing**: Clear which workflows access which credentials
5. **No duplication**: Shared API keys stay at repository level

### Workflow Changes Required

**ci.yml** - Add environment declaration:
```yaml
jobs:
  integration-tests:
    environment: Development
    # ... rest unchanged

  e2e-critical:
    environment: Development
    # ... rest unchanged

  e2e-full:
    environment: Development
    # ... rest unchanged
```

**e2e-nightly.yml** - Add environment declaration:
```yaml
jobs:
  e2e-full:
    environment: Development
    # ... rest unchanged
```

**post-deploy-smoke.yml** - Update secret references:
```yaml
# Change from:
TEST_USER_EMAIL: ${{ secrets.PROD_TEST_USER_EMAIL }}
TEST_USER_PASSWORD: ${{ secrets.PROD_TEST_USER_PASSWORD }}
TEST_USER_ID: ${{ secrets.PROD_TEST_USER_ID }}

# To:
TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
TEST_USER_ID: ${{ secrets.TEST_USER_ID }}
```

### Execution Steps

1. **Create Development environment** in GitHub (Settings → Environments)
2. **Copy secrets to Development environment**:
   - Move dev-specific secrets from repository level
   - Keep only `OPENAI_API_KEY` and `PINECONE_API_KEY` at repository level
3. **Update Production environment**:
   - Rename `PROD_TEST_USER_*` to `TEST_USER_*`
4. **Update workflow files**:
   - Add `environment: Development` to ci.yml jobs
   - Add `environment: Development` to e2e-nightly.yml
   - Update post-deploy-smoke.yml to use `TEST_USER_*`
5. **Delete repository-level secrets** (after verifying workflows work)
6. **Update documentation** in environments.md
