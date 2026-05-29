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
- [x] **Option C3 — Harden the deploy `repair` steps**: DEFERRED (decision recorded) — touches the live deploy path + prod ledger (medium-high risk); revisit after A/B land.
- [x] **Option D — Prod convergence + squash/baseline**: DEFERRED (decision recorded) — mutates the prod schema, needs CI-secret prod link, depends on the deferred #773 convergence. Separate, owner-assigned project.

### Critical sequencing constraints (from research + plan-review)
1. **Lint flip is safe now** — it only scans newly-added files (`--diff-filter=A`), so the 22 legacy violators won't trip it and there are 0 in-flight migration PRs. The in-repo comment schedules the flip for 2026-05-31; flipping a few days early is fine.
2. **Guard the 22 files BEFORE enabling apply-twice** — re-applying the current stack fails on the *first* file (`20251109053825_fix_drift.sql`, error 42P07). So Phase 2's retrofit and the run-twice switch ship together, retrofit-first.
3. **Append-only gate (Phase 3) must come AFTER the Phase 2 retrofit** — the retrofit *edits* shipped migration files in place, which is exactly what the append-only gate blocks. Doing it after avoids needing the bypass marker for our own cleanup.
4. **Do NOT remove the deploy `repair` steps when retiring the reorder workflow** (Phase 4) — keep them until the existing duplicate/orphan backlog drains (that is C3, deferred).
5. **`apply-twice` is the AUTHORITATIVE completion gate for Phase 2, NOT "lint green".** The idempotency lint has confirmed blind spots — it returns **0 findings for the ~30 bare `ADD CONSTRAINT` statements in `fix_drift.sql`** because its regex only matches unquoted constraint/table identifiers and misses the `ADD CONSTRAINT … USING INDEX` form (these use `"public"."explanationMetrics"` / `"explanationMetrics_pkey"`). So the lint can go green while a re-apply still aborts. The retrofit is "done" only when `migration:verify` (apply-twice) is green across all 94 — lint-green is necessary but not sufficient.
6. **`ADD CONSTRAINT` is a first-class guard target** (not just the 8 patterns the lint checks). The Phase 2 retrofit MUST guard every bare `ADD CONSTRAINT` (incl. the ~30 in `fix_drift.sql`) or apply-twice cannot reach green.

## Phased Execution Plan

### Phase 1: Flip idempotency lint to blocking (Option A1) — DONE
- [x] Confirm no in-flight PR newly-adds a migration: `git diff --diff-filter=A origin/main...HEAD -- 'supabase/migrations/*.sql'` is empty; the 4 open PRs are docs/chore/init/refactor.
- [x] In `.github/workflows/supabase-migrations.yml` (the `lint-migrations-idempotent` step) removed `continue-on-error: true` so the step blocks on error. Kept the `migration-lint-bypass` PR label escape hatch; updated rollout + step comments to "BLOCKING".
- [x] Verify the gate end-to-end. Confirmed structurally + the grant migration (`20260529000001`) passed the now-blocking lint locally (`✓ idempotency-safe`). Full CI confirmation lands on the first migration-touching PR.

### Phase 2: Make existing migrations idempotent + apply-twice verification (Option B) — SPUN OUT (not executed in this PR)
Discovered during execution that the migration set is **not self-contained** (the core evolution schema + `content_evolution_runs` are created by no migration — the V2 clean-slate file was deleted), so apply-twice-against-94 cannot pass and the 22-file retrofit can't be harness-verified until that is fixed. Full plan + the validated apply-twice/Supabase-bootstrap harness groundwork preserved in **`FOLLOWUP_self_contained_migration_baseline.md`**. Carried there:
- DEFERRED: apply-twice loop in `verify-migrations-local.sh` (+ infra-vs-migration failure distinction) and the non-idempotent test fixture.
- DEFERRED: retrofit guards into the 22 lint-failing files + the ~30 quoted/`USING INDEX` `ADD CONSTRAINT`s in `fix_drift.sql` (per-construct strategy documented in the follow-up); apply-twice is the authoritative completion gate, not lint-green.
- DEFERRED: real-94 apply-twice as a required `ci.yml migration-verify-test` step.
- DEFERRED (optional): extend the lint to flag the constructs it currently misses.

### Phase 3: Append-only enforcement (Option A2) — DONE (see _progress.md; branch-protection required-check step remains)
- [x] Add a CI job in `supabase-migrations.yml` on `pull_request` (events `opened` + `synchronize`): `git diff --name-only --diff-filter=M origin/<base>...HEAD -- 'supabase/migrations/*.sql'` non-empty → fail "migrations are append-only; create a new migration instead." Use the PR base ref (main OR production), not hardcoded `main`.
- [x] Bypass: per-file `-- @migration-edit-approved` marker AND a `migration-edit-approved` PR label (workflow checks the label, script checks the marker). Audit caveat documented (label add/remove not covered by branch protection).
- [x] Immunity to `git mv` renames confirmed via test (rename → pass). The "rename + small content edit" edge is documented as accepted (may surface as M → flagged → use the marker).
- [x] Tests: editing a shipped file fails; new file passes; rename passes; marker bypass passes — `scripts/test-check-migration-append-only.sh`, **4/4 pass, wired into `ci.yml` `hook-tests`**.
- OPS (branch protection, out-of-band): mark `check-migration-append-only` a REQUIRED status check on `main` + `production`.

### Phase 4: Retire auto-rename workflow + blocking ordering check (Option C2) — DONE (see _progress.md; branch-protection required-check step remains)
- [x] **Behavioral-change decision (intentional):** today `migration-reorder.yml` AUTO-FIXES out-of-order timestamps on PR `synchronize` (incl. after a competing PR merges and main advances). Replacing it with a blocking check converts "auto-rename-on-rebase" into "author runs `git mv` manually on rebase" (~1.4 collisions/month per research). Accept this UX shift explicitly in the plan.
- [x] Ported the timestamp-order + duplicate-version logic into `scripts/check-migration-order.sh` (chose `.sh`) + `npm run check:migrations`.
- [x] Added a blocking `check-migration-order` job to `supabase-migrations.yml` (PR, both bases, `git fetch` base + two-dot diff), absorbing the duplicate-version check.
- [x] Deleted `.github/workflows/migration-reorder.yml`.
- [x] Updated `.githooks/pre-commit:112` + the stale repair-rationale comments in `supabase-migrations.yml` and `ci.yml`.
- [x] **Keep** the deploy `repair` steps (C3 deferred) — noted in commit + comments.
- [x] Tests: out-of-order fails, in-order passes, duplicate fails — `scripts/test-check-migration-order.sh`, **3/3 pass, wired into `ci.yml` `hook-tests`**.
- OPS (branch protection, out-of-band): mark `check-migration-order` a REQUIRED status check on `main` + `production`; re-document the "Require branches up to date" rule (now forces the blocking check to re-run after a competing merge).
- DEFERRED (low-priority cleanup): remove the dead reorder-algorithm tests in `scripts/test-migration-tools.sh` (Tests 5–7) — not CI-run, so not breaking.

### Phase 5: Proactive prod-drift detection (Option C1) — PARTIAL (Option b chosen; grant migration + post-deploy drift gate DONE; daily scheduled check deferred — needs prod read-only conn as CI secret). See _progress.md.
- [x] **Decision: Option (b)** — the `readonly_local` SELECT grant (user applied it on prod; verified live `query:prod` reads the ledger; prod 90/94, 0 orphans).
- [x] Captured the grant as a tracked migration `20260529000001_grant_readonly_local_schema_migrations.sql` (guarded, SELECT-only, idempotent; grants staging on the main-merge deploy).
- [x] **Post-deploy drift gate** added to both deploy jobs: post-push `db push --dry-run` fails loud if any migration is still pending (conservative; signal not rollback). Untested in CI until the next real push.
- [x] Verified the version-set reconciliation approach live (local 14-digit versions vs remote `schema_migrations`); it catches the 62-day "prod falls behind" class.
- DEFERRED (needs prod read-only conn as a CI secret): the **daily scheduled** between-deploy drift check — the real 62-day-root-cause guard. Carries: fail-loud-on-ERROR (not just on drift), an unmuted alert channel (no `#release-alerts` yet), and a staging dry-run first.

## Testing

### Unit Tests
- [x] New `scripts/test-check-migration-order.sh` — 3/3 pass (Phase 4).
- [x] New `scripts/test-check-migration-append-only.sh` — 4/4 pass (Phase 3).
- DEFERRED (with Phase 2): `scripts/test-verify-migrations-local.sh` apply-twice/non-idempotent fixture; lint-extension test cases.

### CI Wiring (every new test must execute in CI — name the job)
- [x] Shell tests wired into the `ci.yml` `hook-tests` job: `test-check-migration-order.sh`, `test-check-migration-append-only.sh`.
- [x] New blocking jobs in `supabase-migrations.yml` (PR, both bases): `check-migration-order` (Phase 4), `check-migration-append-only` (Phase 3).
- OPS (branch protection): mark the idempotency lint, `check-migration-order`, and `check-migration-append-only` REQUIRED on `main` + `production`.
- DEFERRED (with Phase 2): real-94 apply-twice as a required `ci.yml migration-verify-test` step (+ its skipped-but-required semantics + the apply-twice fixture wiring).

### Integration Tests
- DEFERRED (with Phase 2): `npm run migration:verify` (apply-twice) green across all 94 — blocked by the non-self-containment finding (see follow-up).

### E2E Tests
- [x] N/A — this project changes CI tooling + SQL guards, not app UI.

### Manual Verification
- [x] Phase 1 lint block + Phase 3 append-only + Phase 4 ordering — covered by the automated test suites above (`hook-tests`); the grant migration also passed the now-blocking lint locally.
- DEFERRED (with Phase 5 scheduled check): staging drift-detector dry-run (staging gets the grant on the main-merge deploy).

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes in this project.

### B) Automated Tests
- [x] `npm run lint:migrations` green; the `lint-migrations-idempotent` CI job is now blocking; the grant migration passes it.
- [x] New check scripts' suites pass: `test-check-migration-order` (3/3), `test-check-migration-append-only` (4/4).
- [x] `npm run check:migrations` + `npm run check:migrations-append-only` green on this branch.
- DEFERRED (with Phase 2): `npm run migration:verify` apply-twice green across 94 + the new fixture.
- DEFERRED (with Phase 5 scheduled check): detector dry-run against staging.

## Rollback (per phase)
- **Phase 1 (lint blocking):** revert `continue-on-error: false` → `true`; `migration-lint-bypass` label unblocks an individual PR.
- **Phase 2 (retrofit + apply-twice):** the apply-twice CI job is the new gate — if it proves flaky on infra, gate it behind a fast revert of the CI step; the SQL guards themselves are no-ops where already applied so they need no rollback. Each guard edit is reviewable in isolation.
- **Phase 3 (append-only gate):** `@migration-edit-approved` marker / `migration-edit-approved` label per-PR; revert the job to disable globally.
- **Phase 4 (retire reorder):** re-add `.github/workflows/migration-reorder.yml` from git history to restore auto-rename; the new ordering check is independent and can be reverted separately.
- **Phase 5 (drift detector):** read-only by construction; disable the scheduled workflow / post-deploy step. Detector errors fail loud (never silent).

## Documentation Updates
- [x] `docs/docs_overall/environments.md` — updated the lint section: now blocking (not warn-only); the new append-only + ordering gates noted; reorder workflow retired.
- [x] Stale rationale comments referencing the retired reorder workflow — fixed in `.github/workflows/supabase-migrations.yml`, `.github/workflows/ci.yml`, `.githooks/pre-commit` (Phase 4).
- DEFERRED (additive enrichment, no staleness introduced): `testing_overview.md`, `testing_setup.md`, `pr_verification_gate.md` mentions of the new gates/scripts.
- DEFERRED (low-priority): `supabase/migrations/EVOLUTION_HISTORY.md` — its "pre-2026-03-22 evolution files deleted" claim is actually CORRECT for evolution (that's the non-self-containment finding); only the version numbers are wrong (`20260322000001/000002` → `000006/000007`). Fold into the baseline follow-up.

## Review & Discussion

### Iteration 1 (Security 2/5, Architecture 3/5, Testing 3/5) — 8 critical gaps, all fixed
- **[Security]** Phase 2 guard list omitted bare `ADD CONSTRAINT` (~30 in `fix_drift.sql`, which the lint can't even detect due to quoted identifiers / `USING INDEX`) → apply-twice would still go red on file #1. **Fixed:** sequencing constraints #5/#6 + Phase 2 now name an `ADD CONSTRAINT` guard strategy and declare apply-twice (not "lint green") the authoritative completion gate.
- **[Security]** "Guard-only is behavior-neutral" was unsafe for `INSERT` (ON CONFLICT is a semantic change), `CREATE VIEW`, `ADD COLUMN`. **Fixed:** Phase 2 enumerates per-construct handling and flags ON CONFLICT as a reviewer-gated semantic change.
- **[Architecture + Testing]** Apply-twice had no real-94 CI coverage (only a synthetic self-test); plan deferred it. **Fixed:** Phase 2 + CI Wiring add a required `migration-verify-test` step running apply-twice against the real 94, gated on `has_migrations`.
- **[Architecture]** Phase 4 retired the auto-rename workflow without owning the behavior change / triggers / branch-protection role. **Fixed:** Phase 4 accepts the manual-rename-on-rebase UX, pins `opened`+`synchronize` triggers against `origin/<base>`, absorbs the duplicate-version check, and re-documents the "branches up to date" rule's new role.
- **[Testing]** New test scripts weren't wired into CI and the new gates weren't marked required. **Fixed:** a CI Wiring subsection maps every test to a named job and lists the required status checks; per-phase Rollback section added.

### Iteration 2 — ✅ CONSENSUS (Security 5/5, Architecture 5/5, Testing 5/5)
All iteration-1 critical gaps verified resolved against the real files (lint returns 0/30 `ADD CONSTRAINT` findings on `fix_drift.sql`; harness is single-pass; `migration-verify-test` runs only the synthetic self-test today). No new critical gaps. Three non-blocking refinements folded in post-consensus: pin the real-94 check to `ci.yml migration-verify-test`; handle skipped-but-required-check semantics; name a sign-off owner for Phase 5 option (a). Plan ready for execution.
