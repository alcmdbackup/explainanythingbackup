# Environments

> **For CI/CD and GitHub Actions workflows, see [testing_overview.md](testing_overview.md).**

## Website topology (post-split)

The single Vercel project serves **two hostnames** for the explainanything / evolution split (Option B of `docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/`):

| Site | Hostname | Routes served | Login |
|---|---|---|---|
| Public | `explainanything.vercel.app` (or chosen apex) | `/`, `/results`, `/explanations`, `/sources/*`, `/userlibrary`, `/settings`, `/login`, `/api/returnExplanation`, `/api/runAISuggestionsPipeline`, `/api/stream-chat`, `/api/fetchSourceMetadata` | Supabase Auth (regular user accounts) |
| Evolution | `ea-evolution.vercel.app` (placeholder — see `src/config/hostnames.ts`) | `/admin/evolution-dashboard`, `/admin/evolution/*`, `/api/evolution/*` | Supabase Auth + `admin_users` row check + hostname assertion in `requireAdmin()` |

`src/middleware.ts` reads the `Host:` header on every request and 404s the wrong-mode routes per hostname. Cookies are hostname-scoped (`.vercel.app` is on the Public Suffix List), so admin sessions on the evolution hostname are structurally independent from any public-site session.

Sentry tags every event with `site=public|evolution|preview|local|unknown` via per-event `beforeSend` so noise from one half is filterable in the shared project. Same Honeycomb dataset until per-service-name tagging is added.

The two hostnames share the same Vercel deployment, the same Supabase project, the same Sentry project, and the same Honeycomb dataset. They differ only in: hostname, routes served, and cookie jar.

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
| **Local Minicomputer** | `.env.local` | Prod | N/A | ❌ (journalctl logs) |

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
| PR with changes in `supabase/migrations/**` | Auto-deploy via CI (`deploy-migrations` job) | N/A |
| Push to `main` with changes in `supabase/migrations/**` | Auto-deploy | N/A — main does NOT deploy to prod |
| Push to `production` with changes in `supabase/migrations/**` | N/A | Auto-deploy |
| Manual dispatch | Optional skip | Requires staging success or explicit skip |

> **Important**: production migrations deploy only on push to the `production` branch (which happens when a `Release: main → production` PR is merged via `/mainToProd`). They do NOT deploy on push to `main`. A 62-day silent prod-schema drift was caused by this gating going unmonitored across 7+ releases (PR #1073 aborted the queue on a non-idempotent migration; PR #1074 hotfix fixed it). The `mainToProd` and `finalize` skills now emit a conditional **post-merge verification banner** when the PR being released touches `supabase/migrations/**` — see `.claude/commands/mainToProd.md` and `.claude/commands/finalize.md`. A migration-idempotency CI lint also catches the most common silent-failure patterns before merge.

#### Migration idempotency lint (CI requirement)

Every PR that adds files under `supabase/migrations/**` must pass `scripts/lint-migrations-idempotent.ts` (wired as the `lint-migrations-idempotent` job in `.github/workflows/supabase-migrations.yml`, with both deploy jobs declaring `needs: [lint-migrations-idempotent]`). Run it locally pre-PR via `npm run lint:migrations`.

**Patterns the lint enforces (newly-added migration files only):**

| Pattern | Required guard |
|---|---|
| `CREATE TABLE foo` | `CREATE TABLE IF NOT EXISTS foo` |
| `CREATE INDEX idx` | `CREATE INDEX IF NOT EXISTS idx` |
| `CREATE UNIQUE INDEX idx` | `CREATE UNIQUE INDEX IF NOT EXISTS idx` |
| `CREATE TYPE t AS ENUM(...)` | wrap in `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='t') THEN CREATE TYPE t ...; END IF; END $$;` |
| `CREATE FUNCTION f()` | `CREATE OR REPLACE FUNCTION f()` |
| `CREATE TRIGGER t ON foo` | preceded by `DROP TRIGGER IF EXISTS t ON foo;` in same file |
| `CREATE POLICY "p" ON foo` | preceded by `DROP POLICY IF EXISTS "p" ON foo;` in same file |
| `ALTER TABLE foo ADD COLUMN c` | `ALTER TABLE foo ADD COLUMN IF NOT EXISTS c` (Supabase runs PG 14+) |
| `ALTER TABLE foo ADD CONSTRAINT c` | preceded by `ALTER TABLE foo DROP CONSTRAINT IF EXISTS c;` in same file (PG has no native `IF NOT EXISTS` for constraints — this was the exact #1073 trip-wire) |

**Blocking (as of 2026-05-29)**: the `lint-migrations-idempotent` job is a required check — a non-idempotent newly-added migration fails the PR (`continue-on-error` removed). It scans only newly-added files, so the legacy backlog doesn't trip it. Two sibling gates were added alongside it in `supabase-migrations.yml`: **`check-migration-order`** (blocking timestamp-order + duplicate-version check — replaces the retired `migration-reorder.yml` auto-rename workflow) and **`check-migration-append-only`** (blocks in-place edits to shipped migrations; bypass via a `-- @migration-edit-approved` marker or the `migration-edit-approved` PR label). All three should be marked REQUIRED in branch protection.

**Emergency bypass**: apply the `migration-lint-bypass` PR label to skip the check during a production-down hotfix. The bypass logs a warning annotation and requires a follow-up PR to retrofit guards into the bypassed migration. Note that GitHub branch protection does not cover PR-label add/remove events — bypass is a soft control gated on social convention + CODEOWNERS review of the labeled PR; treat the audit annotation as the binding record.

#### Release-alert Slack channel

Both `e2e-nightly.yml` and `post-deploy-smoke.yml` post failure alerts to the channel configured by the repository's `SLACK_WEBHOOK_URL` secret. The channel currently receiving these is whichever channel the webhook is wired to in Slack — confirm with a repo admin and document the channel name here when a dedicated `#release-alerts` channel is established. The 62-day silent outage was largely an attention problem: alerts were firing but the channel went unread. Whoever owns the channel should keep it unmuted and configure keyword highlights on `[release-health]` issues + the workflow names above.

**Auto-filed release-health GitHub issues** (added 2026-05-30): `e2e-nightly.yml` now auto-files a `[release-health] Nightly E2E failed — YYYY-MM-DD` GitHub issue on any nightly failure via the `notify-release-health` job. Same-day recurrences comment on the existing issue rather than duplicating. This provides an inbox-style surface beyond Slack — designed for the recurring "channel unread" failure mode that produced the 5-night nightly-failure streak in May 2026. See `docs/planning/nightly_e2e_still_failing_20260530/` for the design.

**`/mainToProd` nightly-red precheck** (added 2026-05-30): the skill now queries the latest nightly run as Step 0 and fail-CLOSES (refuses to promote) when nightly conclusion is not `success`. Override via `PROMOTE_DESPITE_NIGHTLY_RED=true` + `NIGHTLY_OVERRIDE_REASON="<why>"`; the override writes `.claude/nightly-red-override.json` (schema matches `.claude/ci-gate-override.json`) committed to the deploy branch for `git log`-discoverable audit.

**CI Flow (PRs)**: When a PR contains migration files, the CI `deploy-migrations` job applies them to staging before tests run. This eliminates the migration/test deadlock where tests fail because the schema hasn't been applied yet. Types are then regenerated from the updated staging schema and auto-committed to the PR branch.

- Fork PRs and Dependabot PRs skip migration deployment (no secrets access)
- Destructive DDL (`DROP TABLE`, `RENAME COLUMN`, `TRUNCATE`, `DELETE FROM`) is blocked; `DROP FUNCTION/VIEW IF EXISTS` is allowlisted
- Concurrent migration PRs are queued via GitHub's concurrency group (`migration-staging`)

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

### Release Cadence

Production releases (`main → production` merges via `/mainToProd`) should happen at least **every 2 weeks**, even if no urgent fixes are queued. Long periods between releases let migration backlog accumulate, which compounds two risks:

1. **Larger queues are more fragile**. If any single migration in the queue is non-idempotent (e.g., bare `ADD CONSTRAINT` without `DROP IF EXISTS`), the entire deploy aborts at that file and none of the subsequent migrations land. A 5-migration queue has 5 chances to fail; a 56-migration queue has 56.
2. **Failure correlation gets harder**. When a deploy fails, fewer recent migrations means easier diagnosis. After 2.5 months frozen, the smoke_test_and_nightly_e2e_failing_20260523 investigation had to bisect across 73 migration commits to find the trip-wire.

The 2-week cadence is a *default*, not a hard rule — relax it only when there is genuinely nothing merge-ready on `main` that should ship. When a release does fire, run `/mainToProd` and pay attention to the post-merge verification banner if it surfaces (it only fires when the release includes migrations).

> **Tip:** `/safe_to_close` Phase 4-5 surface the leading indicators that the 62-day drift would have produced on day-1: un-promoted migrations (`git diff origin/production..origin/main -- 'supabase/migrations/*.sql'`), un-released-commits age vs the 17-day observed-cadence-max threshold, nightly E2E status (RED at ≥2 consecutive failing nights), and open `release-health` issues older than 12h. Running it before declaring work done catches release-process stalls before they accumulate.

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
| `.env.prod.readonly` | Read-only production access (see below) |
| `.env.prod.readonly.example` | Template for prod readonly (safe to commit) |

> **Note:** Unit tests don't use `.env` files - they use mocked values defined in `jest.setup.js`. E2E tests use `playwright.config.ts` for test configuration, but the Next.js app under test loads `.env.local`.

---

## Supabase CLI

The Supabase CLI (`npx supabase`, v2.84.4) is used for database inspection, migration management, and debugging. See [debugging.md](debugging.md#supabase-cli-debugging) for full CLI debugging reference.

### Setup

```bash
# Authenticate (one-time)
npx supabase login

# Link to staging project
npx supabase link --project-ref ifubinffdbyewoezcidz
```

> **Safety:** Linking to production (`qbxhivoezkfbjbsctdzo`) is blocked by `settings.json`. Use `npm run query:prod` for safe, read-only production access instead.

---

## Read-Only Database Access

Safe, read-only access to staging and production Supabase PostgreSQL for debugging and analytics. Both use a dedicated `readonly_local` database role with SELECT-only privileges — separate from the service role key.

### Setup

**Production:**
1. Copy the template: `cp .env.prod.readonly.example .env.prod.readonly`
2. Fill in the connection string (get password from Supabase dashboard → Database Settings)
3. Format: `postgresql://readonly_local:<password>@db.<project-ref>.supabase.co:5432/postgres`

**Staging:**
1. Copy the template: `cp .env.staging.readonly.example .env.staging.readonly`
2. Fill in the connection string (get password from Supabase dashboard → Database Settings)
3. Format: `postgresql://readonly_local:<password>@db.<project-ref>.supabase.co:5432/postgres`

### Usage

```bash
# Staging — interactive REPL
npm run query:staging

# Staging — single query
npm run query:staging -- "SELECT count(*) FROM explanations"

# Production — interactive REPL
npm run query:prod

# Production — single query
npm run query:prod -- "SELECT count(*) FROM explanations"

# JSON output (either environment, for piping to jq)
npm run query:prod -- --json "SELECT id, explanation_title FROM explanations LIMIT 5"
```

### Security

- Uses `readonly_local` PostgreSQL role with **SELECT-only** privileges (database-enforced)
- Cannot INSERT, UPDATE, DELETE, or modify schema — even if the script had a bug
- Connection strings stored in `.env.staging.readonly` / `.env.prod.readonly` (git-ignored, never committed)
- Completely separate from the service role key used by the application
- Error messages are sanitized to never leak the connection string
- `supabase db query --linked` is blocked by hook — use these scripts instead

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
- **Fail strategy:** run all tests (no early termination); each shard has 30min timeout
- **Matrix fail-fast:** disabled (shards don't cancel each other)

### Nightly Workflow (`e2e-nightly.yml`)

**Trigger:** Daily at 6 AM UTC (or manual dispatch)

**Behavior:**
- Runs on `main` branch
- Full E2E test suite (no sharding)
- **Browser matrix:** Chromium
- **No** `E2E_TEST_MODE` — nightly runs real AI against the deployed prod app (hence the `[TEST]` prefix on generated content is critical for cleanup). The separate `e2e-real-ai-smoke.yml` runs a cheap-model (`TEST_LLM_MODEL=google/gemini-2.5-flash`) `@prod-ai` real-AI smoke against a local build; per-deploy prod validation is covered by `post-deploy-smoke.yml`.
- **Fail strategy:** Continues on failure (tests all browsers)

### Post-Deploy Smoke Tests (`post-deploy-smoke.yml`)

**Trigger:** Push to the `production` branch (Vercel deploys prod on this push) + `workflow_dispatch`. The original `deployment_status` trigger is retained only as an inert secondary — GitHub anti-recursion drops the `GITHUB_TOKEN`-created Vercel deployment status, so it never fired a workflow run (this was the cause of zero post-deploy smoke coverage). The job's Health Check now polls the apex `/api/health` (~5 min) to wait for the Vercel deploy to go live before running the smoke specs.

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
| **Secrets** | Staging environment | Staging environment | Production environment |
| **Browsers** | Chromium | Chromium | Chromium |

> **Note:** CI and Nightly workflows build and run the app locally on the GitHub runner (`npm run build && npm start`). They do NOT test against any deployed environment. Only the Post-Deploy Smoke workflow tests against a live deployment.

### GitHub Secrets

Secrets are organized using GitHub Environments for clear separation:

#### Repository Secrets (Shared)

Available to all workflows - API keys that don't change between environments:

| Secret | Purpose |
|--------|---------|
| `OPENAI_API_KEY` | OpenAI API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key (evolution pipeline) |
| `ANTHROPIC_API_KEY` | Anthropic API key (Claude models) |
| `OPENROUTER_API_KEY` | OpenRouter API key (openai/gpt-oss-20b) |
| `PINECONE_API_KEY` | Pinecone API key |

#### Staging Environment Secrets

Used by `ci.yml` and `e2e-nightly.yml` with `environment: staging`:

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

## Backup Mirror Repository

Emergency backup of all code, synced automatically by `/finalize` and `/mainToProd`.

| Property | Value |
|----------|-------|
| **Repo** | [alcmdbackup/explainanythingbackup](https://github.com/alcmdbackup/explainanythingbackup) |
| **Owner** | `alcmdbackup` (separate account for isolation) |
| **Remote name** | `backup` (configured in shared `.git/config`, available across all worktrees) |
| **Auth** | Fine-grained PAT embedded in remote URL (Contents + Workflows R/W) |
| **Protection** | Branch rulesets on `*`: force-push blocked, deletion blocked |

### What Gets Synced

| Branch | When | Command |
|--------|------|---------|
| Feature branches | Every `/finalize` push (Step 7 + Step 8d retries) | `git push backup HEAD` |
| `main` | Every `/finalize` fetch (Step 3) | `git push backup origin/main:refs/heads/main` |
| Deploy branches | Every `/mainToProd` push (Step 6) | `git push backup HEAD` |
| `production` | Every `/mainToProd` push (Step 6) | `git push backup origin/production:refs/heads/production` |

All pushes are blocking — if the backup push fails, the command stops.

### Setup (for new machines / worktrees)

The `backup` remote is stored in the shared `.git/config` and persists across all worktrees. If setting up a fresh clone:

```bash
git remote add backup https://<BACKUP_PAT>@github.com/alcmdbackup/explainanythingbackup.git
```

The PAT must have **Contents (R/W)** and **Workflows (R/W)** scopes, scoped to the `explainanythingbackup` repo only.

### PAT Rotation

1. Generate new fine-grained PAT from the `alcmdbackup` account
2. Update remote URL: `git remote set-url backup https://<NEW_PAT>@github.com/alcmdbackup/explainanythingbackup.git`

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
| `DEEPSEEK_API_KEY` | DeepSeek API key (used by evolution pipeline) |
| `OPENROUTER_API_KEY` | OpenRouter API key (used for openai/gpt-oss-20b) |
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

### Demo Mode

| Variable | Description |
|----------|-------------|
| `LINKS_BYPASS_WHITELIST` | When `'true'`, `linkResolver` merges `link_candidates` rows into the whitelist so AI-suggested terms link inline without admin approval. Module-scope 5-min TTL cache. Display-path only. Default `'false'`. |
| `GUEST_EMAIL` | Shared demo guest account email (e.g., `guest@explainanything.app`). Middleware uses it for auto-login on public hostname. Missing = auto-login is a no-op. |
| `GUEST_PASSWORD` | Password for the demo guest account. Generated by `scripts/seed-guest-user.ts` (printed once on creation). Missing = auto-login is a no-op. |
| `GUEST_USER_ID` | UUID of the demo guest account. Used by `llms.ts` to apply the $10/day per-user cap. |
| `NEXT_PUBLIC_GUEST_EMAIL` | Same as `GUEST_EMAIL` but bundled into the client at build time. Read by `useIsGuest()` hook to hide sign-out button. Changing this requires a new deployment, not just an env-var update. |
| `E2E_TEST_MODE` | When `'true'`, suppresses guest auto-login in middleware so existing unauth-redirect E2E tests still pass. Set in `playwright.config.ts` webServer and in `post-deploy-smoke.yml` env block. |
| `SEED_BYPASS_USER_CAP` | When `'true'`, `LlmSpendingGate.checkPerUserCap()` returns immediately even when spend > cap. Set ONLY when running `scripts/seed-guest-library.ts` to avoid burning the day's budget pre-demo. NEVER set in any deployed env. |

### Local LLM (Ollama)

| Variable | Description |
|----------|-------------|
| `LOCAL_LLM_BASE_URL` | Ollama API base URL (default: `http://localhost:11434/v1`) |

### Testing

| Variable | Description |
|----------|-------------|
| `TEST_USER_EMAIL` | E2E test user email |
| `TEST_USER_PASSWORD` | E2E test user password |
| `TEST_USER_ID` | E2E test user UUID |
| `PINECONE_NAMESPACE` | Namespace for test isolation (`test` in CI) |
