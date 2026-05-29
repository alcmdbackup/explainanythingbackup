# Analyzing Migration Behavior Plan

## Background
Supabase SQL migrations (94 files) deploy via `.github/workflows/supabase-migrations.yml` — staging on push to `main`, production only on push to `production`. `supabase db push` applies the stack in order and **aborts the whole queue on the first error**. The dominant, repeated failure is **non-idempotency on re-apply** (a script that crashes the second time it runs), which caused the 62-day silent prod drift (PR #1073→#1074). Research (`*_research.md`) found three structural holes against that class — the idempotency lint is warn-only + new-files-only, the Docker verify harness applies each migration only once on a fresh DB, and there is no append-only enforcement — plus a self-inflicting `migration-reorder.yml` → `repair` loop. This project implements the low-risk prevention + cleanup work to close those holes.

## Requirements (from GH Issue — TBD)
I want to analyze how we're handling migrations. E.g. how we are testing migrations locally, how we are doing it in staging/prod. How to protect against idempotency failures e.g. by enforcing using hooks or lint. How to clean up our existing migrations. How we can better prevent migration bugs. Analyze GH history to see what migration related bugs we've had.

## Problem
The safeguards against the #1 failure class (non-idempotent re-apply) are incomplete: the idempotency lint only *warns* and only scans *newly-added* files; the local verify harness never re-runs migrations so it cannot reproduce a re-apply failure; nothing stops an author from editing an already-shipped migration in place (which silently no-ops on environments where it already ran → drift); and an auto-rename CI workflow resurrects deleted files and feeds the ledger-repair step that manufactures the exact "object exists but version unrecorded" state behind #1073. 22 of the 94 existing migrations are non-idempotent.

## Options Considered (scope decision)
- [x] **Option A — Lock the gate**: flip idempotency lint to blocking + add append-only CI gate. **INCLUDED** (Phases 1 + 3).
- [x] **Option B — Harden the verify loop**: retrofit the 22 non-idempotent files + add an apply-twice idempotency test. **INCLUDED** (Phase 2).
- [x] **Option C1 — Proactive prod-drift detection**: alarm that prod matches the migration files. **INCLUDED** (Phase 5).
- [x] **Option C2 — Retire `migration-reorder.yml`**: replace auto-rename with a blocking timestamp-order check. **INCLUDED** (Phase 4).
- [ ] **Option C3 — Harden the deploy `repair` steps**: DEFERRED — touches the live deploy path + prod ledger (medium-high risk); revisit after A/B land (idempotent scripts make the repair-induced state far less dangerous).
- [ ] **Option D — Prod convergence + squash/baseline**: DEFERRED — mutates the prod schema, needs CI-secret prod link, and depends on the deferred #773 convergence. Separate, owner-assigned project.

### Critical sequencing constraints (from research + plan-review)
1. **Lint flip is safe now** — it only scans newly-added files (`--diff-filter=A`), so the 22 legacy violators won't trip it and there are 0 in-flight migration PRs. The in-repo comment schedules the flip for 2026-05-31; flipping a few days early is fine.
2. **Guard the 22 files BEFORE enabling apply-twice** — re-applying the current stack fails on the *first* file (`20251109053825_fix_drift.sql`, error 42P07). So Phase 2's retrofit and the run-twice switch ship together, retrofit-first.
3. **Append-only gate (Phase 3) must come AFTER the Phase 2 retrofit** — the retrofit *edits* shipped migration files in place, which is exactly what the append-only gate blocks. Doing it after avoids needing the bypass marker for our own cleanup.
4. **Do NOT remove the deploy `repair` steps when retiring the reorder workflow** (Phase 4) — keep them until the existing duplicate/orphan backlog drains (that is C3, deferred).
5. **`apply-twice` is the AUTHORITATIVE completion gate for Phase 2, NOT "lint green".** The idempotency lint has confirmed blind spots — it returns **0 findings for the ~30 bare `ADD CONSTRAINT` statements in `fix_drift.sql`** because its regex only matches unquoted constraint/table identifiers and misses the `ADD CONSTRAINT … USING INDEX` form (these use `"public"."explanationMetrics"` / `"explanationMetrics_pkey"`). So the lint can go green while a re-apply still aborts. The retrofit is "done" only when `migration:verify` (apply-twice) is green across all 94 — lint-green is necessary but not sufficient.
6. **`ADD CONSTRAINT` is a first-class guard target** (not just the 8 patterns the lint checks). The Phase 2 retrofit MUST guard every bare `ADD CONSTRAINT` (incl. the ~30 in `fix_drift.sql`) or apply-twice cannot reach green.

## Phased Execution Plan

### Phase 1: Flip idempotency lint to blocking (Option A1)
- [ ] Confirm no in-flight PR newly-adds a migration: `gh pr list --state open` + `git diff --diff-filter=A origin/main...HEAD -- 'supabase/migrations/*.sql'` is empty.
- [ ] In `.github/workflows/supabase-migrations.yml` (the `lint-migrations-idempotent` step, ~line 68) set `continue-on-error: false` (or remove the line). Keep the `migration-lint-bypass` PR label as the escape hatch.
- [ ] Verify the job now fails a PR that adds a non-idempotent migration (use a throwaway test branch/fixture, then delete it).

### Phase 2: Make existing migrations idempotent + apply-twice verification (Option B)
- [ ] Add a second apply pass to `scripts/verify-migrations-local.sh` (after the existing loop ~lines 134–148): re-apply every migration to the same populated container and `exit 1` on any failure, with a clear "not idempotent on re-apply: <file>" message. Distinguish **infra failure** (Docker pull / port / container-start error → exit with a distinct "infra, not migration" message) from a genuine re-apply failure, so infra flake doesn't masquerade as a non-idempotent migration.
- [ ] **`apply-twice` is the authoritative gate** (see sequencing constraint #5). Do NOT treat "lint green" as retrofit-complete — the lint misses the ~30 quoted/`USING INDEX` `ADD CONSTRAINT`s in `fix_drift.sql`.
- [ ] Retrofit guards into the **22 lint-failing files PLUS every file that fails the apply-twice pass** (the lint list is a floor, not the ceiling). Per-construct guard strategy:
  - `CREATE TABLE/INDEX/SEQUENCE` → add `IF NOT EXISTS`.
  - `ADD COLUMN` → add `IF NOT EXISTS`.
  - `CREATE POLICY` / `CREATE TRIGGER` → precede with `DROP … IF EXISTS`.
  - `CREATE FUNCTION` → `CREATE OR REPLACE`; `CREATE VIEW` → `CREATE OR REPLACE VIEW` (or precede with `DROP VIEW IF EXISTS`).
  - `CREATE TYPE … AS ENUM` → wrap in `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname=…) THEN … END IF; END $$;`.
  - **`ADD CONSTRAINT`** (incl. PK/UNIQUE/CHECK/FK and `USING INDEX`, ~30 in `fix_drift.sql`) → precede each with `ALTER TABLE … DROP CONSTRAINT IF EXISTS <name>;`, or wrap in a `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=…) THEN … END IF $$;` guard.
  - **`INSERT` seed rows without `ON CONFLICT`** → add `ON CONFLICT DO NOTHING` ONLY where re-insert would duplicate. **This is a SEMANTIC change, not a pure guard** — call it out per-file in the PR description and have a reviewer confirm no downstream migration depends on the row's absence/update. If in doubt, leave the seed INSERT alone and instead make the apply-twice harness tolerate it (see below).
  - **Guard-only for everything except the flagged INSERT cases — never change a migration's effect or order.**
- [ ] Iterate `npm run migration:verify` (now apply-twice) until green across all 94. This is the definition of done for the retrofit.
- [ ] Add a non-idempotent fixture (mirror the existing `write_broken_migration` → e.g. `write_nonidempotent_migration` with a bare `ADD CONSTRAINT`) to `scripts/test-verify-migrations-local.sh`, asserting exit 1 on the second pass and a grep on the "not idempotent on re-apply" message. Wire/confirm it runs in the `migration-verify-test` CI job.
- [ ] **RESOLVE the real-94 CI coverage hole (do NOT defer):** the existing `migration-verify-test` job only runs the synthetic self-test. Add a CI step (extend `migration-verify-test`, or a new job) gated on `detect-changes.has_migrations==true` that runs `npm run migration:verify` (apply-twice) against the **real 94 files** on a Docker `postgres:15-alpine`, and mark it a **required** status check. Rationale: `/finalize` Step 5.5 is a skippable local ritual (`MIGRATION_VERIFY_SKIP=true`), so the headline safeguard must also live in CI or it isn't enforced.
- [ ] (Optional, low value) extend `lint-migrations-idempotent.ts` to also flag the constructs above that it currently misses — quoted/`USING INDEX` `ADD CONSTRAINT`, `INSERT` without `ON CONFLICT`, `CREATE SEQUENCE`, plain `CREATE VIEW` — so lint and apply-twice converge. Not required (apply-twice is the authoritative gate) but reduces surprise.

### Phase 3: Append-only enforcement (Option A2)
- [ ] Add a CI job in `supabase-migrations.yml` on `pull_request` (events `opened` + `synchronize`): `git diff --name-only --diff-filter=M origin/<base>...HEAD -- 'supabase/migrations/*.sql'` non-empty → fail "migrations are append-only; create a new migration instead." Use the PR base ref (main OR production), not hardcoded `main`.
- [ ] Bypass: a per-file `-- @migration-edit-approved` marker (must appear in the PR diff, not pre-existing) AND/OR a `migration-edit-approved` PR label (mirror `@destructive-ddl-approved` + `migration-lint-bypass`). **Note the audit caveat:** PR-label add/remove is NOT covered by GitHub branch protection — the bypass is a soft, social-convention control whose binding record is the CI annotation (same caveat already documented for `migration-lint-bypass`).
- [ ] Confirm immunity to `git mv` renames (they show as delete+add, not modify). Leave `--find-renames` at git default and add a test for the edge case "rename + small content edit" (which may surface as `R`/`M` depending on similarity threshold) so behavior is pinned.
- [ ] **Make this a REQUIRED status check** in branch protection (enforcement is the branch-protection config, which is out-of-band from the YAML — list it as an explicit ops step, not just "add the job").
- [ ] Tests: editing a shipped file fails; adding a new file passes; rename (D+A) passes; rename+edit pinned; marker/label bypass passes. **Wire the test runner into the `hook-tests` CI job list** (`ci.yml` ~lines 252–262) so it actually executes in CI.

### Phase 4: Retire auto-rename workflow + blocking ordering check (Option C2)
- [ ] **Behavioral-change decision (intentional):** today `migration-reorder.yml` AUTO-FIXES out-of-order timestamps on PR `synchronize` (incl. after a competing PR merges and main advances). Replacing it with a blocking check converts "auto-rename-on-rebase" into "author runs `git mv` manually on rebase" (~1.4 collisions/month per research). Accept this UX shift explicitly in the plan.
- [ ] Port the timestamp-order logic from `.githooks/pre-commit` (lines ~63–139) into `scripts/check-migration-order.(sh|ts)` + `npm run check:migrations`. Pick the language deliberately: a `.sh` 1:1 port needs its test wired into a shell-test CI job (`hook-tests`); a `.ts` port runs under the Jest `unit-tests` job. State which.
- [ ] Add it as a job in `supabase-migrations.yml` on `pull_request` events `opened` + `synchronize`, diffing against `origin/<base>` (so post-rebase collisions are caught, matching what the workflow did): any newly-added migration whose 14-digit timestamp ≤ the max on the base branch → fail with the exact `git mv … <NEXT_TS>_<desc>` instruction. **Also absorb the duplicate-version check** (currently in `migration-reorder.yml:89–102`).
- [ ] **Make it a REQUIRED status check** in branch protection, and **re-document the "Require branches up to date before merging" rule's new role** — it now forces the blocking check to re-run after a competing merge (previously it re-triggered the auto-rename). Confirm the check runs for BOTH `main`- and `production`-base PRs (so `/mainToProd` PRs keep ordering enforcement).
- [ ] Delete `.github/workflows/migration-reorder.yml`.
- [ ] Update `.githooks/pre-commit` message (line ~112) pointing authors to the removed auto-rename Action; and update the now-stale rationale comments that reference the retired workflow in `supabase-migrations.yml:~204` and `ci.yml:~125` (they justify the repair steps by naming the reorder workflow).
- [ ] Remove or repurpose the dead reorder-algorithm tests in `scripts/test-migration-tools.sh` (Tests 5–7) once the workflow is gone; keep the pre-commit ordering/duplicate tests (Tests 1–4).
- [ ] **Keep** the deploy `repair` steps (C3 deferred). Note: once auto-rename stops producing duplicate-suffix pairs, the `repair` Fix-2 (mark-duplicates-applied) loses its live input immediately (repo currently has 0 duplicate-suffix pairs); only Fix-1 (orphan→reverted) stays load-bearing. Simplify Fix-2 in the C3 follow-up, not here.
- [ ] Tests for the ordering check: out-of-order new file fails; in-order passes; duplicate version fails. Wire the test into its CI job (per the language choice above).

### Phase 5: Proactive prod-drift detection (Option C1) — BLOCKED ON A DECISION; do not start until resolved
- [ ] **Decision gate (key open decision):** pick the mechanism before any implementation —
  - (a) a scheduled GitHub Action (`/verifyProdRelease`) that links to prod via CI secrets (`SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD`, scoped to the `Production` environment) and runs **read-only** `supabase migration list` / `db diff` (NEVER `db push`). CI is inherently exempt from the local `block-supabase-writes.sh` PreToolUse hook (that hook only fires on Claude tool calls, not GitHub Actions) — confirm and state this. **Sign-off:** a named owner must approve broadening Production-environment secret usage to a daily cron (not just push-to-production).
  - (b) grant the `readonly_local` role **`USAGE ON SCHEMA supabase_migrations` + `SELECT ON supabase_migrations.schema_migrations`** (currently permission-denied on both DBs). Must be **SELECT-only** and **shipped as a migration** (applied via the normal CI path — NOT a manual prod-dashboard edit, which would itself create drift). Requires security sign-off; record who signs off.
- [ ] Define the assertion as **deterministic version-set reconciliation** (every local 14-digit migration version ∈ remote `schema_migrations`), NOT a schema-diff (which can flap on a live shared DB). No fixed sleeps (testing_overview Rule 2).
- [ ] **Fail-loud on ERROR, not just on detected drift:** a detector that errors silently (link timeout, etc.) reproduces the exact 62-day-blind failure it exists to prevent — an error MUST alert with the same severity as detected drift.
- [ ] Implement as a scheduled workflow (daily) + a post-`deploy-production` assertion step that fails loud + Slacks if any local version is unapplied.
- [ ] Route alerts to an explicitly-unmuted channel (no dedicated `#release-alerts` exists yet) — coordinate with a repo admin; confirm it is unmuted before relying on it.
- [ ] Dry-run against staging first (linking allowed) before pointing at prod.

## Testing

### Unit Tests
- [ ] `scripts/lint-migrations-idempotent.test.ts` — existing; add cases if Phase 2 extends the lint patterns.
- [ ] `scripts/test-verify-migrations-local.sh` — add an apply-twice / non-idempotent fixture (Phase 2).
- [ ] New `scripts/test-check-migration-order.*` — ordering-check cases (Phase 4).
- [ ] New append-only-check tests — modify/add/rename/rename+edit/bypass cases (Phase 3).

### CI Wiring (every new test must execute in CI — name the job)
- [ ] Shell-test scripts (append-only check, ordering check if `.sh`, apply-twice fixture) → add by name to the `hook-tests` job runner list in `ci.yml` (~lines 252–262). `.ts` tests run under the existing `unit-tests` Jest job.
- [ ] **Real-94 apply-twice** → extend the existing **`ci.yml` `migration-verify-test`** job (it already has the Docker `postgres:15-alpine` + `detect-changes.has_migrations` output it depends on). Pin this exact check name so branch protection can require it. Do NOT split it into `supabase-migrations.yml` (which lacks `detect-changes`).
- [ ] New CI **jobs** to add to `supabase-migrations.yml` (PR `opened`+`synchronize`, base `origin/<base>`): append-only gate (Phase 3), timestamp-order check (Phase 4). Pin job-level `types:` so they don't also fire on `reopened`.
- [ ] **Required status checks (branch protection — out-of-band from YAML):** mark the idempotency lint (now blocking), the append-only gate, the ordering check, and the real-94 apply-twice job as REQUIRED on `main` and `production`. This is the actual enforcement point — adding the job is not enough.
- [ ] **Skipped-but-required semantics:** the real-94 job is gated on `has_migrations`, but GitHub treats a *non-run* required check as **not satisfied** (blocks merge). So the job must always run and emit success/neutral when there are no migrations (e.g. an early "no migrations changed → pass" step), rather than being conditionally skipped at the job level.

### Integration Tests
- [ ] `npm run migration:verify` (now apply-twice) passes against all 94 files after the Phase 2 retrofit — this is the core integration check, and runs in CI as a required job (not only at `/finalize`).

### E2E Tests
- [ ] N/A — this project changes CI tooling + SQL guards, not app UI. (The drift detector's "real" E2E is the scheduled run against staging in Phase 5.)

### Manual Verification
- [ ] On a throwaway branch, add a deliberately non-idempotent migration → confirm Phase 1 lint blocks the PR.
- [ ] Edit a shipped migration → confirm Phase 3 append-only gate blocks it; add the bypass marker → confirm it passes.
- [ ] Add an out-of-order-timestamp migration → confirm Phase 4 check fails with a rename instruction.
- [ ] Run the Phase 5 detector against staging and confirm it reports parity (no false drift).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes in this project.

### B) Automated Tests
- [ ] `npm run migration:verify` (apply-twice) green across 94 files.
- [ ] `npm run lint:migrations` green; the CI `lint-migrations-idempotent` job is now blocking.
- [ ] New check scripts' test suites pass; `npm run test:migration-verify` passes with the new fixture.
- [ ] Phase 5 detector dry-run against staging passes (no spurious drift).

## Rollback (per phase)
- **Phase 1 (lint blocking):** revert `continue-on-error: false` → `true`; `migration-lint-bypass` label unblocks an individual PR.
- **Phase 2 (retrofit + apply-twice):** the apply-twice CI job is the new gate — if it proves flaky on infra, gate it behind a fast revert of the CI step; the SQL guards themselves are no-ops where already applied so they need no rollback. Each guard edit is reviewable in isolation.
- **Phase 3 (append-only gate):** `@migration-edit-approved` marker / `migration-edit-approved` label per-PR; revert the job to disable globally.
- **Phase 4 (retire reorder):** re-add `.github/workflows/migration-reorder.yml` from git history to restore auto-rename; the new ordering check is independent and can be reverted separately.
- **Phase 5 (drift detector):** read-only by construction; disable the scheduled workflow / post-deploy step. Detector errors fail loud (never silent).

## Documentation Updates
- [ ] `docs/docs_overall/environments.md` — lint now blocking; append-only rule + bypass; reorder workflow retired → blocking ordering check; new prod-drift detector + alert channel.
- [ ] `docs/docs_overall/testing_overview.md` — apply-twice in `migration:verify`; new append-only + ordering CI gates; keep the Check-Parity matrix (~lines 289–315) accurate.
- [ ] `docs/feature_deep_dives/testing_setup.md` — updated migration command list + new test scripts.
- [ ] `docs/feature_deep_dives/pr_verification_gate.md` — note the append-only gate alongside the existing migration-touch high-blast gate.
- [ ] Stale rationale comments that reference the retired reorder workflow — `.github/workflows/supabase-migrations.yml:~204` and `.github/workflows/ci.yml:~125` (they justify the `repair` steps by naming the workflow); `.githooks/pre-commit:~112`.
- [ ] `supabase/migrations/EVOLUTION_HISTORY.md` — correct the stale claim that pre-2026-03-22 files were deleted (they still exist); fix the mis-referenced convergence filename (`20260322000002` → `20260322000007`).

## Review & Discussion

### Iteration 1 (Security 2/5, Architecture 3/5, Testing 3/5) — 8 critical gaps, all fixed
- **[Security]** Phase 2 guard list omitted bare `ADD CONSTRAINT` (~30 in `fix_drift.sql`, which the lint can't even detect due to quoted identifiers / `USING INDEX`) → apply-twice would still go red on file #1. **Fixed:** sequencing constraints #5/#6 + Phase 2 now name an `ADD CONSTRAINT` guard strategy and declare apply-twice (not "lint green") the authoritative completion gate.
- **[Security]** "Guard-only is behavior-neutral" was unsafe for `INSERT` (ON CONFLICT is a semantic change), `CREATE VIEW`, `ADD COLUMN`. **Fixed:** Phase 2 enumerates per-construct handling and flags ON CONFLICT as a reviewer-gated semantic change.
- **[Architecture + Testing]** Apply-twice had no real-94 CI coverage (only a synthetic self-test); plan deferred it. **Fixed:** Phase 2 + CI Wiring add a required `migration-verify-test` step running apply-twice against the real 94, gated on `has_migrations`.
- **[Architecture]** Phase 4 retired the auto-rename workflow without owning the behavior change / triggers / branch-protection role. **Fixed:** Phase 4 accepts the manual-rename-on-rebase UX, pins `opened`+`synchronize` triggers against `origin/<base>`, absorbs the duplicate-version check, and re-documents the "branches up to date" rule's new role.
- **[Testing]** New test scripts weren't wired into CI and the new gates weren't marked required. **Fixed:** a CI Wiring subsection maps every test to a named job and lists the required status checks; per-phase Rollback section added.

### Iteration 2 — ✅ CONSENSUS (Security 5/5, Architecture 5/5, Testing 5/5)
All iteration-1 critical gaps verified resolved against the real files (lint returns 0/30 `ADD CONSTRAINT` findings on `fix_drift.sql`; harness is single-pass; `migration-verify-test` runs only the synthetic self-test today). No new critical gaps. Three non-blocking refinements folded in post-consensus: pin the real-94 check to `ci.yml migration-verify-test`; handle skipped-but-required-check semantics; name a sign-off owner for Phase 5 option (a). Plan ready for execution.
