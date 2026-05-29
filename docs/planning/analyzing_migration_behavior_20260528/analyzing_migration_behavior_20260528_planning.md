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

### Critical sequencing constraints (from research)
1. **Lint flip is safe now** — it only scans newly-added files (`--diff-filter=A`), so the 22 legacy violators won't trip it and there are 0 in-flight migration PRs. The in-repo comment schedules the flip for 2026-05-31; flipping a few days early is fine.
2. **Guard the 22 files BEFORE enabling apply-twice** — re-applying the current stack fails on the *first* file (`20251109053825_fix_drift.sql`, error 42P07). So Phase 2's retrofit and the run-twice switch ship together, retrofit-first.
3. **Append-only gate (Phase 3) must come AFTER the Phase 2 retrofit** — the retrofit *edits* shipped migration files in place, which is exactly what the append-only gate blocks. Doing it after avoids needing the bypass marker for our own cleanup.
4. **Do NOT remove the deploy `repair` steps when retiring the reorder workflow** (Phase 4) — keep them until the existing duplicate/orphan backlog drains (that is C3, deferred).

## Phased Execution Plan

### Phase 1: Flip idempotency lint to blocking (Option A1)
- [ ] Confirm no in-flight PR newly-adds a migration: `gh pr list --state open` + `git diff --diff-filter=A origin/main...HEAD -- 'supabase/migrations/*.sql'` is empty.
- [ ] In `.github/workflows/supabase-migrations.yml` (the `lint-migrations-idempotent` step, ~line 68) set `continue-on-error: false` (or remove the line). Keep the `migration-lint-bypass` PR label as the escape hatch.
- [ ] Verify the job now fails a PR that adds a non-idempotent migration (use a throwaway test branch/fixture, then delete it).

### Phase 2: Make existing migrations idempotent + apply-twice verification (Option B)
- [ ] Add a second apply pass to `scripts/verify-migrations-local.sh` (after the existing loop ~lines 134–148): re-apply every migration to the same populated container and `exit 1` on any failure, with a clear "not idempotent on re-apply: <file>" message.
- [ ] Retrofit guards into the **22 failing files** (authoritative list in `*_research.md`) — `IF NOT EXISTS` (table/index/column/sequence), `DROP … IF EXISTS` before `CREATE POLICY`, `OR REPLACE` for functions, `DO $$ … pg_type` guard for the one `CREATE TYPE`. **Guard-only — never change a migration's effect or order.** Heaviest: `20251109053825_fix_drift.sql` (18 bare indexes).
- [ ] Iterate `npm run migration:verify` (now apply-twice) until green across all 94.
- [ ] Add a non-idempotent fixture to `scripts/test-verify-migrations-local.sh` that fails on the second pass (proves the new logic), and confirm the `migration-verify-test` CI job exercises it. Decide whether to add a CI step that runs apply-twice against the real 94 (vs relying on `/finalize` Step 5.5) — note as an implementation decision.
- [ ] (Optional, low value, defer-able) extend the lint to flag a few currently-unchecked constructs found in the files: `INSERT … ON CONFLICT`, `CREATE SEQUENCE`, plain `CREATE VIEW`.

### Phase 3: Append-only enforcement (Option A2)
- [ ] Add a CI check (new step/job in `supabase-migrations.yml` on `pull_request`): `git diff --name-only --diff-filter=M origin/main...HEAD -- 'supabase/migrations/*.sql'` non-empty → fail "migrations are append-only; create a new migration instead."
- [ ] Bypass: a per-file `-- @migration-edit-approved` marker AND/OR a `migration-edit-approved` PR label (mirror the existing `@destructive-ddl-approved` + `migration-lint-bypass` precedents).
- [ ] Confirm it is immune to `git mv` renames (they show as delete+add, not modify) so legitimate reorders/`/mainToProd` deletions don't false-positive.
- [ ] Tests: editing a shipped file fails; adding a new file passes; rename (D+A) passes; marker/label bypass passes.

### Phase 4: Retire auto-rename workflow + blocking ordering check (Option C2)
- [ ] Port the timestamp-order logic from `.githooks/pre-commit` (lines ~63–139) into a `scripts/check-migration-order.(sh|ts)` and add `npm run check:migrations`.
- [ ] Add it as a **required** job in `supabase-migrations.yml` (PR event): any newly-added migration whose 14-digit timestamp ≤ the max on `origin/main` → fail with the exact `git mv … <NEXT_TS>_<desc>` rename instruction. Also fail on duplicate versions.
- [ ] Delete `.github/workflows/migration-reorder.yml`.
- [ ] Update `.githooks/pre-commit` message (line ~112) that currently points authors to the now-removed auto-rename Action.
- [ ] **Keep** the deploy `repair` steps (C3 deferred). Add a note that they can be simplified once the duplicate backlog drains.
- [ ] Tests for the ordering check: out-of-order new file fails; in-order passes; duplicate version fails.

### Phase 5: Proactive prod-drift detection (Option C1)
- [ ] Decide the mechanism (flag as the key open decision): (a) a scheduled GitHub Action `/verifyProdRelease` that links to prod via CI secrets and runs `supabase migration list` / `db diff` to assert every local migration version is applied; and/or (b) grant `readonly_local` USAGE+SELECT on `supabase_migrations.schema_migrations` (prod + staging) so a post-deploy assertion / `query:prod` can reconcile versions. (Security sign-off needed for (b).)
- [ ] Implement the chosen detector as a scheduled workflow (daily) + a post-`deploy-production` assertion step that fails loud + Slacks if any local version is unapplied.
- [ ] Route alerts to an explicitly-unmuted channel (the postmortem notes no dedicated `#release-alerts` exists yet) — coordinate with a repo admin.
- [ ] Dry-run the detector against staging first (where linking is allowed) before pointing it at prod.

## Testing

### Unit Tests
- [ ] `scripts/lint-migrations-idempotent.test.ts` — existing; add cases if Phase 2 extends the lint patterns.
- [ ] `scripts/test-verify-migrations-local.sh` — add an apply-twice / non-idempotent fixture (Phase 2).
- [ ] New `scripts/test-check-migration-order.*` — ordering-check cases (Phase 4).
- [ ] New append-only-check tests — modify/add/rename/bypass cases (Phase 3).

### Integration Tests
- [ ] `npm run migration:verify` (now apply-twice) passes against all 94 files after the Phase 2 retrofit — this is the core integration check.

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

## Documentation Updates
- [ ] `docs/docs_overall/environments.md` — lint now blocking; append-only rule + bypass; reorder workflow retired → blocking ordering check; new prod-drift detector + alert channel.
- [ ] `docs/docs_overall/testing_overview.md` + `docs/feature_deep_dives/testing_setup.md` — apply-twice in `migration:verify`; updated migration command list.
- [ ] `docs/feature_deep_dives/pr_verification_gate.md` — note the append-only gate alongside the existing migration-touch high-blast gate.
- [ ] `supabase/migrations/EVOLUTION_HISTORY.md` — correct the stale claim that pre-2026-03-22 files were deleted (they still exist); fix the mis-referenced convergence filename.

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
