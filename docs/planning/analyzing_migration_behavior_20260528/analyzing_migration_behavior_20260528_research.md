# Analyzing Migration Behavior Research

## Problem Statement
Analyze how the project handles database (Supabase SQL) migrations end-to-end: how migrations are tested locally, how they are deployed to staging/production, and how we protect against idempotency failures (e.g. enforcing guards via hooks or lint). Also assess how to clean up the existing backlog of migrations, how to better prevent migration bugs generally, and review GitHub history to catalog the migration-related bugs we've already had.

## Requirements (from GH Issue — TBD)
I want to analyze how we're handling migrations. E.g. how we are testing migrations locally, how we are doing it in staging/prod. How to protect against idempotency failures e.g. by enforcing using hooks or lint. How to clean up our existing migrations. How we can better prevent migration bugs. Analyze GH history to see what migration related bugs we've had.

## High Level Summary
Migrations are plain SQL files in `supabase/migrations/` (94 files, 2025-11-09 → 2026-05-27; ~2/3 are evolution/arena schema). They deploy via `.github/workflows/supabase-migrations.yml`: **staging on push to `main`, production ONLY on push to `production`** (which happens via a `/mainToProd` release PR merge). `supabase db push` applies in timestamp order under `ON_ERROR_STOP` and **aborts the entire queue on the first failure**.

The system has accumulated real safeguards — an idempotency lint, a Docker shadow-DB verify harness, a fail-closed PR-creation gate for migration-touching PRs, a destructive-DDL CI check, post-merge reminder banners — but they were largely built reactively after ~20 migration incidents, culminating in the **62-day silent prod-schema drift (PR #1073→#1074, May 2026)**: a non-idempotent `ADD CONSTRAINT` aborted the prod queue, stranding 56 backlog migrations, undetected because the only detector (nightly E2E) alerted to a muted Slack channel.

The dominant bug class is **non-idempotency on re-apply**, and the current tooling has structural gaps against exactly that class: the idempotency lint is **still warn-only until 2026-05-31** and only scans *newly-added* files; the Docker harness applies each migration **once on a fresh DB** and so cannot reproduce a re-apply failure; there is **no append-only enforcement** (migrations have been edited in place after shipping); and the `migration-reorder.yml` workflow actively resurrects deleted files and feeds the `migration repair` steps that manufacture the "object exists but version unrecorded" ledger state behind #1073.

Cleanup is constrained: a squash/baseline is **dangerous** because prod has diverged (an earlier V2 clean-slate wipe + deferred prod-convergence + duplicate ledger rows) and cannot be linked locally. The low-risk cleanup is to **retrofit idempotency guards into the 22 files that fail the lint** (a guard-only edit is a no-op where already applied and identical on a fresh DB). Critically, the highest-value prevention upgrade — an **apply-twice idempotency test** — cannot be turned on until those 22 files are guarded, or it goes red on day 1 (it fails on the very first file, `20251109053825_fix_drift.sql`).

---

## Migration Lifecycle (current state)

### Local testing
- `npm run migration:verify` → `scripts/verify-migrations-local.sh`: spins an ephemeral `postgres:15-alpine` on a random port (avoids the live local DB), applies all `*.sql` **once** in lexicographic order via `psql -v ON_ERROR_STOP=1` (loop at lines 134–148), then runs the idempotency lint. `MIGRATION_VERIFY_SKIP=true` bypasses; Docker is a prerequisite.
- `npm run lint:migrations` → `scripts/lint-migrations-idempotent.ts`: static idempotency lint. **Not wired into `npm run lint`** — only runs transitively via `migration:verify` (i.e. only when `/finalize` detects a migration diff).
- `/finalize` Step 5.5 runs `migration:verify` as a **HARD GATE** when the diff touches `supabase/migrations/**` (`.claude/commands/finalize.md:690–708`).
- `.githooks/pre-commit` (active via `core.hooksPath`) blocks commits that add a migration whose 14-digit timestamp ≤ the latest on `origin/main`, and blocks duplicate versions (lines 63–139). Client-side only / `--no-verify`-bypassable.

### CI deploy (staging / prod)
- `supabase-migrations.yml`: `lint-migrations-idempotent` job runs on PRs (warn-only, see below); `deploy-staging` runs on push to `main` (project `ifubinffdbyewoezcidz`); `deploy-production` runs on push to `production` (project `qbxhivoezkfbjbsctdzo`). No `needs:` between jobs, no concurrency block in this file.
- `ci.yml` on PRs: `deploy-migrations` applies the PR's migrations to **staging before tests** (concurrency group `migration-staging`), `generate-types` auto-commits regenerated types, `migration-verify-test` runs the Docker harness *self-test*, `hook-tests` runs hook unit tests.
- **Destructive-DDL block** (`DROP TABLE/COLUMN`, `RENAME`, `TRUNCATE`, `DELETE FROM`; allowlists `DROP …IF EXISTS`) lives ONLY in `ci.yml:90–117` (PR-gated, `--diff-filter=AM`), NOT in `supabase-migrations.yml`. Override marker `-- @destructive-ddl-approved`.

### Hooks / gates
- `block-pr-create-without-gate.sh`: **high-blast fail-CLOSED** path when a PR touches `supabase/migrations/**` OR targets `--base production` — requires `.claude/push-gate.json` (written by `/finalize`/`/mainToProd`) or a `/approve-pr` override. Reactive fail-OPEN path otherwise.
- `block-push-without-gate.sh`, `update-ci-gate.sh` (asymmetric bypass: only `hotfix/`), `block-supabase-writes.sh` (blocks `supabase db push/reset`, prod `link`, `supabase db query --linked`, raw `psql`).
- `/mainToProd` currently writes **no** gate file and has **no** `migration:verify` step or post-merge banner on this branch (`feat/mainToProd_20260526` appears to be addressing this).

---

## GitHub History — Migration Bug Catalog
~20 distinct migration incidents Jan–May 2026 (all verified via `gh`). Highlights:

| PR/Issue | Date | What broke | Root cause |
|---|---|---|---|
| #155/#147 | 2026-01-04 | Prod tables missing RLS | 5 tables had no policies |
| #324, #447, #481, #414, #658 | Feb 2026 | `schema_migrations_pkey` violations / queue blocked | Duplicate or out-of-order or stale-worktree timestamps |
| #372, #575, #607, #613 | Feb–Mar | Deploy aborts | Backfill ordering / stale-column refs |
| #579 | 2026-02-26 | Index migration fails | `CREATE INDEX CONCURRENTLY` can't run in Supabase per-file txn |
| #614/#623/#625, #996 | Mar–Apr | Re-apply aborts (42809/42710) | Non-idempotent DDL already applied |
| #732/#752 | 2026-03-19 | RLS migrations crash (42704) | Reference missing `readonly_local` role / renamed tables |
| #780–#791 | 2026-03-23 | Prod queue stuck | "Reorder Timestamps" workflow resurrected deleted files → orphans |
| **#1073→#1074→#1075** | **2026-05-23/24** | **62-day silent prod drift; nightly E2E 100% red** | **Non-idempotent `ADD CONSTRAINT chk_budget_cap` aborted prod queue; 56 migrations stranded; alerts to muted Slack** |
| #1081 | 2026-05-24 | (prevention) | Added idempotency lint + post-merge banner + smoke-matrix fix |
| #1105 | 2026-05-28 | (prevention) | Added PR-creation verification gate + Docker `migration:verify` |

**Recurring themes:** (A) non-idempotency [dominant], (B) duplicate/colliding versions, (C) out-of-order timestamps, (D) prod-vs-staging drift, (E) backfill ordering/stale-column refs, (F) RLS vs missing roles/tables, (G) in-place edits to shipped migrations, (H) post-merge-only detection, (I) `repair --status reverted` orphan state.

**Earlier related incident:** `clean_up_migration_history_evolutuion_20260321` (#773) — the V2 clean-slate wipe (`20260315000001_evolution_v2.sql`) corrupted history and permanently lost `evolution_explanation_id` FKs; **prod convergence (`20260322000007_evolution_prod_convergence.sql`) was authored but DEFERRED and never run** — directly setting up the later 62-day drift.

---

## Idempotency Enforcement — Findings

### The 22-file backlog (authoritative; ran the lint per-file on all 94)
**22 of 94 files fail** (105 findings). Breakdown by files affected: `CREATE INDEX` w/o IF NOT EXISTS — 17; `CREATE TABLE` w/o IF NOT EXISTS — 13; `CREATE POLICY` w/o DROP — 9; `CREATE FUNCTION` w/o OR REPLACE — 2; `CREATE TYPE` unguarded — 1; `ADD COLUMN` w/o IF NOT EXISTS — 1. **`ADD CONSTRAINT` and `CREATE TRIGGER` are now fully clean (0)** — the May-2026 trip-wire class was remediated. Worst single file: `20251109053825_fix_drift.sql` (18 bare index recreations). Backlog is concentrated in early main-app `create_*` migrations (16 files) + 6 evolution files.

### Lint gaps (false negatives)
- **Line-based regex** — misses multi-line DDL. Real example: `20260131000006_content_eval_runs.sql:24–25` is a multi-line `ADD CONSTRAINT` with no `DROP … IF EXISTS` that the lint does **not** flag.
- **Comment stripper is content-unaware** — mishandles `--` inside `$$…$$` bodies / string literals.
- **Only scans newly-ADDED files** (`--diff-filter=A`, line 193) → cannot detect in-place edits, and legacy backlog never trips CI.
- **Unchecked constructs present in the 94 files:** `INSERT` without `ON CONFLICT` (re-run dupes seed rows), `CREATE SEQUENCE` without IF NOT EXISTS (8× in `fix_drift`), plain `CREATE VIEW`, `ALTER TYPE … ADD VALUE`, `CREATE EXTENSION`.

### Warn-only → blocking flip (2026-05-31) is SAFE
`continue-on-error: true` at `supabase-migrations.yml:68` (comment schedules flip on 2026-05-31). Because the lint only scans newly-added files, the 22 legacy violators won't trip it; **0 open PRs add migrations**, current branch adds 0. Flipping breaks nothing.

---

## Verify Harness Gap + the apply-twice sequencing dependency
- `verify-migrations-local.sh` applies each migration **exactly once on a fresh empty DB** (single loop, no second pass). It therefore **cannot reproduce the #1073 re-apply failure**. The `migration-verify-test` CI job only tests the harness *script* against synthetic fixtures — it never applies the real 94 twice.
- **Fix:** add a second apply loop (re-apply all migrations to the same populated DB, assert each still succeeds). Strictly stronger than the static lint; catches legacy non-idempotency the lint ignores.
- **CRITICAL SEQUENCING:** an apply-twice test **cannot be enabled today** — re-applying the current 94 fails on the **first file** (`20251109053825_fix_drift.sql`, error 42P07 on a duplicate index). All 22 backlog files would fail the second pass. **The 22 files must be guarded FIRST, then enable apply-twice.**

---

## Append-only / in-place edits
- **No append-only enforcement exists** anywhere (hooks/scripts/workflows). Migrations have been edited in place after shipping (e.g. `20260322000003_add_budget_check_constraint.sql` edited 2 months post-ship to retrofit a `DROP CONSTRAINT IF EXISTS`). On environments where a migration already applied, an in-place edit silently never takes effect → drift.
- **Diff-filter inconsistency:** idempotency lint uses `--diff-filter=A` (additions only); destructive-DDL check uses `--diff-filter=AM` (catches edits). The idempotency layer is blind to the exact edit-in-place pattern.
- **Recommended design:** a CI check `git diff --diff-filter=M origin/main...HEAD -- supabase/migrations/*.sql` non-empty → fail "migrations are append-only", with a `-- @migration-edit-approved` marker / label bypass (mirrors existing precedents). Immune to the reorder workflow because `git mv` shows as delete+add, not modify. Avoid a hash-manifest (path-keying recreates the #780-791 resurrection class).

## Reorder workflow + repair steps (a self-inflicting loop)
- `migration-reorder.yml` is **ACTIVE** (fires ~14× to date, ~1.4/month). It auto-renames out-of-order new migrations and auto-commits with `file_pattern: 'supabase/migrations/*.sql'` (stages the *whole* tree, not just renamed files) using a base-tip diff — this is how it has resurrected deleted files.
- The deploy jobs' `migration repair --status reverted|applied` steps (run unconditionally, no dry-run) clean up the orphan/duplicate ledger entries the reorder workflow creates — but `repair --status reverted` leaves the DB object in place while removing its ledger row → the exact "object exists, version unrecorded" state that makes a later `db push` re-run (and abort on) non-idempotent DDL. **The reorder + repair pair is a latent re-trigger of the #1073 class.**
- A **blocking** server-side timestamp-order check already exists client-side in `.githooks/pre-commit:63–139`; promoting that logic to a required CI job would let the auto-rewrite workflow be retired.

## Prod drift detection
- `query:prod` works (`.env.prod.readonly` present; prod has 43 public tables). Staging shows **no detectable drift** (latest `20260527*` paragraph-recombine schema is applied).
- **Blockers:** `supabase link` to prod is blocked locally; the `readonly_local` role gets **permission denied on `supabase_migrations.schema_migrations`** on BOTH staging and prod — so a version-level "is every local migration applied to prod?" reconciliation is **not** possible via the query scripts today.
- Nightly E2E is the only de-facto drift detector and it was 100% red for 62 days unnoticed (muted Slack). Proactive detection (`/verifyProdRelease` skill + daily cron, pre-merge prod-snapshot dry-run) was proposed in the smoke-test postmortem but **deferred**.

## Cleanup feasibility
- **Squash/baseline = DANGEROUS now**: prod diverged (V2 wipe + deferred convergence + duplicate ledger), can't link prod locally, and a baseline whose version isn't in prod's ledger would re-run against drifted prod → queue abort. `EVOLUTION_HISTORY.md` even **falsely claims** pre-2026-03-22 files were deleted (32 still exist) — stale and misleading.
- **Recommended cleanup = retrofit guards into the 22 files** (option B): adding `IF NOT EXISTS`/`DROP … IF EXISTS`/`OR REPLACE` is a no-op where already applied and identical on a fresh DB; gate each edit through `migration:verify`. Defer squash and prod-convergence (require CI-secret prod link, separate planned effort).

---

## Prevention-Coverage Matrix
| Class | Safeguard today | Blocking? | Verdict |
|---|---|---|---|
| A Non-idempotent re-apply | idempotency lint; Docker verify (fresh-apply only) | **Advisory until 2026-05-31**; legacy-blind; no re-run test | Partial |
| B Duplicate timestamps | reorder workflow dup-check; pre-commit hook | Blocking | Covered (self-inflicting) |
| C Out-of-order timestamps | reorder workflow; pre-commit hook | Blocking (auto-fix) | Covered (self-inflicting) |
| D Prod↔staging drift | nightly E2E + smoke (reactive) | Advisory | **UNCOVERED (proactive)** |
| E Backfill ordering | fresh-apply verify | Partial | Partial (can't model prod data state) |
| F RLS vs missing roles | fresh-apply verify | Partial | Partial (no role-existence check) |
| G In-place edits | none | — | **UNCOVERED** |
| H Post-merge-only detection | nightly/smoke + post-merge banner | Advisory | Partial |
| I `repair --status reverted` orphan state | (the repair step is the cause) | — | **UNCOVERED** |

---

## Key Findings
1. **Dominant failure class is non-idempotency on re-apply**, and the three tools that should catch it each have a structural hole: lint is warn-only + new-files-only; verify is fresh-apply-only; nothing tests re-apply.
2. **22 of 94 migrations fail the idempotency lint** — the concrete cleanup backlog (heaviest: bare `CREATE INDEX`/`TABLE`/`POLICY`; `ADD CONSTRAINT`/`TRIGGER` already clean).
3. **The 2026-05-31 lint-flip to blocking is safe** and should ship.
4. **An apply-twice idempotency test is the highest impact-per-effort upgrade**, but is **gated behind guarding the 22 legacy files first** (else red on file #1).
5. **No append-only enforcement** + a diff-filter inconsistency mean shipped migrations can be (and have been) silently edited.
6. **`migration-reorder.yml` + `repair --status reverted` form a self-inflicting loop** that manufactures the drift state behind #1073; a blocking ordering check (logic already in the pre-commit hook) can replace the risky auto-rewrite.
7. **Prod drift is only detectable reactively** (nightly E2E) and version-level reconciliation is blocked by `schema_migrations` permissions + the prod-link block.
8. **Squash is unsafe**; prod convergence remains owed since #773; `EVOLUTION_HISTORY.md` is factually stale.

## Prioritized Recommendations (effort / impact)
1. Flip the idempotency lint to blocking on 2026-05-31 — set `continue-on-error: false` (`supabase-migrations.yml:68`). **S / high.**
2. Retrofit idempotency guards into the 22 legacy files via `migration:verify`. **M / high** (prereq for #3).
3. Add an apply-twice idempotency pass to `verify-migrations-local.sh` (+ a CI fixture). **S / high.**
4. Add an append-only CI gate (`--diff-filter=M` + `@migration-edit-approved` bypass). **S / high.**
5. Build proactive prod-drift detection: `/verifyProdRelease` skill + daily cron, and/or grant `readonly_local` USAGE on `supabase_migrations` for a post-deploy "all versions applied" assertion. **M / high.**
6. Retire `migration-reorder.yml`; promote the pre-commit ordering logic to a required server-side CI check. **M / med.**
7. Harden the deploy `migration repair` steps (dry-run, verify object absence before `--status reverted`). **M / med.**
8. Correct/retire `EVOLUTION_HISTORY.md`; keep following the 2-week release cadence (smaller queues bisect easier). **S / med.**
9. Defer: squash/baseline + prod convergence (need prod link via CI; separate planned effort).

## Open Questions
- Who owns running the deferred **prod-convergence** migration + duplicate-ledger cleanup (requires CI-secret prod link)? Is prod actually safe to converge, or is the divergence load-bearing?
- Should `readonly_local` be granted `USAGE` on `supabase_migrations` (prod + staging) to enable version-level drift assertions, and is that acceptable security-wise?
- Is the analysis-only scope sufficient, or does the user want this project to also IMPLEMENT recommendations 1–4 (which are low-risk and mostly ready)?
- Where should release-health alerts route (a dedicated, unmuted `#release-alerts` channel is noted as not-yet-established)?

## Documents Read
- docs/docs_overall/environments.md — deploy workflow, idempotency lint, staging→prod gating, 62-day drift incident, 2-week release cadence, backup mirror
- docs/feature_deep_dives/pr_verification_gate.md — migration-touch high-blast PR gate, Docker `migration:verify`, gate files
- docs/feature_deep_dives/testing_setup.md — migration idempotency lint + verify Docker suite, test tiers
- docs/docs_overall/testing_overview.md — Check Parity (migration:verify in /finalize Step 5.5), CI migration jobs
- docs/docs_overall/debugging.md — Supabase CLI inspection, query:staging/query:prod, budget-event debugging
- docs/docs_overall/project_workflow.md — push/PR gates for migration-touching branches
- docs/docs_overall/architecture.md — schema-first development, Supabase backend, DB tables
- docs/planning/smoke_test_and_nightly_e2e_failing_20260523/ — the 62-day drift postmortem + deferred prevention options
- docs/planning/clean_up_migration_history_evolutuion_20260321/ — V2-wipe history corruption, deferred prod convergence

## Code Files Read
- scripts/lint-migrations-idempotent.ts — idempotency lint (patterns, `--diff-filter=A`, `--file=`, warn/flip)
- scripts/verify-migrations-local.sh — Docker shadow-DB fresh-apply harness (single loop, lines 134–148)
- scripts/test-verify-migrations-local.sh — harness self-test (synthetic fixtures)
- .github/workflows/supabase-migrations.yml — staging/prod deploy jobs, lint job (continue-on-error:68), repair steps
- .github/workflows/ci.yml — deploy-migrations (staging on PR), destructive-DDL check (AM, ~L90-117), migration-verify-test, generate-types
- .github/workflows/migration-reorder.yml — auto-rename workflow (active; resurrection mechanism)
- .githooks/pre-commit — client-side timestamp-order + duplicate-version block (lines 63–139)
- .claude/hooks/block-pr-create-without-gate.sh, block-push-without-gate.sh, update-ci-gate.sh, block-supabase-writes.sh
- .claude/commands/finalize.md (Step 5.5), mainToProd.md
- supabase/migrations/*.sql — 94 files inventoried; 22 idempotency-failing; EVOLUTION_HISTORY.md (stale); 20260322000007_evolution_prod_convergence.sql (deferred); 20260131000006_content_eval_runs.sql (multi-line constraint)
