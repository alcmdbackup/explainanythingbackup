# Split Evolution / ExplainAnything Into Separate Websites — Plan

## Background
Create separate websites for ExplainAnything (public) and Evolution (admin pipeline) from one codebase. The split must be safe. As part of the cutover, reset the **explainanything** production database WITHOUT touching evolution data. Evolution must be gated behind a secure login distinct from public users.

## Requirements
- One codebase, one git repo, but **two live websites** on different hostnames.
- **Reset the explainanything production database** as part of the project — evolution data must be preserved.
- Evolution must be **gated behind a secure login** distinct from public users.
- Safety, simplicity, and incremental rollout are explicit goals.

## Problem
Today the public ExplainAnything site and the Evolution admin pipeline live in one Next.js app at one URL (`explainanything.vercel.app`). They share one Supabase project, one Sentry project, one Vercel deployment, and one admin gate (`isUserAdmin()` → `admin_users` table). We need to expose them as two distinct sites, give evolution its own login surface, and wipe explainanything's production content WITHOUT touching the 13 `evolution_*` tables or the 3 shared infra tables.

## Options Considered

- [x] **Option B (chosen): Single Vercel project, two hostnames, middleware-based hostname routing.** Cheap, fast (~half a day's work for the split itself), no env-var drift, existing CI/CD workflows minimally affected. Cookies are hostname-scoped by browser default, so admin sessions on the evolution hostname are structurally distinct from public sessions.
- [ ] **Option A: Two Vercel projects, one repo, env-var-mode-selected.** Rejected — independent rollback granularity and per-project Vercel Authentication are not needed for the current team size; double the env-var maintenance is not worth the upside.
- [ ] **Option C: Next.js multi-zones (`apps/public`, `apps/evolution`, `packages/shared`).** Rejected — multi-week refactor of working code with only 6 cross-imports to justify the restructure.

### DB-reset flavor

- [x] **Selective TRUNCATE in shared Supabase.** Single-transaction SQL block, evolution tables explicitly skipped, `evolution_runs.explanation_id` auto-nulled via existing `ON DELETE SET NULL`. One-time runbook, not a polished script. `auth.users` preserved.
- [ ] **Separate Supabase project for evolution.** Rejected for v1 — not required if reset is one-time and selective truncation is verified safe.

### Evolution gate flavor

- [x] **Tier 1: Hostname assertion in middleware + the existing admin-DB check.** Hostname-scoped cookies mean admin sessions on the evolution hostname are independent of any public-site session. Defense-in-depth via the existing `admin_users` row check.
- [ ] **Tier 2: Custom middleware password wall.** Rejected.
- [ ] **Tier 3: Separate Supabase Auth project for evolution.** Rejected for v1.

---

## Cross-cutting design decisions (apply to every phase)

These are the answers to risk surfaces raised in plan review. They constrain every code change below.

### Host-comparison semantics

- All host comparisons use **exact case-insensitive equality on the hostname portion only** (port stripped). NEVER `startsWith`.
- A `Host` header like `evolution.example.com:443` is compared after `.toLowerCase().split(':')[0]`.

### Host classification tiers

| Tier | Detection | Gate behavior |
|---|---|---|
| **Production public** | `host === PROD_PUBLIC_HOST` | block `/admin/evolution/*`, block `/api/evolution/*` |
| **Production evolution** | `host === PROD_EVOLUTION_HOST` | block public-only routes (`/`, `/results`, `/explanations`, `/sources`, `/userlibrary`, `/api/returnExplanation`, `/api/runAISuggestionsPipeline`, `/api/stream-chat`, `/api/fetchSourceMetadata`) |
| **Preview** | `process.env.VERCEL_ENV === 'preview'` | both halves reachable; rely on Vercel Deployment Protection (already in use via `VERCEL_AUTOMATION_BYPASS_SECRET`) — preview URLs are never publicly indexed |
| **Local dev** | `host` ∈ {`localhost`, `127.0.0.1`, `0.0.0.0`} (exact or with port) | both halves reachable |
| **Unknown (default)** | none of the above | **fail-closed: return 404** for everything except `/api/health`, `/api/monitoring`, `/api/traces`, `/api/client-logs`. Logs a structured warning so spoofing/misconfiguration is observable. |

### Where the hostname check lives

- **Primary**: in `src/middleware.ts`. Single source of truth, runs before any app code.
- **Defense-in-depth**: in `src/lib/services/adminAuth.ts:requireAdmin()` (NOT `isUserAdmin()` — `requireAdmin()` is the function 30 server actions actually call; `isUserAdmin()` is only the two layout-level checks). Read host via Next.js `headers()` helper. Local/preview bypass via same tiers above. Log + throw on mismatch.
- **Layout-level `isUserAdmin()`** also gains the same assertion, for consistency and defense if a future route forgets to wrap with `requireAdmin()`.

### Inventory of all `requireAdmin()` / `admin_users` consumers (must be reviewed for hostname-context compatibility)

Server actions that go through the hostname assertion via `requireAdmin()`:
- `src/lib/services/featureFlags.ts`
- `src/lib/services/userAdmin.ts`
- `src/lib/services/contentReports.ts`
- `src/lib/services/llmCostConfigActions.ts`
- `src/lib/services/auditLog.ts`
- `src/lib/services/adminContent.ts`
- `evolution/src/services/adminAction.ts` (factory that wraps every evolution server action)
- `src/app/api/evolution/run/route.ts`

Non-HTTP callers (must NOT go through hostname assertion — these run outside a request context):
- `evolution/scripts/processRunQueue.ts` — minicomputer batch runner; calls `claimAndExecuteRun()` directly, bypasses HTTP entirely. **Confirmed unaffected.**
- Any cron jobs (`vercel.json` crons: empty currently).
- Static-generation contexts where `headers()` is not callable.

The implementation of `requireAdmin()` must use `try/catch` around `headers()` and treat "not in a request context" as an explicit "skip hostname check" path (not as a failure).

### File locations (matching existing conventions)

- `src/config/hostnames.ts` (NOT `src/lib/config/hostnames.ts` — existing convention is `src/config/`, mirroring `src/config/llmPricing.ts` and `src/config/modelRegistry.ts`).
- `src/config/userAgent.ts` — separate file for the source-fetcher User-Agent constant (don't conflate identity concerns with hostname concerns).

### Sentry per-request tagging

- Module-init `setTag` does NOT work because `host` is per-request. Solution: in each of `sentry.server.config.ts`, `sentry.edge.config.ts`, register a `beforeSend(event)` hook that reads the host from `event.request?.headers?.host` and sets `event.tags = {...event.tags, site: classifyHost(host)}`. Client config uses `beforeSend` with `window.location.host` (only meaningful in browser).
- Existing `beforeSendLog` (per `sentry.client.config.ts`) is the precedent for this pattern.

### Migration filename convention

- Concrete timestamp: `supabase/migrations/20260524000001_evolution_fk_hardening.sql` (claim now; bump if collision at PR time).

---

## Phased Execution Plan

### Phase 0: Staging Dry-Run Prerequisite (gates Phase 5)

Goal: prove the Phase 5 destructive SQL on a staging clone of production before ever running it on prod.

- [ ] Trigger a Supabase PITR-restore of production into the staging project (or a temporary dedicated project) at a recent timestamp.
- [ ] Capture pre-reset row counts on the staging clone (all 23 explainanything tables, all 13 evolution tables, all 3 shared tables).
- [ ] Execute the Phase 5 SQL block + Pinecone reset against the staging clone.
- [ ] Compare post-reset row counts on staging vs the Phase 5 expectation. Any divergence blocks Phase 5 on prod until investigated.
- [ ] Time the SQL block. If >5 min, redesign for batched DELETE or scheduled maintenance window.
- [ ] File the staging dry-run report at `docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/phase5-dryrun-staging.md`.

### Phase 1: FK Hardening Migration

Goal: close three FK gaps so the eventual DB reset can't leave orphan evolution rows.

- [ ] **Pre-migration audit** — run on staging AND prod, record results:
  - [ ] `SELECT id, evolution_explanation_id FROM evolution_experiments WHERE evolution_explanation_id IS NOT NULL AND evolution_explanation_id NOT IN (SELECT id FROM evolution_explanations);` — list dangling refs.
  - [ ] `SELECT id, entry_a, entry_b FROM evolution_arena_comparisons WHERE entry_a NOT IN (SELECT id FROM evolution_variants) OR entry_b NOT IN (SELECT id FROM evolution_variants);` — list orphan arena rows.
  - [ ] `SELECT conname, conrelid::regclass FROM pg_constraint WHERE confrelid = 'explanations'::regclass;` — confirm FK ordering before destructive ops in Phase 5.

- [ ] Write migration `supabase/migrations/20260524000001_evolution_fk_hardening.sql`:
  - [ ] **NULL out orphaned `evolution_experiments.evolution_explanation_id`** values *before* adding the FK (otherwise `ADD CONSTRAINT` will fail). The migration script does this in a single transaction.
  - [ ] `ALTER TABLE evolution_experiments ADD CONSTRAINT evolution_experiments_evolution_explanation_id_fkey FOREIGN KEY (evolution_explanation_id) REFERENCES evolution_explanations(id) ON DELETE SET NULL NOT VALID;` followed by `ALTER TABLE evolution_experiments VALIDATE CONSTRAINT evolution_experiments_evolution_explanation_id_fkey;` — two-step pattern that holds the table for less time and allows non-blocking validation.
  - [ ] `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evolution_variants_evolution_explanation_id ON evolution_variants(evolution_explanation_id);` — concurrent index build, no exclusive lock.
  - [ ] Comment block explaining why `evolution_arena_comparisons.entry_a/b` has no DB FK (intentional; app-layer in `evolution/src/lib/core/entities/VariantEntity.ts:65`).

- [ ] Write `evolution/scripts/audit-arena-comparison-orphans.ts`:
  - [ ] `--dry-run` (default): prints orphan rows, no mutation.
  - [ ] `--apply`: requires typed confirmation `DELETE ORPHAN ARENA COMPARISONS` before any DELETE.
  - [ ] Unit test covers the dry-run path and confirmation-required path.

- [ ] **Post-migration verification** — runs in CI AND as a manual prod check:
  - [ ] `SELECT conname FROM pg_constraint WHERE conname = 'evolution_experiments_evolution_explanation_id_fkey';` — must return one row.
  - [ ] `SELECT indexname FROM pg_indexes WHERE indexname = 'idx_evolution_variants_evolution_explanation_id';` — must return one row.
  - [ ] Integration test `src/__tests__/integration/fk-hardening.integration.test.ts` (see Testing section) runs against staging post-deploy.

- [ ] Rollback: standard migration revert (`DROP CONSTRAINT`, `DROP INDEX`). Documented inline in the migration as a comment.

### Phase 2: Middleware-Based Hostname Split (the code change)

Goal: same Vercel deployment serves both hostnames; middleware refuses cross-hostname access.

- [ ] Decide the evolution hostname. Default proposal: `evolution-explainanything.vercel.app` (if staying on `*.vercel.app`) or `evolution.explainanything.com` (if a custom apex exists). Capture the chosen value in `docs/docs_overall/environments.md`.

- [ ] Add `src/config/hostnames.ts`:
  ```ts
  // Production hostnames — exact match (case-insensitive, port stripped)
  export const PROD_PUBLIC_HOST = 'explainanything.vercel.app';   // or chosen apex
  export const PROD_EVOLUTION_HOST = 'evolution-explainanything.vercel.app';
  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

  export type HostTier = 'public' | 'evolution' | 'preview' | 'local' | 'unknown';

  export function classifyHost(rawHost: string | null | undefined): HostTier {
    const host = (rawHost ?? '').toLowerCase().split(':')[0];
    if (!host) return 'unknown';
    if (LOCAL_HOSTS.has(host)) return 'local';
    if (process.env.VERCEL_ENV === 'preview') return 'preview';
    if (host === PROD_PUBLIC_HOST) return 'public';
    if (host === PROD_EVOLUTION_HOST) return 'evolution';
    return 'unknown';
  }
  ```

- [ ] Add `src/config/userAgent.ts` exporting `SOURCE_FETCHER_USER_AGENT` (extracts the hardcoded string from `src/lib/services/sourceFetcher.ts:163`). Keep this separate from `hostnames.ts` — different concern.

- [ ] Update `src/middleware.ts`:
  ```ts
  import { classifyHost } from '@/config/hostnames';

  const EVOLUTION_PREFIXES = ['/admin/evolution', '/api/evolution'];
  const PUBLIC_PREFIXES = ['/results', '/explanations', '/sources', '/userlibrary',
    '/api/returnExplanation', '/api/runAISuggestionsPipeline', '/api/stream-chat',
    '/api/fetchSourceMetadata'];
  const ALWAYS_ALLOWED = ['/api/health', '/api/monitoring', '/api/traces', '/api/client-logs'];

  export async function middleware(request: NextRequest) {
    const tier = classifyHost(request.headers.get('host'));
    const path = request.nextUrl.pathname;

    if (ALWAYS_ALLOWED.some((p) => path.startsWith(p))) return await updateSession(request);

    if (tier === 'unknown') {
      console.warn('[middleware] unknown host rejected', { host: request.headers.get('host'), path });
      return new NextResponse(null, { status: 404 });
    }
    if (tier === 'public') {
      if (EVOLUTION_PREFIXES.some((p) => path.startsWith(p))) return new NextResponse(null, { status: 404 });
    }
    if (tier === 'evolution') {
      if (path === '/') return NextResponse.redirect(new URL('/admin/evolution-dashboard', request.url));
      if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return new NextResponse(null, { status: 404 });
    }
    // 'local' and 'preview' fall through with no host-based gate
    return await updateSession(request);
  }
  ```

- [ ] Update `src/lib/services/adminAuth.ts`:
  - [ ] Add an internal `assertEvolutionHost()` helper that reads `host` from `headers()`, classifies via `classifyHost`, throws if tier is `'public'` or `'unknown'`, no-ops if `'evolution'`, `'preview'`, or `'local'`. Wraps the `headers()` call in try/catch — outside a request context it's a no-op (preserves non-HTTP callers).
  - [ ] Call `assertEvolutionHost()` at the top of `requireAdmin()` and at the top of `isUserAdmin()` (defense in depth).

- [ ] **Audit and update existing `requireAdmin()` consumers** for context compatibility (each file listed in cross-cutting decisions above) — no functional change expected; just verify each call site is reached only from a request context. Documented in `phase2-requireAdmin-audit.md`.

- [ ] Update Sentry per-request tagging in `sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts`:
  ```ts
  // inside Sentry.init({ ... }) for each
  beforeSend(event) {
    const host = event.request?.headers?.host;
    if (host) event.tags = { ...event.tags, site: classifyHost(host) };
    return event;
  }
  ```
  Client config reads `window.location.host` instead. Tag must be set *per event*, not at module init.

- [ ] Update `src/lib/services/sourceFetcher.ts:163` — import `SOURCE_FETCHER_USER_AGENT` from `@/config/userAgent`, replace hardcoded string.

### Phase 3: Secondary Domain Setup on Existing Vercel Project

Goal: the second hostname actually resolves to the deployment.

- [ ] In Vercel Dashboard → existing project → Settings → Domains, add the evolution hostname.
- [ ] DNS: if `evolution.<apex>`, add `CNAME` to `cname.vercel-dns.com`. If `*.vercel.app`, Vercel auto-provisions.
- [ ] Verify TLS cert provisions cleanly.
- [ ] Smoke (use GET, not HEAD — Next.js routes don't always implement HEAD): `curl -sS -o /dev/null -w '%{http_code}\n' https://<evolution-host>/admin/evolution-dashboard` returns 200 or 307. `curl -sS -o /dev/null -w '%{http_code}\n' https://<evolution-host>/results` returns 404. `curl -sS -o /dev/null -w '%{http_code}\n' https://<public-host>/admin/evolution/runs` returns 404.
- [ ] Rollback: remove the domain from Vercel (DNS-level the public host keeps serving everything; existing admin links via the public host still work because that path didn't change yet). Mid-Phase-2 rollback: revert the middleware PR.

### Phase 4: Boundary Verification

Goal: prove both halves work in production with real data, before any destructive operation.

- [ ] Manual sanity sweep on each hostname (archive as `phase4-verification-log.md`):
  - Public host: `/`, `/results?...`, `/explanations`, `/sources/<id>`, `/userlibrary`, `/login`, `/settings`.
  - Public host returns 404 for `/admin/evolution/*` and `/api/evolution/*`.
  - Evolution host: `/admin/evolution-dashboard`, `/admin/evolution/runs`, `/admin/evolution/experiments`, `/admin/evolution/arena`, `/admin/evolution/strategies`.
  - Evolution host returns 404 for `/`, `/results`, `/api/returnExplanation`, etc.
  - Cookies: log in to one host, verify the other host shows logged-out state (use two browser contexts to be definitive).
- [ ] Run `@critical` E2E suite against the public host (`BASE_URL=https://<public-host>`).
- [ ] Run `@evolution` E2E suite against the evolution host (`BASE_URL=https://<evolution-host>`). **Note**: several existing specs in `src/__tests__/e2e/specs/09-admin/admin-evolution-*.spec.ts` and `src/__tests__/e2e/specs/09-evolution-admin/*.spec.ts` hit `/api/evolution/run` and other evolution routes via `BASE_URL`. These must be run with the evolution host. List of affected specs documented in `phase4-e2e-rewiring.md` (build from `grep -lr "/api/evolution" src/__tests__/e2e/specs/`).
- [ ] Monitor Sentry for 24-48h with `site:evolution` and `site:public` tag filters; confirm error rates look normal on both sides.
- [ ] **Bake for at least 3 days before Phase 5.**

### Phase 5: Production DB Reset (ExplainAnything Only)

**Prerequisite: Phase 0 dry-run must be complete and verified.**

Goal: wipe explainanything user content; preserve every evolution row.

- [ ] **Pre-reset prerequisites:**
  - [ ] Verify Supabase Pro PITR is enabled on prod (Database → Backups → "Point-in-time recovery"). If not, enable temporarily.
  - [ ] **Pause Vercel auto-deploys** for the reset window: Vercel → Settings → Git → toggle "Production deployments" off. Re-enable after Phase 5 + Phase 6 ship.
  - [ ] Record evolution baseline row counts to a file: `SELECT 'evolution_runs', count(*) FROM evolution_runs UNION ALL SELECT 'evolution_variants', count(*) FROM evolution_variants UNION ALL SELECT 'evolution_explanations', count(*) FROM evolution_explanations UNION ALL SELECT 'evolution_experiments', count(*) FROM evolution_experiments;`. Archive in `phase5-baseline.md`.
  - [ ] Take `pg_dump --data-only` backup of all 23 explainanything tables:
    - [ ] Path: `~/.backups/ea-reset-$(date +%Y%m%d-%H%M%S).sql.dump` (NOT inside the repo).
    - [ ] `chmod 600` immediately after creation.
    - [ ] Verify `*.sql.dump` is in `.gitignore` (add if missing).
    - [ ] DB credential read from `.env.prod.readonly` (already chmod 600 by convention) — never inline, never logged.
    - [ ] Retention: keep for 30 days post-cutover, then `shred -u` + delete from any cloud backup.
  - [ ] **Pinecone pre-reset inventory:**
    - [ ] Confirm `PINECONE_INDEX_NAME_ALL=explainanythingprodlarge`.
    - [ ] Run `npx tsx scripts/pinecone-describe-prod.ts` (a one-off script using `@pinecone-database/pinecone` v6.x, version-pinned in `package.json`). Prints per-namespace vector counts.
    - [ ] Identify explainanything namespace(s). Evolution uses zero — confirm.
    - [ ] Record baseline counts to `phase5-pinecone-baseline.md`.
    - [ ] **Note: Pinecone has no PITR.** Rollback path is re-embed from `pg_dump` restore (slow, costs OpenAI embeddings).
  - [ ] **FK pre-flight audit on prod**: `SELECT conname, conrelid::regclass, confrelid::regclass FROM pg_constraint WHERE confrelid = 'explanations'::regclass OR conrelid = 'explanations'::regclass;` — confirm only the FKs documented in research exist. Any unexpected FK blocks the reset until investigated.
  - [ ] **Verify no concurrent writes**: brief maintenance announcement to internal users; confirm the minicomputer batch runner isn't running an evolution job that might touch shared tables (it shouldn't write to explainanything tables, but `llmCallTracking` is shared); `SELECT pid, query FROM pg_stat_activity WHERE state = 'active' AND query NOT ILIKE '%pg_stat_activity%';` to spot live writers.
  - [ ] Record production deploy SHA.

- [ ] **Reset SQL** (execute in Supabase Dashboard → SQL Editor for built-in audit logging):
  ```sql
  BEGIN;
  SET LOCAL statement_timeout = '10min';   -- if dry-run showed real time <2min; tightened from earlier 30min
  SET LOCAL lock_timeout = '30s';          -- fail fast on contention, do NOT block indefinitely

  TRUNCATE TABLE "userExplanationEvents" RESTART IDENTITY;
  TRUNCATE TABLE "userQueries" RESTART IDENTITY;
  TRUNCATE TABLE "userLibrary" RESTART IDENTITY;
  TRUNCATE TABLE "explanationMetrics" RESTART IDENTITY;
  TRUNCATE TABLE content_reports RESTART IDENTITY;
  TRUNCATE TABLE candidate_occurrences RESTART IDENTITY;
  TRUNCATE TABLE link_candidates RESTART IDENTITY;
  TRUNCATE TABLE article_link_overrides RESTART IDENTITY;
  TRUNCATE TABLE article_heading_links RESTART IDENTITY;
  TRUNCATE TABLE article_sources RESTART IDENTITY;
  TRUNCATE TABLE link_whitelist_snapshot RESTART IDENTITY;
  TRUNCATE TABLE link_whitelist_aliases RESTART IDENTITY;
  TRUNCATE TABLE link_whitelist RESTART IDENTITY;
  TRUNCATE TABLE source_cache RESTART IDENTITY;
  TRUNCATE TABLE explanation_tags RESTART IDENTITY;

  -- DELETE not TRUNCATE so ON DELETE SET NULL fires on evolution_runs.explanation_id.
  -- explanations.id is a NOT NULL PK so the NOT IN (empty) below is safe.
  DELETE FROM explanations;

  TRUNCATE TABLE topics RESTART IDENTITY;

  -- After DELETE FROM explanations, the subquery returns empty. NOT IN (empty) is TRUE
  -- for all non-null values, so this nulls every dangling explanation_id in evolution_explanations.
  -- Intentional: evolution rows preserved; the link to wiped public explanations is severed.
  UPDATE evolution_explanations
     SET explanation_id = NULL
   WHERE explanation_id IS NOT NULL;

  -- Pre-COMMIT sanity: assert zero rows in the just-truncated tables AND no blockers.
  -- (Performed by the operator; if anything looks wrong, ROLLBACK.)

  COMMIT;
  ```
  **NOT touched**: every `evolution_*` table, `llmCallTracking`, `llm_cost_config`, `daily_cost_rollups`, `auth.users`, `auth.identities`, `auth.sessions`, `auth.refresh_tokens`, `admin_users`, `supabase_migrations.schema_migrations`.

- [ ] **Pinecone reset (executed in parallel with the SQL reset):**
  - [ ] Ship `scripts/reset-explainanything-pinecone.ts` with these safety semantics:
    - `--dry-run` default; prints intended deletions; no mutation.
    - `--prod` required for execution AND interactive typed confirmation of the index name (mirror `cleanup-test-content.ts`).
    - Refuses to run unless `process.env.NODE_ENV === 'production'` or `--force` is passed.
    - Prints namespace list, requires per-namespace `y/n` confirmation.
    - Reads `PINECONE_API_KEY` from local env file only; never logs the key; never accepts it as a CLI arg.
  - [ ] Implementation (deleteAll is async + eventually consistent; poll):
    ```ts
    import { Pinecone } from '@pinecone-database/pinecone';   // v6.x pinned in package.json
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const index = pc.index(process.env.PINECONE_INDEX_NAME_ALL!);
    for (const ns of explainAnythingNamespaces) {
      await index.namespace(ns).deleteAll();
      // Poll for completion (deleteAll is eventually consistent)
      for (let i = 0; i < 30; i++) {
        const stats = await index.describeIndexStats();
        const remaining = stats.namespaces?.[ns]?.vectorCount ?? 0;
        if (remaining === 0) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    ```
  - [ ] On rate-limit / 5xx, retry with exponential backoff (3 attempts).
  - [ ] Re-running the script after partial completion is safe (idempotent: `deleteAll` on an already-empty namespace is a no-op).
  - [ ] Verify completion: re-run `pinecone describe-index-stats` and confirm explainanything namespaces show vector count = 0.

- [ ] **Post-reset verification:**
  - [ ] Row count on every explainanything table = 0.
  - [ ] Row count on every evolution table matches pre-reset baseline (compare to `phase5-baseline.md`).
  - [ ] Pinecone explainanything namespaces show vector count = 0.
  - [ ] Spot-check: `/admin/evolution-dashboard` renders.
  - [ ] Spot-check: 10 random `evolution_runs` load via `/admin/evolution/runs/<id>`.
  - [ ] Smoke: create one new explanation via the public site. Confirm DB row in `explanations`, Pinecone vector upserted, tags written.

- [ ] **Rollback procedure** if verification fails:
  1. If still in the transaction → `ROLLBACK;`.
  2. Already committed → Supabase Dashboard → Database → PITR → restore to pre-reset timestamp. Evolution restored too (acceptable since it hadn't been mutated between reset and rollback).
  3. As a last resort → `psql $PROD_DB < ~/.backups/ea-reset-<timestamp>.sql.dump`.
  4. Pinecone rollback: re-embed from restored `explanations` rows via existing `processContentToStoreEmbedding` pipeline. Cost: OpenAI embedding calls for N restored articles.
  5. Re-enable Vercel auto-deploys.

### Phase 6: Cleanup, CI/CD, Documentation

- [ ] **Update `.github/workflows/post-deploy-smoke.yml`** to fire smoke against BOTH hostnames on a single Vercel deployment. Current workflow triggers on `deployment_status` and uses `target_url` (single URL). Change: after the deploy fires the smoke, run `@smoke` tests once with `BASE_URL=<target_url>` AND once with `BASE_URL=<evolution-host>` (matrix entry). Without this, evolution-host regressions are never smoke-tested.
- [ ] **Update `.github/workflows/e2e-nightly.yml`** — currently hardcodes `BASE_URL: https://explainanything.vercel.app`. Add a parallel job targeting the evolution host (matrix entry: `BASE_URL` ∈ {public, evolution}, plus grep filter `@critical` vs `@evolution` respectively).
- [ ] Update `docs/docs_overall/environments.md`: document the two hostnames, that they share one Vercel project, one Supabase project, one Sentry project (with `site` tag).
- [ ] Update `docs/docs_overall/debugging.md` to mention the `site` Sentry tag for triage.
- [ ] Update `docs/feature_deep_dives/authentication_rls.md` — note hostname assertion in `requireAdmin()` and `isUserAdmin()`.
- [ ] Update `docs/feature_deep_dives/admin_panel.md` — evolution lives on its own hostname.
- [ ] Update `evolution/docs/reference.md` — production evolution URL.
- [ ] Archive `phase5-baseline.md`, `phase5-pinecone-baseline.md`, `phase5-dryrun-staging.md`, `phase4-verification-log.md`, `phase4-e2e-rewiring.md` under the planning folder for audit.
- [ ] Re-enable Vercel auto-deploys (if paused).

---

## Testing

### Unit Tests

- [ ] **`src/middleware.test.ts`** (new file — middleware unit tests don't exist today; add via the same PR as the middleware change):
  - Public host blocks `/admin/evolution/*` and `/api/evolution/*` with 404.
  - Evolution host blocks `/results`, `/explanations`, `/sources/<id>`, `/userlibrary`, `/api/returnExplanation`, etc. with 404.
  - Evolution host redirects `/` to `/admin/evolution-dashboard`.
  - Localhost (with and without port) bypasses both blocks.
  - `127.0.0.1`, `0.0.0.0` bypass both blocks.
  - Preview env (`VERCEL_ENV=preview`) bypasses both blocks regardless of host.
  - Unknown host returns 404 (fail-closed), except `/api/health`, `/api/monitoring`, `/api/traces`, `/api/client-logs` which always pass.
  - Suffix-extension attacks: `evolution.example.com.attacker.com` does NOT match `evolution.example.com`.
  - Mocks `request.headers.get('host')` directly on a synthetic `NextRequest`. No `next/headers` mock needed for middleware (it uses Request.headers).

- [ ] **`src/lib/services/adminAuth.test.ts`** updates:
  - `requireAdmin()` returns false / throws when called with public host.
  - `requireAdmin()` succeeds for evolution host with a valid admin user.
  - `requireAdmin()` no-ops (does not throw) when `headers()` is unavailable (non-request context).
  - Mock pattern: `jest.mock('next/headers', () => ({ headers: jest.fn() }))`, then `(headers as jest.Mock).mockResolvedValue(new Headers({ host: 'evolution-explainanything.vercel.app' }))` per test.

- [ ] **`src/lib/services/sourceFetcher.test.ts`** updates:
  - Assert the User-Agent header (from a mocked `fetch` call) contains the expected hostname identity string. Test the behavior, not the source of the constant.

- [ ] **`src/config/hostnames.test.ts`** (new):
  - `classifyHost` returns correct tier for each tier.
  - Case-insensitivity: `HOST` and `host` produce the same result.
  - Port-stripping: `host:443` and `host` produce the same result.
  - Empty / null / undefined → `'unknown'`.

- [ ] **`evolution/scripts/audit-arena-comparison-orphans.test.ts`** (new):
  - Dry-run mode prints orphans without mutation.
  - Apply mode requires typed confirmation.

### Integration Tests

- [ ] **`src/__tests__/integration/fk-hardening.integration.test.ts`** (new):
  - Verify `evolution_experiments.evolution_explanation_id` FK exists in staging post-migration (`pg_constraint` lookup).
  - Verify `idx_evolution_variants_evolution_explanation_id` exists post-migration.
  - Insert a test `evolution_explanations` row, an `evolution_experiments` referencing it, then DELETE the `evolution_explanations` row → assert `evolution_experiments.evolution_explanation_id IS NULL`.

- [ ] **`src/__tests__/integration/explanation-delete-evolution-preservation.integration.test.ts`** (new):
  - Create test explanation + `evolution_run` referencing it.
  - DELETE the explanation.
  - Assert `evolution_run` row still exists with `explanation_id = NULL`.

- [ ] **`scripts/reset-explainanything-pinecone.integration.test.ts`** (new):
  - Against a test namespace, upsert N vectors, run the script with `--prod --force --skip-confirm` (test-only flag), assert namespace count = 0 within timeout.
  - Dry-run does not delete.

### E2E Tests

- [ ] **`src/__tests__/e2e/specs/00-host-isolation/host-isolation.spec.ts`** (new, `@critical`):
  - Public host hits to `/admin/evolution/runs` return 404.
  - Evolution host hits to `/results` return 404.
  - Cookie isolation: use two distinct `browser.newContext()` instances. Sign in on public-context, navigate to evolution URL from public-context, assert logged-out state (or redirect to login). Then sign in evolution-context independently, verify dashboard renders.
  - Prefix `00-` to run before existing 01-* specs.
- [ ] CI strategy for `host-isolation.spec.ts`: this spec needs two real hostnames. Options:
  - **Preferred**: tag it `@smoke` (runs in `post-deploy-smoke.yml` against real prod URLs) AND `@critical` (runs in `ci.yml`).
  - In `ci.yml`, override `playwright.config.ts` to bind both hostnames to localhost via Playwright's `extraHTTPHeaders: { Host: ... }` per-test, OR via a `/etc/hosts`-style mock in CI's Playwright launcher.
- [ ] Run existing `@critical` E2E suite against the public host (no change to that suite).
- [ ] Run existing `@evolution` E2E suite against the evolution host. Specific specs needing `BASE_URL=https://<evolution-host>` (enumerated by `grep -lr "/api/evolution" src/__tests__/e2e/specs/`):
  - `09-admin/admin-evolution-*.spec.ts` (~12 files per `docs/feature_deep_dives/testing_setup.md`)
  - `09-evolution-admin/*.spec.ts`
  - Document the full list in `phase4-e2e-rewiring.md`.

### Manual Verification

- [ ] Phase 4 runbook sweep on production.
- [ ] Phase 5 pre-reset / reset / post-reset checklist on production.

## Verification

### A) Playwright Verification

- [ ] `host-isolation.spec.ts` passes in `post-deploy-smoke.yml` against both real hostnames.
- [ ] `@critical` suite passes against public host in `ci.yml`.
- [ ] `@evolution` suite passes against evolution host in `ci.yml` (matrix entry).

### B) Automated Tests

- [ ] `npm run lint && npm run typecheck && npm run build`
- [ ] `npm test` (unit)
- [ ] `npm run test:esm` (mandated by CLAUDE.md / finalize skill)
- [ ] `npm run test:integration:critical`
- [ ] `npm run test:e2e:critical`
- [ ] Post-Phase-1 migration check: `npx supabase db diff --linked` against staging shows no drift; new constraint and index visible in `\d` output.

## Documentation Updates
- [ ] `docs/docs_overall/environments.md` — two-hostname architecture, `site` Sentry tag, evolution login flow, BASE_URL conventions per E2E run.
- [ ] `docs/docs_overall/debugging.md` — debugging via `site` Sentry tag.
- [ ] `docs/feature_deep_dives/authentication_rls.md` — hostname assertion in `requireAdmin()` + `isUserAdmin()`.
- [ ] `docs/feature_deep_dives/admin_panel.md` — evolution lives on its own hostname.
- [ ] `evolution/docs/reference.md` — production evolution URL.
- [ ] Archive Phase 4 + Phase 5 logs (`phase4-verification-log.md`, `phase4-e2e-rewiring.md`, `phase5-baseline.md`, `phase5-pinecone-baseline.md`, `phase5-dryrun-staging.md`, `reset-runbook.md`).
- [ ] `CLAUDE.md` — only if it references the production URL.
- [ ] `.gitignore` — confirm `*.sql.dump` is ignored (add if missing).

## Review & Discussion

Multi-agent `/plan-review` loop reached consensus after 2 iterations.

### Iteration 1 (initial review)

| Perspective | Score | Critical Gaps |
|---|---|---|
| Security & Technical | 2/5 | 10 |
| Architecture & Integration | 2/5 | 5 |
| Testing & CI/CD | 3/5 | 6 |

All 21 critical gaps were addressed in the rewrite. Key themes fixed:
- Hostname-classification moved from `startsWith` (suffix-extendable) to exact case-insensitive equality with port stripping; explicit fail-closed default for unknown hosts; explicit `VERCEL_ENV === 'preview'` tier.
- Hostname assertion relocated from `isUserAdmin()` (2 callers) to `requireAdmin()` (30 callers) AND `isUserAdmin()` for layered defense.
- Module path corrected to `src/config/hostnames.ts` (matching existing convention).
- Phase 0 added: mandatory staging dry-run of the destructive SQL before any production execution.
- Phase 1 FK migration uses `NOT VALID` + `VALIDATE CONSTRAINT` + `CREATE INDEX CONCURRENTLY`, with pre-migration orphan audit + cleanup so the constraint addition can't fail on existing data.
- `pg_dump` and Pinecone-script safety semantics fully specified (path, permissions, retention, credential handling, version pinning, confirmation flow, polling for eventual consistency).
- Reset SQL gained `lock_timeout=30s` for fail-fast contention, plus Vercel auto-deploy pause and `pg_stat_activity` pre-check.
- Sentry tagging moved from module-init `setTag` to per-event `beforeSend` (because host is per-request).
- CI strategy for `host-isolation.spec.ts` made explicit: `@smoke` for real-hostname coverage in post-deploy-smoke, `@critical` with `extraHTTPHeaders` for ci.yml.
- `post-deploy-smoke.yml` and `e2e-nightly.yml` matrix entries documented for dual-hostname coverage.
- Inventory of all `requireAdmin()` consumers added, with explicit handling for non-HTTP callers via try/catch around `headers()`.

### Iteration 2 (post-revision)

| Perspective | Score | Critical Gaps |
|---|---|---|
| Security & Technical | 5/5 | 0 |
| Architecture & Integration | 5/5 | 0 |
| Testing & CI/CD | 5/5 | 0 |

**Consensus reached.** Plan is ready for execution.

### Remaining minor issues (not blocking; addressable during PR review)

These were noted across the three reviewers as polish-level. None block execution.

- Honeycomb / OTel spans not tagged with `site` attribute (Sentry per-event tagging is done; tracing data remains comingled). Follow-up: mirror the Sentry tag onto OTel spans via `otelLogger`, `browserTracing`, `fetchWithTracing`.
- Phase 1 post-migration FK/index verification on prod is manual; consider adding a `pg_constraint`/`pg_indexes` assertion step to `post-deploy-smoke.yml` for automated coverage.
- `host-isolation.spec.ts` CI strategy currently lists two possible approaches (`extraHTTPHeaders` vs `/etc/hosts` mock); pick one before PR and confirm it actually triggers middleware against a `next start` server.
- Cookie-isolation E2E uses two browser contexts (which tests browser behavior); add a direct API call with a copied cookie to prove server-side enforcement too.
- `e2e-nightly.yml` evolution-host matrix entry needs a separate auth `storageState` per host (admin cookies are hostname-scoped); document in `auth.setup.ts`.
- `playwright.config.ts` should be confirmed to read `process.env.BASE_URL` so matrix-set values actually re-target the run.
- Phase 5 SQL block could include an inline comment annotating TRUNCATE order against the FK graph (operator-readable dependency chain).
- `ALWAYS_ALLOWED` paths (`/api/traces`, `/api/client-logs`) bypass host classification entirely; verify these endpoints don't write attacker-controlled data to a logging sink.
- `PROD_PUBLIC_HOST` and `PROD_EVOLUTION_HOST` are placeholders until the hostname decision in Phase 2 is finalized.
- Explicit ordering note: Phase 1 must be deployed and verified in prod before Phase 0 (staging dry-run) is representative.
- `scripts/reset-explainanything-pinecone.integration.test.ts` requires Pinecone credentials in CI — specify whether it runs in `test:integration:critical` or is opt-in/local-only.

These items should be addressed during the PR review of each phase, not in a third planning iteration.

