# smoke_test_and_nightly_e2e_failing_20260523 Research

## Problem Statement
I want to investigate why post-deploy smoke test and nightly E2E keep failing. Look at GH to figure out why.

## Requirements (from GH Issue #NNN)
I want to investigate why post-deploy smoke test and nightly E2E keep failing. Look at GH to figure out why.

## High Level Summary

Two independent failure clusters, both confirmed via 4 rounds / 19 investigation agents.

### Cluster 1 — Nightly E2E (100% failure rate for ~62 days)
- Every nightly run since 2026-03-23 has failed with the same shape: 37 specs in `09-admin/` crashing in `beforeEach`/`seed()` with errors of the form "column `evolution_prompts.name` does not exist" / "relation `evolution_metrics` does not exist".
- **Root cause:** Production Supabase (`qbxhivoezkfbjbsctdzo`) was frozen at the 2026-03-05 schema. 73 migrations had accumulated unapplied. The critical missing schema:
  - `evolution_metrics` table — added by `20260323000003_evolution_metrics_table.sql`
  - `evolution_prompts.name` (renamed from `title`) — `20260324000001_entity_evolution_phase0.sql`
  - `evolution_criteria` table — `20260503033102_create_evolution_criteria.sql`
- **Why migrations never deployed:** `.github/workflows/supabase-migrations.yml` only runs `deploy-production` on push to the `production` branch. The May 23 release PR #1073 triggered the workflow, but it FAILED at the first migration (`20260322000003_add_budget_check_constraint.sql`) because constraint `chk_budget_cap` already existed → `supabase db push` aborted the entire queue → none of the 56 remaining migrations (including the evolution-schema ones) landed.
- **Fix landed 2026-05-24 00:10 UTC:** PR #1074 hotfix made `20260322000003` idempotent (`IF NOT EXISTS` / drop-then-add pattern), re-ran the workflow → all 56 migrations applied successfully.
- **Tonight's nightly (2026-05-24 06:00 UTC)** is the first run after the fix and is expected to be the first green nightly in ~2 months.
- **3 secondary independent bugs that will still surface after the schema fix:**
  - `src/__tests__/e2e/specs/01-auth/auth-redirect-security.spec.ts:26-31` — hardcodes "localhost" assertion; breaks against any prod hostname. Fix: add `@skip-prod` tag.
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-autorefresh-back-nav.spec.ts:33` — `page.goForward()` races with `AutoRefresh` `pageshow` handler producing `net::ERR_ABORTED`. Fix: replace with explicit `page.goto(url)`.
  - `src/__tests__/e2e/specs/09-evolution-admin/evolution-strategy-wizard-tactics.spec.ts` — DB-state-sensitive timeout; tolerable / leave alone for now.

### Cluster 2 — Post-deploy smoke (2 failures today in same 11-min window)
Fallout from PR #1072 (the explainanything/evolution website split) which added a 2-row matrix to `post-deploy-smoke.yml`. Both rows fail for distinct reasons; the health-check step passes for both.

- **`public` row failure:** `BASE_URL = github.event.deployment_status.target_url`, which is a per-deploy preview hostname like `explainanything-3ad03ivv0-<hash>.vercel.app`. `classifyHost()` in `src/config/hostnames.ts` is strict-exact-match against `PROD_PUBLIC_HOST = 'explainanything.vercel.app'` and `PROD_EVOLUTION_HOST = 'ea-evolution.vercel.app'`, so preview hostnames classify as `unknown`. Middleware then fail-closes with 404 on everything except `/api/health`, `/api/monitoring`, `/api/traces`, `/api/client-logs`. Smoke specs that hit `/` and `/userlibrary` get 404; `<title>` returns `""`.
- **`evolution` row failure:** `BASE_URL = https://ea-evolution.vercel.app`. Middleware redirects `/` → `/admin/evolution-dashboard`, so the home-search-input the spec asserts is not present. `/userlibrary` is in `PUBLIC_PREFIXES` filter → 404 on the evolution host.
- Auth fixture and Vercel automation bypass token both confirmed healthy (not a fixture flake).

### Recommended fix posture
- Smoke: **Fix A + E2**
  - Fix A — pin smoke matrix `public` row `base_url` to `https://explainanything.vercel.app` (1-line YAML change).
  - E2 — split `src/__tests__/e2e/specs/smoke.spec.ts` into `smoke.public.spec.ts` (existing 3 tests) and `smoke.evolution.spec.ts` (admin dashboard load + health), and grep the matrix accordingly.
- Nightly: ship the 2 secondary spec fixes (`@skip-prod` tag + `goto` replacement) once tonight's run confirms the schema fix unblocked the bulk failures.
- Operational: add an idempotency lint to CI for new migrations so any single non-idempotent migration cannot block the entire queue again.

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/ (context for the matrix split)

## Code Files Read
- .github/workflows/post-deploy-smoke.yml — smoke matrix, base_url wiring, bypass token usage
- .github/workflows/e2e-nightly.yml — nightly schedule + project filter
- .github/workflows/supabase-migrations.yml — production migration trigger (push to `production` branch only)
- src/middleware.ts — fail-closed host classification + PUBLIC_PREFIXES gate
- src/config/hostnames.ts — `classifyHost`, `PROD_PUBLIC_HOST`, `PROD_EVOLUTION_HOST`, `PUBLIC_PREFIXES`
- src/__tests__/e2e/specs/smoke.spec.ts — current single-spec smoke suite (target of E2 split)
- src/__tests__/e2e/specs/01-auth/auth-redirect-security.spec.ts — localhost-hardcoded assertion (line 26-31)
- src/__tests__/e2e/specs/09-admin/admin-evolution-autorefresh-back-nav.spec.ts — page.goForward race (line 33)
- src/__tests__/e2e/specs/09-evolution-admin/evolution-strategy-wizard-tactics.spec.ts — DB-state-sensitive timeout
- supabase/migrations/20260322000003_add_budget_check_constraint.sql — the non-idempotent migration that blocked the queue
- supabase/migrations/20260323000003_evolution_metrics_table.sql — adds `evolution_metrics`
- supabase/migrations/20260324000001_entity_evolution_phase0.sql — renames `evolution_prompts.title` → `name`
- supabase/migrations/20260503033102_create_evolution_criteria.sql — adds `evolution_criteria`
