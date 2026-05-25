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

## Phase 3.5: `/mainToProd` ✅ DONE

### Work Done

- ✅ PR #1072 merged to `main` (squash-merge SHA `59c50331`).
- ✅ `/mainToProd` PR #1073 — merged main → production. Subsequent migration deploy failed on the unrelated `20260322000003_add_budget_check_constraint.sql` (constraint already existed on prod from a non-tracked prior path); hotfix #1074 made it idempotent; backport #1075 brought the idempotency back to main.
- ✅ Migrations applied on prod (`qbxhivoezkfbjbsctdzo`) at 2026-05-24T00:10:36Z. CI Reorder Migration Timestamps workflow renamed:
  - `20260524000001_evolution_variants_fk_index.sql` → `20260524000011`
  - `20260524000002_enforce_evolution_runs_explanation_fk_set_null.sql` → `20260524000012`
- ✅ FK rebuild sub-second — no concurrent-writer blocking.
- ⚠️ Orphan-null UPDATE row count not surfaced by `supabase db push` log; cannot recover post-hoc. Migration succeeded, FK now enforces SET NULL on prod.

### Production deploy SHA

`bbca28bc` (production branch HEAD; equivalent to `c45018d7` on main + the hotfix #1074).

---

## Phase 0: Staging Dry-Run Prerequisite — COLLAPSED INTO PHASE 5

User decision (2026-05-24): prod data wasn't precious to preserve, so the
staging-rehearsal step was skipped. Instead the harness (`capture-counts.ts`,
`reset.sql`, `diff-counts.ts`) was run directly against prod with pre/post
snapshots providing equivalent verification. See Phase 5 for the actual run record.

### Pre-collapse decisions still relevant

- ✅ Sweep confirmed wiping staging's public data wouldn't break other PRs' CI — `[TEST]`-prefix self-cleaning data pattern, no hardcoded refs to existing rows.
- ⚠️ Discovery during execution: the original `capture-counts.ts` from PR #1077 was broken (used wrong project ref guard pointing at `ifubinffdbyewoezcidz` thinking it was prod, but `qbxhivoezkfbjbsctdzo` is actually prod). Fixed by rewriting to use pg + readonly DSN — see PR for the harness postmortem.

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

## Phase 5: Production DB Reset ✅ DONE (2026-05-24)

### Run record

Executed against prod project `qbxhivoezkfbjbsctdzo` via Supabase Studio SQL Editor.

**DB reset:**
- ✅ 15 tables TRUNCATEd in one combined statement (FK refs among them require single-statement)
- ✅ `evolution_explanations.explanation_id` UPDATEd to NULL on 90 rows (the FK is NO ACTION, so this had to happen before the DELETE)
- ✅ `DELETE FROM explanations` — 365 rows. `evolution_runs.explanation_id` FK fired ON DELETE SET NULL per migration `20260524000012`
- ✅ `DELETE FROM topics` — 622 rows (DELETE not TRUNCATE because `explanations.primary_topic_id` FK schema check blocks TRUNCATE even when explanations is empty)
- ✅ Single transaction, sub-second; no concurrent-writer blocking
- ✅ All 14 evolution tables preserved exactly (counts pre == post — see verification below)

**Pinecone reset:**
- ✅ `scripts/reset-explainanything-pinecone.ts` — typed-confirmation, dry-run by default, exp-backoff retry, polls `describeIndexStats` for eventual consistency. Created `.env.evolution-prod` with prod `PINECONE_API_KEY` (chmod 600, gitignored) + `PINECONE_INDEX_NAME_ALL=explainanythingprodlarge`
- ✅ Dry-run showed 303 vectors in `default` namespace
- ✅ Apply: 303 → 0 vectors, status OK

### Pre/post counts (harness-verified)

`diff-counts.ts` → **PASS** on all 37 assertions. Headline:
- explainanything truncated tables: all 16 = 0 ✓
- explanations: 365 → 0 ✓
- topics: 622 → 0 ✓
- evolution_runs: 1 → 1 ✓
- evolution_variants: 10 → 10 ✓
- evolution_explanations: 109 → 109 ✓
- evolution_experiments: 1 → 1 ✓
- evolution_arena_comparisons: 14 → 14 ✓
- evolution_strategies: 138 → 138 ✓
- llmCallTracking, llm_cost_config, daily_cost_rollups: unchanged ✓

### What got SKIPPED from the original Phase 5 plan

Per user direction (prod data not precious to preserve):

- ❌ `pg_dump --data-only` backup — skipped (no rollback path other than PITR)
- ❌ Vercel auto-deploy pause — not paused
- ❌ Concurrent writer pre-check — skipped (low traffic, no production batch runs in flight)
- ❌ Phase 0 staging dry-run — collapsed into Phase 5 (harness against prod directly)

### Issues hit during execution (kept for future-reset reference)

1. `cannot truncate a table referenced in a foreign key constraint` — fix: combine FK-linked tables into ONE TRUNCATE statement (PG checks schema, not data)
2. `violates foreign key constraint evolution_explanations_explanation_id_fkey` — the FK is NO ACTION (not SET NULL), so `UPDATE evolution_explanations SET explanation_id = NULL` must come BEFORE the DELETE
3. TRUNCATE topics fails after DELETE explanations — FK constraint persists in schema. Use DELETE on topics.

The final reset.sql captures all three lessons inline.

### Post-reset smoke

- ✅ `https://explainanything.vercel.app/api/health` → 200 (DB reachable, tags 2 + 5 still seeded)
- ✅ `https://explainanything.vercel.app/` → 307 → `/login` (pre-existing, unrelated to reset — `src/lib/utils/supabase/middleware.ts:41-52` always redirects unauthenticated)
- ✅ `https://ea-evolution.vercel.app/admin/evolution-dashboard` → 307 → `/login` (expected unauthenticated curl behavior)

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
