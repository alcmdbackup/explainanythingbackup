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

## Phase 3: Append-only enforcement gate — NOT STARTED (next)
Docker-free and verifiable. No longer blocked by Phase 2 (the 22-file retrofit was deferred), so it can proceed independently. Plan: CI job `git diff --diff-filter=M` on `supabase/migrations/*.sql` → fail, with `@migration-edit-approved` marker/label bypass; tests wired into `hook-tests`.

## Phase 5: Proactive prod-drift detection — BLOCKED ON DECISION
Awaiting the mechanism choice (CI-secret scheduled link vs `readonly_local` grant shipped as a migration).
