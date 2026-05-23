# Split Evolution/ExplainAnything Into Separate Websites — Research

## Problem Statement
Create separate websites for ExplainAnything (public) and Evolution (admin pipeline) from one codebase. The split must be safe. As part of the cutover, reset the **explainanything** production database WITHOUT touching evolution data. Evolution must be gated behind a secure login distinct from public users.

## Requirements
Same as Problem Statement. No additional bullets supplied by the user.

## High Level Summary

The two halves are tightly co-located but **loosely coupled**: only 6 main-app→evolution imports (4× `ConfirmDialog`, 2× `costAnalytics`), 5 main-app pillars consumed by evolution (`callLLM`, `llmPricing`, `modelRegistry`, `requireAdmin`, Supabase client), and 5–9 cross-boundary FKs (most use `ON DELETE SET NULL`). The 24 evolution admin routes physically live in `src/app/admin/evolution/*` rather than `evolution/`. Auth today is unified: `isUserAdmin()` checks `admin_users` against the single Supabase project.

The **recommended split mechanism** is **two Vercel projects pointed at the same git repo**, mode-selected by a build-time env var `NEXT_PUBLIC_SITE_MODE ∈ {public, evolution}`. The middleware 404s the wrong-mode routes per project. No file moves required. This satisfies all three user requirements with minimum refactor cost:
1. One repo, two live sites: same `git push`, two independent Vercel builds.
2. Independent prod DB reset: end-state is two Supabase projects (evolution gets its own); the lone cross-boundary FK `evolution_runs.explanation_id → explanations(id)` is `ON DELETE SET NULL` and can be dropped cleanly at split time.
3. Secure login distinct from public: enable **Vercel Authentication** on the evolution project — platform-level SSO gate at the edge, free on Pro plan, with `VERCEL_AUTOMATION_BYPASS_SECRET` for E2E bypass already in the codebase. Keep the existing `isUserAdmin()` Supabase check as defense-in-depth.

Two alternative split mechanisms were evaluated and rejected:
- **Option B (single project, middleware-based hostname routing)**: cheap but fails requirement #2 — one Vercel project = one Supabase env, so DB isolation is impossible. Coupled deploys; one broken evolution build also breaks the public site.
- **Option C (Next.js multi-zones / monorepo)**: would require moving 30–50 files into `apps/public/`, `apps/evolution/`, `packages/shared/`, duplicating Sentry/OTel/Jest/Playwright configs, and rewriting every `@evolution/*` / `@/*` import. Overkill: Option A already delivers per-project isolation with minimal restructure.

For the **DB reset**, the recommended flavor is **selective truncation in the shared Supabase project first** (`scripts/reset-explainanything-prod.ts`, modeled on `cleanup-test-content.ts` with `--dry-run` default and `--prod` confirmation prompt). Pre-reset prerequisites: PITR enabled, `pg_dump` backup taken, 3 FK fixes landed (create missing `evolution_experiments.evolution_explanation_id` FK, add index on `evolution_variants(evolution_explanation_id)`, audit orphaned `evolution_arena_comparisons` rows). Promote to a full Supabase-project split (Flavor B) only if Flavor A's verification step shows any evolution-row delta.

## Key Findings

### Coupling and integration

1. **24 evolution admin routes + 1 evolution API route physically live in `src/app/admin/evolution/*` and `src/app/api/evolution/run`** — i.e. inside the main src tree, not in `evolution/`. They don't need to move; mode-aware middleware can 404 them on the public project.

2. **Only 6 main-app→evolution cross-imports** outside the evolution route tree itself: 4 imports of `ConfirmDialog` (in `src/app/admin/settings/page.tsx`, `src/components/admin/CandidatesContent.tsx`, `src/components/admin/ExplanationDetailModal.tsx`, `src/components/admin/WhitelistContent.tsx`), and 2 of `costAnalytics` server actions (`src/app/admin/page.tsx`, `src/app/admin/costs/page.tsx`).

3. **Evolution depends on 5 main-app pillars**: `callLLM` (`src/lib/services/llms.ts`), `llmPricing` (`src/config/llmPricing.ts`), `modelRegistry` (`src/config/modelRegistry.ts`), `requireAdmin` (`src/lib/services/adminAuth.ts`), Supabase server client. These stay shared after the split.

4. **Reverse dependency is a single entry point**: `src/app/api/evolution/run/route.ts` calls `claimAndExecuteRun` from `@evolution/lib/pipeline/claimAndExecuteRun`.

5. **Path aliases**: `@evolution/*` → `./evolution/src/*` (in `tsconfig.json`, mirrored in `next.config.ts` turbopack config). `@/*` → `./src/*`. Both stay intact in Option A.

### Routing and auth

6. **Auth gate** is `isUserAdmin()` at `src/app/admin/layout.tsx` + `src/app/admin/evolution/layout.tsx` (re-checks per B092) + `requireAdmin()` at **30 server-action call sites** across 9 files. Same DB lookup (`admin_users.user_id = auth.uid()`) on both sides.

7. **`admin_users` table** is a binary admin/non-admin: single `role` column defaults to `'admin'`, no enum or RBAC. Migration: `20260115080637_create_admin_users.sql`.

8. **`/api/evolution/*` is intentionally included in middleware** (B087 comment in `src/middleware.ts`) so `updateSession()` fires even on long-running calls.

9. **Supabase Auth cookies are hostname-scoped** by default. `vercel.app` IS on the Public Suffix List, so cookies CANNOT be scoped to `.vercel.app`. Cross-site SSO between `explainanything.vercel.app` and an evolution `*.vercel.app` is impossible without custom domains.

### Database and FKs

10. **DB inventory**: 23 main-app tables, 13 evolution-owned tables, 3 shared (`llmCallTracking`, `llm_cost_config`, `daily_cost_rollups`). All migrations interleaved in `supabase/migrations/`.

11. **Cross-boundary FK behavior**:
    - `evolution_runs.explanation_id → explanations(id)` — **ON DELETE SET NULL** (safe).
    - `evolution_explanations.explanation_id → explanations(id)` — **no DB-level FK declared** (orphan risk).
    - `evolution_variants.explanation_id` — legacy, **no FK** (orphan risk).
    - `evolution_variants.evolution_explanation_id → evolution_explanations(id)` — ON DELETE SET NULL (internal).
    - `evolution_experiments.evolution_explanation_id → evolution_explanations(id)` — **FK was NEVER CREATED** despite migration intent (orphan risk).
    - `evolution_arena_comparisons.entry_a/b` — FKs were **intentionally dropped** in migration `20260409000001`; orphan prevention is app-layer enforced at `evolution/src/lib/core/entities/VariantEntity.ts:65`.
    - `llmCallTracking.evolution_invocation_id → evolution_agent_invocations(id)` — ON DELETE SET NULL.

12. **`llmCallTracking` is already partitioned** by `call_source` (string) and `evolution_invocation_id` (FK) — same-DB shared use is clean.

13. **`daily_cost_rollups`** has a trigger that auto-categorizes by `call_source LIKE 'evolution_%'` into `'evolution'` vs `'non_evolution'` (migration `20260228000001`).

14. **`llm_cost_config`** is a single-row config shared across both sides — post-split each Vercel project needs its own cost config.

### Infrastructure tenancy

15. **Pinecone**: explainanything-only. Evolution has zero Pinecone touchpoints. Index `explainanythingprodlarge`, `explainanythingdevlarge`. `deleteVectorsByExplanationId` exists in `src/lib/services/vectorsim.ts`.

16. **Sentry**: single project today (DSN in `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`). Recommend splitting into two Sentry projects post-split for clean tenancy.

17. **Honeycomb / OTel**: single dataset (`explainanything`), `service.name = 'explainanything'` hardcoded in `src/lib/logging/server/otelLogger.ts`. Must duplicate dataset OR add `service.name` env var to differentiate.

18. **Audit log**: single `admin_audit_log` table; entity types include `'evolution_run'`, `'llm_cost_config'` — already kind of partitioned by `entity_type`. Acceptable to share post-split.

### Hardcoded URLs and configs

19. **Only 1 production-code hardcoded URL**: `src/lib/services/sourceFetcher.ts:163` User-Agent header contains `https://explainanything.com`. All other hardcoding is in tests, configs, or docs (which can be updated incrementally).

20. **`.github/workflows/e2e-nightly.yml:23`** hardcodes `BASE_URL: https://explainanything.vercel.app` — needs duplicating for the evolution project.

21. **`vercel.json`** is `{ "crons": [] }` — empty. Trivial to extend per-project after split.

22. **Backup mirror** (`alcmdbackup/explainanythingbackup`) mirrors the whole repo at the git level — unaffected by the Vercel-project split.

23. **Minicomputer batch runner** (`evolution/scripts/processRunQueue.ts`) already reads two env files (`.env.local` for staging + `.env.evolution-prod` for prod) via `dotenv.parse()` — already dual-Supabase-aware.

### CI/CD impact summary

24. **MUST CHANGE** in CI/CD:
    - `post-deploy-smoke.yml` — add deployment-name / target_url filter so the two Vercel project deploys don't race.
    - Add a second `e2e-nightly-evolution.yml` workflow targeting evolution's hostname.
    - `ci.yml` — add a CI matrix building both `NEXT_PUBLIC_SITE_MODE=public` and `=evolution` to catch mode-specific TS errors.
    - Per-project Vercel env vars: Supabase keys, Sentry DSN, OTel endpoint, `NEXT_PUBLIC_SITE_MODE`.

25. **PROBABLY DOESN'T CHANGE**:
    - Change-detection paths in `ci.yml` (works on code paths, not Vercel projects).
    - Branch-prefix bypass rules (`hotfix/`, `fix/`, `docs/`, `chore/`).
    - Backup mirror config.
    - Supabase migrations workflow (only changes if/when Flavor B DB split happens).
    - Minicomputer systemd timers.

### Secure-login mechanism

26. **Vercel Authentication** is the recommended primary: free on Pro plan, edge-level gate, inherits MFA from team members' Vercel accounts, E2E bypass via existing `VERCEL_AUTOMATION_BYPASS_SECRET`. ~30 minutes setup.

27. **Defense-in-depth**: keep `isUserAdmin()` inside the evolution layout regardless of outer gate. Two locks, two keys.

28. **Cost**: Vercel Auth requires each admin to be a Vercel team seat (~$20/seat/mo on Pro). Scales linearly with admin count; cheap up to ~10 admins.

### DB reset specifics

29. **Pre-reset checklist**: enable Supabase Pro PITR (≥7-day retention), take `pg_dump --data-only` of all 23 explainanything tables, record evolution table row counts as baseline, land the 3 FK fixes from finding #11.

30. **Reset SQL plan** wraps a `BEGIN; ... COMMIT;` with `TRUNCATE` in dependency order ending with `DELETE FROM explanations` (DELETE not TRUNCATE so `ON DELETE SET NULL` fires on `evolution_runs.explanation_id`). Then `UPDATE evolution_explanations SET explanation_id = NULL WHERE explanation_id NOT IN (SELECT id FROM explanations);` to clean app-layer orphans.

31. **Pinecone parallel reset**: prefer namespace-level `deleteAll` over per-explanation; evolution is unaffected.

32. **`auth.users` decision**: KEEP intact during reset. Wiping users compounds risk and forces re-signup. Optional follow-up after sign-off.

33. **Migration history**: never run `supabase db reset` against prod; leave `schema_migrations` intact.

## Open Questions

1. **Domain plan**: does the user have a custom apex domain (`explainanything.com`) already provisioned, or are we staying on `*.vercel.app` for the foreseeable future? If `*.vercel.app`, cookie sharing between public and evolution is structurally impossible (PSL), and the secure-login mechanism is forced toward independent Supabase Auth + Vercel Authentication. If a custom apex is available, future SSO at `.explainanything.com` becomes feasible.

2. **Vercel Authentication seat cost**: how many admins need access? If >10, consider Flavor 3 (separate Supabase Auth project for evolution) instead.

3. **DB split timing**: do we ship Option A with shared Supabase first, then migrate to two-DB later (Flavor B)? Or do the DB split atomically with the Vercel split? Recommend phased: shared-DB first (Phases 1-4), DB split in Phase 5.

4. **`evolution_runs.explanation_id` after DB split**: drop the FK and keep the column as a soft pointer (snapshot title/content into `evolution_explanations`), or drop the column entirely? The current design already snapshots, so dropping the FK is low-risk.

5. **6 cross-imports**: refactor to remove (move `ConfirmDialog` and `costAnalytics` into `src/lib/shared/` or duplicate) before split, after split, or never? Recommend "after split", since they're harmless and the split tolerates them via shared-bundle Phase 1-4.

6. **Reset cadence**: is this a one-time reset, or expected to repeat? If repeat, Flavor B (separate Supabase project for evolution) becomes more attractive earlier.

## Documents Read
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`
- `docs/docs_overall/white_paper.md`
- `docs/docs_overall/cloud_env.md`
- `docs/docs_overall/debugging.md`
- `docs/docs_overall/design_style_guide.md`
- `docs/docs_overall/environments.md`
- `docs/docs_overall/instructions_for_updating.md`
- `docs/docs_overall/llm_provider_limits.md`
- `docs/docs_overall/managing_claude_settings.md`
- `docs/docs_overall/testing_overview.md`
- All 22 docs under `evolution/docs/**/*.md`
- All 25 docs under `docs/feature_deep_dives/`

## Code Files Read (sampled by 20 research agents)
- `src/app/admin/layout.tsx`
- `src/app/admin/evolution/layout.tsx`
- `src/middleware.ts`
- `src/lib/services/adminAuth.ts`
- `src/lib/utils/supabase/{server,client,middleware}.ts`
- `src/lib/services/llms.ts`, `src/lib/services/llmSpendingGate.ts`
- `src/lib/services/sourceFetcher.ts`
- `src/lib/services/vectorsim.ts`
- `src/lib/database.types.ts`
- `src/config/llmPricing.ts`, `src/config/modelRegistry.ts`
- `src/lib/sentrySanitization.ts`, `sentry.{server,client,edge}.config.ts`
- `src/lib/logging/server/otelLogger.ts`
- `src/__tests__/e2e/fixtures/admin-auth.ts`
- `src/__tests__/e2e/setup/vercel-bypass.ts`
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts`
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts`
- `evolution/src/services/adminAction.ts`, `evolution/src/services/costAnalytics.ts`
- `evolution/src/lib/core/entities/VariantEntity.ts`
- `evolution/scripts/processRunQueue.ts`
- `evolution/scripts/run-evolution-local.ts`
- `.github/workflows/{ci,e2e-nightly,post-deploy-smoke,supabase-migrations}.yml`
- `playwright.config.ts`, `next.config.ts`, `tsconfig.json`, `vercel.json`, `package.json`
- `supabase/migrations/20260115080637_create_admin_users.sql`
- `supabase/migrations/20260315000001_evolution_v2.sql`
- `supabase/migrations/20260322000005_*`, `20260322000006_*`, `20260409000001_*`, `20260409000002_*`
- `scripts/cleanup-test-content.ts`

## Next steps
- Move to `_planning.md` to lay out the phased execution plan based on Option A.
- Land the 3 pre-reset FK fixes as a small standalone migration PR before the larger split work begins.
- Confirm domain strategy with user (open question #1).
- Run `/plan-review` once planning doc is drafted.
