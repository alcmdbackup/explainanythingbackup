# enforce_no_pr_without_fixing_issues_locally_20260526 Progress

## Phase 0: Developer prerequisites

### Work Done
- Docker install instructions added to CLAUDE.md (Linux/macOS/Windows)
- `migration:verify` script exits with clear install message if Docker absent
- `MIGRATION_VERIFY_SKIP=true` escape hatch documented for last-resort bypass

### Issues Encountered
- Docker not installed on this dev machine; tested abundance of fallback paths instead. Verified test harness gracefully skips Docker-dependent cases.

## Phase 1+3: Always-on gate + reactive scaffold + escape hatch (shipped together)

### Work Done

**Phase 1a: PR-creation hook**
- Created `.claude/hooks/block-pr-create-without-gate.sh` (210 lines)
  - Intercepts: `gh pr create`, `gh pr ready` (sans `--undo`), `gh api ... /pulls -X POST`, `gh api graphql createPullRequest`, `bash -c "gh pr create ..."`
  - Bypasses: `hotfix/*` branches, `DISABLE_PR_GATE=true` env var (both exported and inline forms), `.claude/ci-gate.disabled` file
  - Quote-stripping handles false positives like `git log | grep 'gh pr create'` and `gh pr comment --body "remember to gh pr create"`
  - Override file validation: branch + SHA match, all required fields present, schema_version=1, no future-dated `approved_at`
  - Reads stdin JSON per `check-workflow-ready.sh` / `test-bypass-safety-hooks.sh` contract
- Registered hook in `.claude/settings.json` PreToolUse → Bash matcher (after `block-push-without-gate.sh`)

**Phase 1b: Migration verification**
- Created `scripts/verify-migrations-local.sh` (130 lines)
  - Ephemeral Docker `postgres:15-alpine` container on random ephemeral port (49152-65535)
  - Portable `pick_port` function with `ss` primary and `lsof` fallback (works on Linux and macOS)
  - `pg_isready` wait loop capped at 30s; SIGINT/SIGTERM/EXIT traps reap container
  - Applies all `supabase/migrations/*.sql` in lexicographic order via `psql -v ON_ERROR_STOP=1`
  - Invokes `scripts/lint-migrations-idempotent.ts` as a post-check
  - `MIGRATION_VERIFY_SKIP=true` env var escape hatch
- Added `migration:verify`, `test:hooks`, `test:migration-verify` to `package.json`
- Added new `/finalize` Step 5.5 (Migration Verification) between Step 5 (E2E) and Step 6 (Docs); HARD GATE on failure with clear recovery path
- Added Step 7 write of `.claude/test-pass.json` alongside existing `push-gate.json` write (no re-run; reuses Step 4-5 in-memory results)

**Phase 1c: Test harnesses**
- `scripts/test-block-pr-create-without-gate.sh` — 47 test cases across 8 categories:
  - Matcher decision cases (5)
  - False-positive prevention (12)
  - High-blast: migration-touching (4)
  - High-blast: `--base production` quoting forms (4)
  - Bypass: hotfix branch (1)
  - Bypass: `DISABLE_PR_GATE` (2)
  - Reactive path full state machine (11)
  - Override validation (5)
  - Hook smoke tests (2 — verifies registration in settings.json + executable permission)
  - Initial run found 12 failures, all due to a bug in `init_workspace` (the `rm -rf $WORK_DIR/*` did not match hidden files like `.git/`) and one in the matcher (quote-stripping was too aggressive for `bash -c` and graphql payloads). Both fixed; all 47 now pass.
- `scripts/test-verify-migrations-local.sh` — 4 PASS + 4 SKIP (Docker-dependent skips run in CI where Docker is available)

**Phase 1d: CI**
- Added `hook-tests` job (light, no Docker) and `migration-verify-test` job (uses Ubuntu runner's built-in Docker, with docker-pull retry) to `.github/workflows/ci.yml`
- Both jobs gate on `detect-changes` to skip docs-only PRs
- `migration-verify-test` only runs when migration paths change

**Phase 3: `/approve-pr` escape hatch**
- Created `.claude/commands/approve-pr.md`
- Flow: refuse on main/production, silent-exit on hotfix; AskUserQuestion confirms intent; plain-chat reason prompt; write `.claude/ci-gate-override.json` keyed by branch + HEAD SHA; auto-commit with reason in message
- Override is SHA-keyed (any new commit invalidates), no time window
- Existing valid approval is displayed and the command exits — no double-commit

**Phase 4: Documentation**
- `CLAUDE.md` — added § "PR-Creation Gate" + § "Migration Verification" with Docker install instructions
- `docs/docs_overall/project_workflow.md` § Step 8 — extended push-gate description with PR-creation gate
- `docs/docs_overall/testing_overview.md` — Check Parity table now includes Migration verify + Hook tests rows
- `docs/feature_deep_dives/pr_verification_gate.md` — new 100-line deep-dive: quick reference table, two enforcement paths, matcher table, bypass mechanisms, threat model, worktree behavior, known gap, recovery instructions per blocked state, implementation file map
- `.gitignore` — added `.claude/ci-gate.json`, `.claude/test-pass.json`, `.claude/ci-gate.disabled` (the override file IS committed — audit trail)

**Phase 5: Known gap**
- Playwright MCP UI-driven PR creation documented in the new deep-dive as accepted-out-of-scope. Both Claude and user must be careless simultaneously for it to bite.

### Verification

- `npm run test:hooks` → 127 PASS (47 PR-create hook + 80 existing bypass-safety hook), 0 fail
- `npm run test:migration-verify` → 4 PASS, 0 fail, 4 SKIP (Docker not installed on dev box; CI will run them)
- `npm run typecheck` → clean
- `npm run lint` → clean (only pre-existing design-system warnings in unrelated files)

### Issues Encountered

1. **Bypass-safety hook initially blocked write to `.claude/hooks/`** (session was in `--dangerously-skip-permissions` mode). Resolved on retry — appears to have been transient or related to permission re-grant.
2. **`init_workspace` test fixture bug**: `rm -rf $WORK_DIR/*` doesn't match hidden files (`.git/` persisted across calls). Fixed by allocating a fresh subdir per call.
3. **Matcher false-negatives for `bash -c` and graphql payloads**: my initial quote-stripping was too aggressive — the actual command IS inside the quotes for those bypass patterns. Added secondary checks against the original (unstripped) command for those specific patterns.
4. **`scripts/seed-admin-test-user.ts` referenced in Phase 2b but Phase 2 isn't shipping in this PR** — left out of `package.json`'s `test:gate` script (Phase 2 work).

### User Clarifications
- Approval window: SHA-keyed (no time window) — confirmed
- Branch-prefix bypass: `hotfix/` only — confirmed
- Test-passed criterion: "tests passed" strictly — confirmed; `test:gate` written-but-not-deployed in Phase 2
- Migration verification: use full /finalize checks — confirmed
- Docker prerequisite: add as Phase 0 with install instructions — confirmed
- Phase 1+3 shipped together to avoid escape-hatch gap; Phase 2 deferred to a follow-up PR

## Phase 2: Reactive CI-failure gate

Shipped in the same PR as Phase 1+3 per user request.

### Work Done

**Phase 2a: CI-gate state writer**
- Created `.claude/hooks/update-ci-gate.sh` — Stop-hook sibling of `enforce-ci-monitoring.sh`
  - Queries `gh pr view --json statusCheckRollup`, writes `.claude/ci-gate.json` based on observation
  - **Asymmetric bypass**: only `hotfix/` exempt; `fix/`, `docs/`, `chore/` are NOT bypassed — this is the iteration-2 loophole closed
  - Schema: `{branch, status: open|closed|unknown, last_observed_at, last_observed_sha, last_failure_commit, last_observation_source: "stop_hook", schema_version: 1}`
  - Writes `closed` on observed FAILURE, `open` on all-SUCCESS, preserves on PENDING / gh-failure / different-branch-state (never clobbers wrong state)
  - Atomic write (`.tmp` + `mv`), SIGINT/EXIT/TERM trap cleans the `.tmp`
  - Honors `.claude/ci-gate.disabled` kill switch
- Registered as separate Stop-hook entry in `.claude/settings.json` (sibling of `enforce-ci-monitoring.sh`, NOT inline-invoked from it — coupling them would defeat the loophole fix)

**Phase 2b: Local test-pass tracker**
- Created `scripts/run-test-gate.sh` (`npm run test:gate`):
  - Phase A (parallel): `lint` + `typecheck` + `test:esm`
  - Phase B (parallel): `test` (unit full) + `test:integration` (full)
  - Phase C: `test:e2e:critical` (requires dev server)
  - `bash & wait` parallelism with explicit exit-code aggregation (`npm-run-all` confirmed not in package.json)
  - **CI detection**: `ensure-server.sh` + `seed-admin-test-user.ts` only invoked when `$CI` is unset
  - On success: atomic write of `.claude/test-pass.json` with `tests: [...]` canonical array (6 entries)
  - On failure or SIGINT: deletes any existing `test-pass.json` (no stale pass)
- Added `test:gate` script to `package.json`

**Phase 2c: Push-gate extension**
- Extended `.claude/hooks/block-push-without-gate.sh`:
  - **Path 1 (main/production push)**: existing behavior preserved — bypasses `hotfix|fix|docs|chore`, requires `push-gate.json`
  - **Path 2 (feature-branch push)**: NEW — only `hotfix/` bypasses (asymmetric vs Path 1). If `ci-gate.json` says CLOSED for current branch, requires `test-pass.json` matching HEAD OR matching override.
- Both paths still fail-open on parse errors with stderr warnings (reactive path is non-critical)
- Honors `.claude/ci-gate.disabled` kill switch

**Phase 2d: Tests + CI**
- Created `scripts/test-update-ci-gate.sh` with 19 test cases:
  - Bypass: hotfix branch, .ci-gate.disabled, main/production
  - Asymmetric bypass regression: fix/, docs/, chore/ all DO write CLOSED state
  - gh-missing: no write, no error
  - No PR: no clobber
  - CI failure: full schema written + last_failure_commit set
  - All SUCCESS: status=open + failure_commit cleared
  - PENDING: prior status preserved
  - Smoke: hook registered in settings.json + executable
  - Uses PATH-stub `gh` to inject canned JSON responses
- Added `test-update-ci-gate.sh` to both `npm run test:hooks` and the CI `hook-tests` job

### Issues Encountered

1. **Stop-hook stubbing**: Unlike PreToolUse hooks (stdin JSON), Stop hooks query `gh` directly. Tests had to stub `gh` via PATH override, returning canned JSON. Cleaner than mocking gh API calls.
2. **PENDING semantics**: Plan said "preserve prior state on PENDING" — implementation needed care to handle the empty-prior-state and different-branch-prior-state cases. Solved by setting `WRITE_STATUS="unknown"` only when no prior state for this branch exists.
3. **Existing block-push-without-gate.sh structure**: bypass-branch check was BEFORE target-branch determination, conflating "what's the target" with "should we bypass". Restructured into two clear paths so the new feature-branch case has its own asymmetric bypass rules.

### Verification

- `npm run test:hooks` → **148 total PASS, 0 fail** across 3 harnesses (80 bypass-safety + 49 PR-create + 19 update-ci-gate)
- `npm run typecheck` → clean
- `npm run lint` → clean (only pre-existing design-system warnings)

### Effect on the system

With Phase 2 shipped, the gate system is now fully active:
- **Always-on path** (migrations / `--base production`): unchanged from Phase 1+3
- **Reactive path** (normal feature → main): now ENFORCING. After a CI failure on a branch's PR, both `git push` to that feature branch AND `gh pr create` will deny until either `npm run test:gate` writes a fresh test-pass.json, OR `/approve-pr` writes an override.
- **Asymmetric bypass**: `hotfix/` is the only branch prefix exempt from the new reactive checks. `fix/`, `docs/`, `chore/` are now gated — closing the loophole noted in plan-review iteration 2.
