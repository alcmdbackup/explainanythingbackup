# Split Evolution/ExplainAnything Into Separate Websites — Progress

**PR:** https://github.com/Minddojo/explainanything/pull/1072
**Branch:** `feat/split_evolution_explainanythig_into_separate_websites_20260522`
**Current state:** PR open, CI green (run 26337774716), ready to merge.

---

## Phase 1: FK Hardening Migration

### Work Done

- ✅ `supabase/migrations/20260524000001_evolution_variants_fk_index.sql` — `CREATE INDEX CONCURRENTLY` on `evolution_variants(evolution_explanation_id)` so the `ON DELETE SET NULL` cascade isn't a full-table scan. Uses `-- supabase:disable-transaction` directive.
- ✅ `supabase/migrations/20260524000002_enforce_evolution_runs_explanation_fk_set_null.sql` — drop & re-add the FK on `evolution_runs.explanation_id` with explicit `ON DELETE SET NULL`. Nulls orphan FK pointers first (one-time backfill — the data the SET NULL trigger would have produced if the FK had ever been enforced).
- ✅ `evolution/scripts/audit-arena-comparison-orphans.ts` — dry-run/apply with typed confirmation. Unit test covers both paths.
- ✅ Added `.order('id')` to both pagination loops in the audit script for deterministic results.

### Work Dropped (Research Misread, Corrected Iteration 2)

- ❌ Original `supabase/migrations/20260524000001_evolution_fk_hardening.sql` — deleted. Research Round 1 misread migration `20260322000006`'s comment "evolution_experiments.evolution_explanation_id is missing" as "the FK is missing"; the COLUMN itself was never added, no app code references it, no orphan risk. The 2nd target (`evolution_arena_comparisons.entry_a/b`) intentionally has no DB FK (dropped in `20260409000001`, app-layer enforced in `VariantEntity.ts:65`).
- ❌ `src/__tests__/integration/fk-hardening.integration.test.ts` — deleted alongside the migration above.

### Issues Encountered

- **Iteration 1 (lint):** `flakiness/require-serial-with-beforeall` errors in `host-isolation.spec.ts` — 4 describes with `beforeAll`, no serial mode. Fixed by adding `test.describe.configure({ mode: 'serial' })` to all 4 describes. Missed locally because `npm run lint | tail -10` truncated the relevant errors.
- **Iteration 2 (deploy-migrations):** `column "evolution_explanation_id" does not exist` on `evolution_experiments`. Fixed by dropping the bogus FK migration.
- **Iteration 3 (integration tests):** `explanation-delete-evolution-preservation.integration.test.ts` failed at `expect(refreshed).toMatchObject({ explanation_id: null })`. **Root cause discovery:** `20260409000002_restore_evolution_runs_explanation_id.sql` used `ADD COLUMN IF NOT EXISTS ... REFERENCES ... ON DELETE SET NULL`. In PostgreSQL, if the column already exists, `IF NOT EXISTS` silently skips the ENTIRE clause — including REFERENCES. Test DB exhibited this drift; staging/prod presumed same. Fix: new migration `20260524000002`.
- **Iteration 4 (destructive-DDL guard):** unanchored case-insensitive grep `(TRUNCATE)` matched the word "truncated" in a migration comment. Reworded comment.
- **Iteration 5 (FK validation):** the new migration's re-`ADD CONSTRAINT` hit orphan rows on staging — confirming the FK had never been enforced. Updated migration to null orphans first, then add FK.
- **Iteration 6:** ✅ All green.

### User Clarifications

- Reset mechanism: Option B (single Vercel project, two hostnames, middleware-based routing) — total DB isolation not required.
- Hostname: Path 2 (Vercel-managed), `ea-evolution.vercel.app`.
- DB reset: selective TRUNCATE in shared Supabase, one-time runbook, keep `auth.users`, split first then reset, will verify PITR before reset day.
- Secure login: Tier 1 — hostname assertion in middleware + existing `isUserAdmin()` check.
- Pinecone reset: added to plan.

---

## Phase 2: Middleware-Based Hostname Split

### Work Done

- ✅ `src/config/hostnames.ts` — `PROD_PUBLIC_HOST`, `PROD_EVOLUTION_HOST`, `classifyHost()` with 5-tier classification (public/evolution/preview/local/unknown). Exact-match equality, case-insensitive, port-stripped. Exports `PUBLIC_PREFIXES`, `EVOLUTION_PREFIXES`, `ALWAYS_ALLOWED_PREFIXES`.
- ✅ `src/config/userAgent.ts` — extracted `SOURCE_FETCHER_USER_AGENT` constant.
- ✅ `src/middleware.ts` — public host 404s on `/admin/evolution/*` and `/api/evolution/*`; evolution host 307s `/` → `/admin/evolution-dashboard` and 404s on `PUBLIC_PREFIXES`; unknown host fail-closed 404 (except `ALWAYS_ALLOWED_PREFIXES`); local/preview bypass.
- ✅ `src/lib/services/adminAuth.ts` — `isHostAcceptableForAdmin()` helper using `headers()` from `next/headers`. Called from BOTH `requireAdmin()` and `isUserAdmin()` (defense in depth). Try/catch around `headers()` to no-op outside request context (preserves minicomputer batch runner).
- ✅ `sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts` — per-event `beforeSend(event)` tagging with `site: classifyHost(host)`. Defensive array coercion on `event.request?.headers?.host`. Client config reads `window.location.host`.
- ✅ `src/lib/services/sourceFetcher.ts` — imports `SOURCE_FETCHER_USER_AGENT` from `@/config/userAgent`.

### Work Pending

- ⏳ `requireAdmin()` consumer audit — verify each call site is reached only from a request context. Document in `phase2-requireAdmin-audit.md`. Non-blocking — no functional change expected.

### Tests

- ✅ `src/middleware.test.ts` — public/evolution/local/preview/unknown all tiers covered; suffix-extension attacks covered; `/api/health|monitoring|traces|client-logs` bypass.
- ✅ `src/lib/services/adminAuth.test.ts` — host assertion + non-request-context no-op.
- ✅ `src/config/hostnames.test.ts` — case-insensitivity, port-stripping, empty/null/undefined.
- ✅ `src/__tests__/e2e/specs/00-host-isolation/host-isolation.spec.ts` — 18 tests, Playwright APIRequestContext with spoofed `host` header.
- ⏳ `src/lib/services/sourceFetcher.test.ts` updates — assert User-Agent header behavior. Non-blocking.

---

## Phase 3: Secondary Domain Setup (Vercel)

### Work Done (user)

- ✅ `ea-evolution.vercel.app` domain added in Vercel Dashboard.
- ✅ DNS auto-provisioned (subdomain of `*.vercel.app`).
- ✅ TLS cert provisioned cleanly.
- ✅ Smoke confirmed: `evo health: 200`, `public health: 200`.

### Work Pending

- ⏳ Curl smoke matrix — `evolution-host /admin/evolution-dashboard` → 200/307; `evolution-host /results` → 404; `public-host /admin/evolution/runs` → 404. Defer to Phase 4.

---

## Phase 3.5: `/mainToProd` (PENDING — user-triggered)

### Work Pending

- ⏳ Merge PR #1072 to `main`.
- ⏳ Run `/mainToProd` (user-triggered, cannot be done by Claude). Promotes `main` → `production`. Applies migrations `20260524000001` (CONCURRENTLY index) and `20260524000002` (FK re-add + orphan-null backfill).
- ⏳ Watch for: orphan-null UPDATE row count on `evolution_runs` (archive in `phase3.5-fk-orphan-cleanup.md`); migration timing (FK rebuild holds brief `ACCESS EXCLUSIVE` lock); Vercel deploy completion on both hostnames.
- ⏳ Capture prod deploy SHA — must equal `origin/main` HEAD before Phase 4 begins.

### Note

The two migrations in this PR are now confirmed safe via staging (CI green). Iteration 5 surfaced real orphan rows on staging — the same is plausible on prod.

---

## Phase 0: Staging Dry-Run Prerequisite (PENDING — gates Phase 5)

### Decisions Recorded

- ✅ Re-use existing staging project (not a temporary dedicated project).
- ✅ Latest PITR timestamp.
- ✅ Phase 3.5 happens first (so the PITR snapshot has the new FK migration baked in; otherwise we re-apply after restore).
- ✅ Sweep confirmed wiping staging's public data won't break other PRs' CI — integration/E2E tests use `[TEST]`-prefix data with self-cleanup; smoke tests don't depend on existing rows; health check tags (IDs 2, 5) survive (not in truncate list).

### Work Pending

- ⏳ PITR-restore prod into staging at latest timestamp.
- ⏳ Capture pre-reset row counts (23 explainanything + 13 evolution + 3 shared tables).
- ⏳ Execute Phase 5 SQL block + Pinecone reset against the staging clone.
- ⏳ Diff post-reset counts vs Phase 5 expectations. Any divergence blocks prod reset.
- ⏳ Time the SQL block; if > 5 min, redesign for batched DELETE.
- ⏳ File report at `docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/phase5-dryrun-staging.md`.

---

## Phase 4: Boundary Verification (PENDING — bake 3 days before Phase 5)

### Work Pending

- ⏳ Manual sweep on each hostname; archive in `phase4-verification-log.md`.
- ⏳ Cookie isolation: log in to one host, verify other shows logged-out (two browser contexts).
- ⏳ `@critical` E2E against public host.
- ⏳ `@evolution` E2E against evolution host. Note: specs in `09-admin/admin-evolution-*.spec.ts` and `09-evolution-admin/*.spec.ts` hitting `/api/evolution/run` must use evolution host. Build affected-spec list with `grep -lr "/api/evolution" src/__tests__/e2e/specs/`. Document in `phase4-e2e-rewiring.md`.
- ⏳ Sentry monitor 24-48h with `site:evolution` vs `site:public` tag filters.
- ⏳ Bake at least 3 days.

---

## Phase 5: Production DB Reset (PENDING — destructive, gates on Phase 0+4)

### Work Done

- ✅ `scripts/reset-explainanything-pinecone.ts` — `--dry-run` default, `--apply` + typed confirm `RESET EXPLAINANYTHING PINECONE`, refuses unless `NODE_ENV === 'production'` or `--force`, polls `describeIndexStats` for eventual consistency, exponential-backoff retry on rate-limit/5xx, idempotent.

### Work Pending

- ⏳ Verify Supabase Pro PITR enabled.
- ⏳ Pause Vercel auto-deploys for the reset window.
- ⏳ Record evolution baseline row counts → `phase5-baseline.md`.
- ⏳ `pg_dump --data-only` backup of 23 explainanything tables → `~/.backups/ea-reset-$(date +%Y%m%d-%H%M%S).sql.dump`. Chmod 600. 30-day retention.
- ⏳ Pinecone pre-reset inventory → `phase5-pinecone-baseline.md`.
- ⏳ FK pre-flight audit on prod.
- ⏳ Verify no concurrent writes (minicomputer batch runner, `llmCallTracking` writers).
- ⏳ Record production deploy SHA.
- ⏳ Execute Phase 5 reset SQL in Supabase Dashboard SQL Editor.
- ⏳ Execute Pinecone reset script in parallel.
- ⏳ Post-reset verification: row counts, Pinecone counts, spot-checks, fresh-explanation smoke.
- ⏳ Re-enable Vercel auto-deploys.

---

## Phase 6: Cleanup, CI/CD, Documentation

### Work Done

- ✅ `.github/workflows/post-deploy-smoke.yml` — matrix.site fires smoke against BOTH hostnames.
- ✅ `.github/workflows/e2e-nightly.yml` — matrix entry for public and evolution `BASE_URL` with `@critical` vs `@evolution` grep filters.
- ✅ `docs/docs_overall/environments.md` — two hostnames, one Vercel project, one Supabase project, one Sentry project (with `site` tag).
- ✅ `docs/docs_overall/debugging.md` — `site` Sentry tag for triage.
- ✅ `docs/feature_deep_dives/authentication_rls.md` — hostname assertion in `requireAdmin()` and `isUserAdmin()`.
- ✅ `docs/feature_deep_dives/admin_panel.md` — evolution lives on its own hostname.
- ✅ `evolution/docs/reference.md` — production evolution URL.

### Work Pending

- ⏳ Archive Phase 0/4/5 report files under the planning folder.
- ⏳ Re-enable Vercel auto-deploys if paused (done as part of Phase 5).

---

## Outstanding Open Questions

None blocking PR merge.

For Phase 4: who runs the manual sweep — user, Claude (via Playwright on accessible URLs), or both?
For Phase 4: Sentry tag-filter check — automated via Sentry API one-liner or eyeball the dashboard?
For Phase 5: target maintenance window (low-traffic period) for the destructive ops.
