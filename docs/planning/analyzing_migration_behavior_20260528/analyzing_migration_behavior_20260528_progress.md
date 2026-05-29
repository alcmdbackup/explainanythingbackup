# Analyzing Migration Behavior Progress

## Environment note
**Docker is unavailable on this machine** (`docker info` fails; no `docker` binary). This blocks local execution of Phase 2's authoritative gate (`npm run migration:verify` apply-twice) and any local run of the 22-file retrofit verification. Phases 1, 3, 4 are Docker-free; Phase 2 needs Docker (or CI-only verification — see Phase 2 below).

## Phase 1: Flip idempotency lint to blocking — DONE
### Work Done
- `.github/workflows/supabase-migrations.yml`: removed `continue-on-error: true` from the `lint-migrations-idempotent` "Run lint" step, so a non-idempotent newly-added migration now fails the required check. Updated the rollout comment (lines ~44–48) and step comment (lines ~65–69) from "warn-only / flip on 2026-05-31" to "BLOCKING".
- Kept the `migration-lint-bypass` label escape hatch intact.
### Verification
- Step structure confirmed intact via Read (name → comments → `run:`); the only other `continue-on-error` in the file (generate-types gen step) was untouched.
- Safe per plan: lint scans only newly-added files (`--diff-filter=A`); 0 in-flight migration PRs.
- (YAML programmatic parse was blocked by local Bash permissions; verified structurally by reading.)
### Issues Encountered
- None.

## Phase 2: Idempotent migrations + apply-twice verify — BLOCKED (migrations not self-contained)
Docker was installed (socket chmod 666'd for access). Running the harness surfaced TWO findings the no-Docker research could not:

### Finding 1 (fixed): harness lacked Supabase bootstrap
The bare `postgres:15-alpine` shadow DB has no Supabase roles/auth schema, so the real migration set never fresh-applied (this is why CI only ran synthetic fixtures and "real-94 apply-twice" was an open gap). Added to `scripts/verify-migrations-local.sh` (UNCOMMITTED, in working tree):
- An **apply-twice idempotency loop** (re-applies all migrations to the populated DB; fails on non-idempotent DDL).
- A **Supabase bootstrap step** seeding the 4 referenced roles (anon/authenticated/service_role/readonly_local) + the `auth` schema, `auth.users`, `auth.uid()`, `auth.role()` (the only Supabase surface the migrations touch).

### Finding 2 (BLOCKER): the migration set is NOT self-contained — and the gap is LARGE
With bootstrap in place, fresh-apply still fails at `20260131000004_content_history.sql` (`relation "content_evolution_runs" does not exist`). A full static gap scan (FK-referenced / altered tables vs tables any migration CREATEs) shows this is not isolated cruft:
- The V2 clean-slate migration **`20260315000001_evolution_v2.sql` is NOT in the repo** (only `20260322000006_evolution_fresh_schema.sql` + `...007_prod_convergence.sql` remain). It was deleted in the V2 wipe — it's what created the core evolution tables.
- Across all 94 migrations, only **4** evolution tables are ever created: `evolution_cost_calibration`, `evolution_criteria`, `evolution_metrics`, `evolution_tactics`.
- **Never created but referenced/altered by ~60 migrations:** `evolution_runs`, `evolution_variants`, `evolution_prompts`, `evolution_strategies`, `evolution_experiments`, `evolution_agent_invocations`, `evolution_explanations`, `evolution_arena_comparisons`, `evolution_logs` — i.e. the entire core evolution schema — plus `content_evolution_runs`.

**Conclusion:** the repo's migrations cannot rebuild a database from scratch. The foundational schema-creating migrations were deleted (V2 wipe); the remaining set assumes a large pre-existing schema. This is a migration-history-integrity problem (broken DR / new-environment provisioning), far beyond the low-risk idempotency retrofit Phase 2 assumed — and it's the headline finding of the investigation. It also explains why CI only ran synthetic fixtures and why "real-94 apply-twice" was an open gap (it literally cannot pass).

### Consequence
The plan's "apply-twice against all 94" gate is **not achievable** until the set is made fresh-appliable. The static idempotency retrofit of the 22 files also can't be harness-verified, because fresh-apply aborts before reaching most of them. PAUSED for a user decision (see options below). Harness improvements left UNCOMMITTED (committing would leave `migration:verify` red and block migration PRs via /finalize Step 5.5).

### Options (pending user decision)
1. **Make the set self-contained** (add the missing object creations, starting with `content_evolution_runs`, after a full fresh-apply-gap scan). Tractable IF the gap is just the legacy `content_*` cruft; merges into Option-D/prod-convergence if larger.
2. **Baseline-from-staging verification**: shadow DB starts from a `supabase db dump` of staging (link allowed), then NEW migrations apply on top — matches real incremental application, sidesteps non-self-containment.
3. **Scope Phase 2 down**: keep the harness improvements, do the static 22-file idempotency retrofit (lint-verified, not harness-verified), and reclassify "fresh-appliable + apply-twice-against-94" as a newly-discovered follow-up rather than a gate now.

## Re-scope decision (after Finding 2)
User chose to **ship the safe, verifiable wins and spin out the baseline fix**. The 22-file static idempotency retrofit is **deferred** to the spun-out follow-up (`FOLLOWUP_self_contained_migration_baseline.md`) because it can't be harness-verified until the set is self-contained, conflicts with the new append-only gate, and largely no-ops on existing environments. The harness apply-twice + bootstrap groundwork was reverted from `verify-migrations-local.sh` and preserved in the follow-up doc.

## Phase 4: Retire auto-rename + ordering check — DONE
### Work Done
- Added `scripts/check-migration-order.sh` (+ `npm run check:migrations`): blocking timestamp-order + duplicate-version check; `--base` arg; two-dot diff vs base tip (CI-shallow-safe). Replaces the auto-rename behavior with a manual `git mv` instruction.
- Added `scripts/test-check-migration-order.sh` (+ `npm run test:check-migration-order`): temp-git-repo fixture; **3/3 pass** (in-order→0, out-of-order→1, duplicate→1). Wired into the `hook-tests` CI job in `ci.yml`.
- Added a blocking `check-migration-order` job to `supabase-migrations.yml` (PR, both bases, `git fetch` base then run the script).
- **Deleted `.github/workflows/migration-reorder.yml`** (the auto-rename workflow that resurrected files + fed the orphan-repair loop).
- Fixed stale comments referencing the retired workflow: `.githooks/pre-commit:112`, `supabase-migrations.yml` repair-step comment, `ci.yml` repair-step comment.
### Verification
- `npm run check:migrations` → exit 0 on this branch ("No newly-added migrations vs origin/main — order OK").
- `npm run test:check-migration-order` → 3 passed, 0 failed.
### Remaining (ops, out-of-band from code)
- Mark `check-migration-order` a REQUIRED status check in branch protection (main + production).

## Phase 3: Append-only enforcement gate — DONE
### Work Done
- Added `scripts/check-migration-append-only.sh` (+ `npm run check:migrations-append-only`): two-dot `git diff --diff-filter=M` on `supabase/migrations/*.sql` vs base → fail. Per-file `@migration-edit-approved` marker bypass; renames (git mv) are not flagged (not modifications), so they don't conflict with Phase 4 reorders.
- Added `scripts/test-check-migration-append-only.sh` (+ npm) — temp-git fixture, **4/4 pass** (no-edit→0, in-place edit→1, marker→0, rename→0). Wired into `hook-tests` in `ci.yml`.
- Added a blocking `check-migration-append-only` job to `supabase-migrations.yml` (PR, both bases) with a `migration-edit-approved` PR-label bypass.
### Verification
- `npm run test:check-migration-append-only` → 4 passed, 0 failed.
- `npm run check:migrations-append-only` → exit 0 on this branch.
### Remaining (ops)
- Mark `check-migration-append-only` a REQUIRED status check in branch protection (main + production).

## Summary of this execution
Shipped (committed): **Phase 1** (lint blocking), **Phase 4** (retire auto-rename + ordering check), **Phase 3** (append-only gate). **Phase 2** concluded as an investigation → headline finding (migrations not self-contained) → spun out to `FOLLOWUP_self_contained_migration_baseline.md` (incl. the apply-twice + Supabase-bootstrap harness groundwork and the deferred 22-file retrofit). **Phase 5** (prod-drift detection) remains blocked on the mechanism decision. Two ops follow-ups: mark the three new gates (idempotency lint, ordering check, append-only) REQUIRED in branch protection.

## Phase 5: Proactive prod-drift detection — PARTIAL (grant + post-deploy gate done; scheduled check deferred)
Chose Option (b): the `readonly_local` SELECT grant. Live findings + work:
- **Grant works (verified live):** user applied the grant on prod; `npm run query:prod` now reads `supabase_migrations.schema_migrations` (was `permission denied`). Reconciliation: prod has **90 applied vs 94 local** — the 4 "missing" are the recent `20260527*` paragraph migrations (unreleased, normal), and **zero prod-applied versions lack a local file** (no ledger orphans). The ledger check catches the 62-day "prod falls behind" class; the non-self-containment is schema-level drift (baseline follow-up), invisible to ledger reconciliation since the deleted migrations' ledger rows were reverted away.
- **Grant captured as a migration:** `supabase/migrations/20260529000001_grant_readonly_local_schema_migrations.sql` (guarded/idempotent) — makes the manually-applied prod grant tracked + reproducible, and grants staging on the main-merge deploy.
- **Post-deploy drift gate:** both deploy jobs' "Verify migration status" step now runs a post-push `db push --dry-run` and fails loud if any migration is still pending (conservative grep so a healthy deploy isn't false-blocked). Runs post-push = signal, not rollback. **Untested in CI** (only runs on a real push to main/production) — note for first release.
### Deferred
- The **daily scheduled drift check** (between-deploy detection — the real 62-day-root-cause guard) needs the prod read-only connection as a CI secret. Left for a follow-up decision.
