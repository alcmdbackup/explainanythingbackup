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

## Phase 2: Idempotent migrations + apply-twice verify — BLOCKED (needs Docker)
### Status
Not started. The retrofit of the 22 files MUST be verified by the apply-twice Docker harness (the plan's authoritative gate), and Docker is unavailable here. Editing ~22 SQL files (incl. ~30 ADD CONSTRAINT guards in `fix_drift.sql`) without being able to run the verification would be committing unverified SQL — declined pending a decision.
### Options (pending user)
1. Install Docker locally (one-time, needs sudo), then execute + verify here.
2. Write the harness + guards and rely on CI's `migration-verify-test` (which has Docker) for verification — riskier (push-then-verify), and the apply-twice CI gate would be red until the retrofit is correct.
3. Defer Phase 2 until Docker is available; proceed with Docker-free Phases 3/4 — but Phase 3 is sequenced AFTER Phase 2, so only Phase 4 can proceed independently.

## Phase 3: Append-only enforcement gate — NOT STARTED (blocked by Phase 2 ordering)
Must follow the Phase 2 retrofit (which edits shipped files in place; the gate would otherwise block our own cleanup).

## Phase 4: Retire auto-rename + ordering check — NOT STARTED (Docker-free, independent)
Can proceed without Docker and without conflicting with Phase 2/3.

## Phase 5: Proactive prod-drift detection — BLOCKED ON DECISION
Awaiting the mechanism choice (CI-secret scheduled link vs `readonly_local` grant shipped as a migration).
