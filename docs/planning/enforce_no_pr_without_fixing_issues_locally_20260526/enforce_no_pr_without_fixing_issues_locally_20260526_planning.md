# enforce_no_pr_without_fixing_issues_locally_20260526 Plan

## Background

The repo currently has a partial verification gate: `.claude/hooks/block-push-without-gate.sh` blocks `git push` to `main`/`production` unless `.claude/push-gate.json` matches HEAD (written by `/finalize` or `/mainToProd` after their full check suites pass). But `gh pr create` itself is **completely ungated**, and feature-branch pushes are unconditional. The `hotfix/`, `fix/`, `docs/`, `chore/` branch prefixes further bypass the push-gate entirely. Recent history shows 5+ concrete incidents in 3 months where local verification would have prevented CI red and follow-up fixup PRs (e.g., migration referencing a non-existent column in `0bbe1ab8`, ESLint serial-mode errors in `39537ece`, perf change breaking integration tests in `6a9684f1`). This project closes the gap with a layered design: a **reactive gate** for everyday feature-branch iteration, a **narrow always-on gate** for high-blast-radius surfaces, and a single user-explicit **escape hatch** for both.

## Requirements (from user)

Block Claude Code from creating PRs without first verifying changes locally, unless specifically approved by the user.

## Problem

`gh pr create` runs after `git push` and has no PreToolUse hook intercepting it. Once a feature-branch push lands (which is allowed unconditionally today), Claude can open a PR with unverified code in a single command — no local lint/typecheck/build/unit/integration/E2E run is forced. CI catches the failure eventually, but at the cost of a failed first attempt, wasted CI minutes, and (worst case) a broken-migration or broken-build merge that cascades into the next unrelated author's PR run. The reasons the always-on-hard-gate approach is too aggressive: it taxes careful users on every PR, the cost-per-PR is mostly imaginary (most PRs would pass CI), and the historical incident set concentrates in two specific surfaces (migrations + `/mainToProd`) where the *first* failure is already too expensive to absorb. Everything else has cheap recovery — a CI failure on a normal feature → main PR is a learning signal, not a disaster.

## Options Considered

- [ ] **Option A: Always-on hard gate on every `gh pr create`** — block all PR creation without `.claude/push-gate.json`. Simplest mental model. Rejected: full friction tax on every PR even when Claude is already careful; doesn't match the actual cost distribution of CI failures.
- [ ] **Option B: Soft counter with escalating warnings** — track CI failures per branch; warn at threshold, never hard-block. Rejected: doesn't actually enforce anything; relies on Claude/user honoring nudges.
- [x] **Option C (chosen): Two-layer gate** — reactive CI-failure gate for everyday iteration + narrow always-on gate for migrations and `/mainToProd`. Single bypass mechanism (`/approve-pr`) covers both.
- [ ] **Option D: Stop-hook only** — block session end (not PR creation) when an unverified PR exists. Rejected: false positives on legitimate "pause this until tomorrow" flows; doesn't stop the push-fail-push-fail iteration loop.

## Design Summary

**Two enforcement layers, one bypass mechanism, one unlock signal.**

### Threat model

These hooks defend against **Claude/user carelessness**, NOT against an adversarial actor. The gate files are JSON in the working tree; any of them can be hand-edited via `Write` to forge an unlock. That's a feature, not a bug — the override file (`.claude/ci-gate-override.json`) is deliberately editable and committed so its reason field lives in git log. The authoritative defenses against bad code reaching prod live elsewhere (CI, branch protection, `readonly_local` DB role, the staging migration deploy). What this project adds is a **friction layer** that catches the "I forgot to run /finalize" failure mode before it costs CI minutes or, worse, breaks staging schema. Future work should not over-invest in hardening gate-file integrity — that's not the threat model.

### Hook failure semantics (fail-open vs fail-closed)

Different paths fail differently based on blast radius:

| Path | On parse/tool error (`jq` missing, malformed gate file, `git` fails) | Why |
|---|---|---|
| High-blast (migrations / `--base production`) | **Fail CLOSED** (deny) | Mistakenly allowing a bad migration is worse than mistakenly blocking a good one. |
| Reactive (feature → main, CI failure observed) | **Fail OPEN** (allow), emit stderr warning | The reactive layer is a friction layer; false-deny is worse than false-allow because CI is a backstop. |
| `DISABLE_PR_GATE=true` honored | Always emit `stderr: "PR gate bypassed via DISABLE_PR_GATE"` | Audit trail in the transcript even though the env var itself doesn't persist anywhere. |

Both behaviors get explicit test cases (deliberately corrupt each gate file, run the hook, assert correct decision per path).

### Hook input contract (pin to stdin JSON)

The existing hooks have a contract drift: `block-push-without-gate.sh` reads `$TOOL_INPUT` env var; `scripts/test-bypass-safety-hooks.sh` pipes a JSON `{tool_input: {command: "..."}}` on stdin. The new hook (and the harness for it) **pin to stdin JSON** — matching the test harness style and the `check-workflow-ready.sh` pattern (`input=$(cat)`). Existing hooks that use `$TOOL_INPUT` will keep working (Claude Code provides both), but new code uses stdin. Documented in a one-line comment at the top of the new hook.

### Hook registration order

The new hook is registered AFTER `block-supabase-writes.sh` in `.claude/settings.json` (which is updated in Phase 1b with the `supabase db reset` carve-out). Order matters because all PreToolUse hooks fire in sequence and the *first* deny short-circuits; if `block-supabase-writes.sh` denies `supabase db reset` before its carve-out is added, `migration:verify` can't run. The plan ensures the carve-out edit and the new hook registration land in the same commit.

### /mainToProd integration

`/mainToProd` is the second writer of `.claude/push-gate.json` (the first is `/finalize`). Its Step 6 already writes the gate file before `gh pr create --base production`, so the existing flow continues to work under the new hook. The plan does NOT modify `/mainToProd`; we just verify by test that a fresh `mainToProd`-written gate file satisfies the new hook for a `--base production` PR. If integration tests reveal an issue (e.g., timing of the write vs PR-create), we patch `/mainToProd` in the same PR.

### State machine (per branch)

```
                           ┌───────────────────────┐
                  ┌───────▶│       OPEN            │◀─────────┐
                  │        │  (default; allow all) │          │
                  │        └───────────┬───────────┘          │
                  │                    │                      │
                  │      Stop hook observes CI FAILURE        │
                  │                    │                      │
                  │                    ▼                      │
                  │        ┌───────────────────────┐          │
                  │        │      CLOSED           │          │
                  │        │ (push + gh pr create  │          │
                  │        │     blocked)          │          │
                  │        └─┬──────────────┬──────┘          │
                  │          │              │                 │
       npm run test:gate     │              │   /approve-pr   │
       passes for HEAD       │              │   writes override
                  │          ▼              ▼                 │
                  │   ┌──────────┐   ┌─────────────┐          │
                  └───│ UNLOCKED │   │ OVERRIDDEN  │──────────┘
                      │ (allowed)│   │  (allowed)  │
                      └──────────┘   └─────────────┘
                                          │
                                  HEAD changes →
                                  override expires
```

### Gate files

| File | Written by | Purpose | Committed? |
|---|---|---|---|
| `.claude/push-gate.json` | `/finalize`, `/mainToProd` | Full check suite passed for HEAD. **Required for migration / production PRs.** | No (existing behavior) |
| `.claude/test-pass.json` | `npm run test:gate`, also as side-effect of `/finalize` | Test trio (unit + integration + E2E critical) passed for HEAD. **Unlocks CI-failure gate.** | No |
| `.claude/ci-gate.json` | `enforce-ci-monitoring.sh` (Stop hook) | Last observed CI status per branch. Marks branch as CLOSED on failure. | No |
| `.claude/ci-gate-override.json` | `/approve-pr` | User-explicit bypass: branch + SHA + reason. | Yes (audit trail in git log) |

### Hook logic at `gh pr create` (and `git push` to feature branch)

```
0. Fetch origin/main (with --quiet, ignore errors) so the migration-touch
   diff is computed against current upstream
1. If DISABLE_PR_GATE=true → allow (after emitting stderr audit line)
2. If on hotfix/* branch → allow (emergency carve-out)
3. Compute high-blast condition:
     diff = git diff origin/main..HEAD --name-only -- 'supabase/migrations/**'
     high_blast = (diff non-empty) OR (command contains '--base production')
4. If high_blast:
   4a. Require .claude/push-gate.json valid for HEAD → allow
   4b. Else: require .claude/ci-gate-override.json matches branch+HEAD → allow
   4c. Else: deny with message "Run /finalize first"
   4d. ON PARSE ERROR: fail CLOSED (deny). Migrations are too costly to fail-open on.
5. Otherwise (normal feature → main PR):
   5a. Read .claude/ci-gate.json for current branch
   5b. If missing OR corrupt OR last_observed_at > 10 min ago → trigger inline
       refresh: run `gh pr checks --json conclusion,status` with a 5s timeout
       and update the file. If gh fails or times out: fail OPEN with stderr
       warning ("CI gate state stale, allowing — re-run gh pr checks manually")
   5c. If branch status = OPEN → allow
   5d. If branch status = CLOSED:
       - test-pass.json valid for HEAD → allow (unlocked)
       - ci-gate-override.json matches branch+HEAD → allow (overridden)
       - Else: deny with message
   5e. ON PARSE ERROR: fail OPEN, emit stderr warning. CI is the backstop.
```

**No carve-out needed in `block-supabase-writes.sh`**: the shadow-DB approach uses Docker postgres directly (Phase 1b implementation pinned to this), so we never invoke `supabase db reset` and the existing hook stays as-is. This is a deliberate simplification — the original plan needed a flag-aware carve-out, but the Docker approach makes it unnecessary.

**Matcher strategy (pinned)** for the new `block-pr-create-without-gate.sh`:

```bash
# Pull command from stdin JSON (matches check-workflow-ready.sh contract)
input=$(cat)
COMMAND=$(echo "$input" | jq -r '.tool_input.command // ""')

# Block these (substring match, then refine):
# 1. gh pr create — block unconditionally on match
# 2. gh pr ready — block ONLY if --undo is NOT present
# 3. gh api with POST to *pulls* path
# 4. gh api graphql with payload containing "createPullRequest"
if [[ "$COMMAND" =~ gh[[:space:]]+pr[[:space:]]+create ]]; then
  IS_PR_CREATE=1
elif [[ "$COMMAND" =~ gh[[:space:]]+pr[[:space:]]+ready ]] && \
     [[ ! "$COMMAND" =~ --undo ]]; then
  IS_PR_CREATE=1
elif [[ "$COMMAND" =~ gh[[:space:]]+api ]] && \
     [[ "$COMMAND" =~ -X[[:space:]]+POST ]] && \
     [[ "$COMMAND" =~ /pulls(/|[[:space:]]|$) ]]; then
  IS_PR_CREATE=1
elif [[ "$COMMAND" =~ gh[[:space:]]+api[[:space:]]+graphql ]] && \
     [[ "$COMMAND" =~ createPullRequest ]]; then
  IS_PR_CREATE=1
else
  exit 0  # not a PR-create command; pass through
fi
```

This explicitly handles `gh pr ready --undo` (allowed), `gh api graphql ... query='{ pullRequests { ... } }'` reads (allowed because no `createPullRequest`), and `gh api repos/.../pulls/123` GETs (allowed because no `-X POST`).

---

## Phased Execution Plan

### Phase 0: Developer prerequisites (one-time per machine)

Docker is required by Phase 1b's `migration:verify`. Most developer machines need a one-time install. CI is unaffected — GitHub Actions Ubuntu runners ship with Docker pre-installed.

**Linux (Ubuntu/Debian):**
- [ ] `sudo apt-get update && sudo apt-get install -y docker.io`
- [ ] `sudo usermod -aG docker $USER`
- [ ] `newgrp docker` (or log out + back in) to apply group membership
- [ ] Verify: `docker run --rm hello-world` exits 0

**macOS:**
- [ ] `brew install --cask docker` (or download Docker Desktop installer)
- [ ] Launch Docker Desktop once to complete setup
- [ ] Verify: `docker run --rm hello-world` exits 0

**Windows:**
- [ ] Download Docker Desktop from docker.com and install
- [ ] Verify: `docker run --rm hello-world` exits 0

**Per-developer rollout:**
- [ ] Add a CLAUDE.md note about the Docker prerequisite (with the OS install lines above)
- [ ] `migration:verify` exits with clear "install Docker, or set MIGRATION_VERIFY_SKIP=true" message if Docker is absent (built into Phase 1b script — no separate handling needed)

### Phase 1: Narrow always-on gate (migrations + production)

Highest blast-radius surfaces first. This phase ships independently — even before the reactive gate lands, it closes the worst case (a migration-breaking PR merged without local verification).

**1a. The hook itself**

- [ ] Create `.claude/hooks/block-pr-create-without-gate.sh`
  - [ ] Intercepts `gh pr create`, `gh pr ready`, and `gh api repos/*/pulls -X POST` (substring match on `TOOL_INPUT`)
  - [ ] Allows `gh pr view|list|edit|checks|diff|comment|merge` (out-of-matcher)
  - [ ] Bypass on `hotfix/` branch
  - [ ] Detect "high-blast" condition: `git diff origin/main..HEAD --name-only -- 'supabase/migrations/**'` non-empty OR `--base production` in command
  - [ ] If high-blast: require `.claude/push-gate.json` matches HEAD, OR `.claude/ci-gate-override.json` matches branch+HEAD
  - [ ] Emit deny JSON in the existing `hookSpecificOutput` shape; exit 0
  - [ ] Honor `DISABLE_PR_GATE=true` env var as emergency kill switch
- [ ] Register hook in `.claude/settings.json` under `PreToolUse > Bash`

**1b. Local migration verification (NEW)**

The migration gate is only meaningful if `/finalize` actually validates migrations against the local DB. Today integration tests run against whatever state the local DB happens to be in — they don't catch "migration references a column that doesn't exist" the way replaying migrations from scratch does. This adds the missing check.

**Safety: don't wipe the user's local DB.** `supabase db reset` is destructive — it drops every table and replays migrations on a clean schema. If we ran that against the shared local container, every dev would lose seeded fixtures, in-progress demo data, and (worst case) data the running dev server depends on. The script therefore uses an **isolated shadow DB** approach, not `db reset` on the live local container.

- [ ] Create `scripts/verify-migrations-local.sh`
  - [ ] **Shadow DB implementation (pinned)**: spin up an **ephemeral Docker postgres container** on a random unused port, apply migrations via `psql`, tear down. This is independent of the user's live `supabase` local container, doesn't require the supabase CLI, and works identically locally and in CI (CI provisions postgres as a service container — see Phase 1d).
    - [ ] Command shape (in script — uses portable port picker, see Phase 2b for the `pick_port` function spec):
      ```bash
      SHADOW_PORT=$(pick_port) || exit 1
      CONTAINER_ID=$(docker run --rm -d -p ${SHADOW_PORT}:5432 \
        -e POSTGRES_PASSWORD=shadow -e POSTGRES_DB=postgres \
        postgres:15-alpine)
      trap "docker stop $CONTAINER_ID >/dev/null 2>&1" EXIT INT TERM
      # Wait for postgres ready, with iteration cap (30s = 150 × 0.2s)
      for _ in $(seq 1 150); do
        if docker exec "$CONTAINER_ID" pg_isready -q; then break; fi
        sleep 0.2
      done
      docker exec "$CONTAINER_ID" pg_isready -q || {
        echo "postgres failed to become ready in 30s" >&2
        exit 1
      }
      # Apply migrations in lexicographic order (matches supabase CLI's apply order)
      for migration in $(ls supabase/migrations/*.sql | sort); do
        psql "postgresql://postgres:shadow@localhost:${SHADOW_PORT}/postgres" \
          -v ON_ERROR_STOP=1 -f "$migration" || {
          echo "FAIL: $migration"
          docker exec "$CONTAINER_ID" psql -U postgres -c '\dt' >&2
          exit 1
        }
      done
      ```
      The SIGINT/SIGTERM in `trap` ensures the container is reaped even on Ctrl-C, addressing the iter-3 SIGINT-trap test case requirement.
    - [ ] If Docker is not installed → exit with clear "install Docker, or set `MIGRATION_VERIFY_SKIP=true` to bypass" message
    - [ ] If `MIGRATION_VERIFY_SKIP=true` env var is set → exit 0 with stderr warning (last-resort kill switch)
  - [ ] Fetch `origin/main` first (`git fetch origin main --quiet --depth=50`) so the migration set is accurate against current upstream
  - [ ] Apply ALL migrations in `supabase/migrations/` (lexicographic order), not just the diff — catches the "branch missing peer migration from main" case
  - [ ] Invoke `scripts/lint-migrations-idempotent.ts` against the diff (reuse the existing CI step's logic — the local check is stricter than the warn-only CI gate per the existing `migration-lint-bypass` label semantics)
  - [ ] Print clear pass/fail summary; on failure, print the failing migration filename + SQL error verbatim + recovery hint: "fix the migration, no rebase needed, re-run /finalize"
  - [ ] **No port-54322 guard needed** — the ephemeral postgres container uses a random ephemeral port (49152-65535), so it never collides with the user's live supabase on 54322 nor with any other local service
- [ ] Add `"migration:verify": "bash scripts/verify-migrations-local.sh"` to `package.json` scripts
- [ ] **No changes to `.claude/hooks/block-supabase-writes.sh` needed**: the Docker-based shadow DB approach uses `docker`, `psql`, and standard Unix utilities — not the `supabase` CLI — so the existing supabase write-blocking hook is unaffected. This is a side benefit of the Docker approach: we don't have to weaken any existing security carve-out.
- [ ] Update `.claude/commands/finalize.md` with new **Step 5.5** ("Migration Verification"):
  - [ ] Runs `npm run migration:verify` only when `git diff origin/main..HEAD --name-only -- 'supabase/migrations/**'` is non-empty
  - [ ] **Position is critical**: runs AFTER Step 5 (E2E Tests) and BEFORE Step 6 (Documentation Updates). Sequence: 4 Non-E2E Checks → 5 E2E → 5.5 Migration Verify → 6 Docs → 6.5 Commit → 6.6 Verify Clean → 7 Push & PR (writes push-gate.json + test-pass.json). Verifying before Step 6.5 means a failed migration is caught BEFORE the commit, and the fix lands in the same atomic commit alongside any test fixes — no awkward "fix migration after commit, then commit again" loop.
  - [ ] HARD GATE: if it fails, the existing Step 4-5 retry loop applies (fix migration, re-run from Step 5.5). On final failure: finalize stops, push-gate.json is not written.
  - [ ] **Rollback path**: deny message — "Migration verify failed at `<filename>`. Fix the migration in your editor, then re-run /finalize from Step 5.5. No rebase needed. Your live local DB was not touched — verification ran against an ephemeral Docker postgres." The Docker shadow-DB approach makes recovery zero-step.
- [ ] Shell test for the new script at `scripts/test-verify-migrations-local.sh`:
  - [ ] Case: clean migrations apply → exit 0
  - [ ] Case: deliberately-broken migration (references non-existent column) → exit non-zero with clear error
  - [ ] Case: non-idempotent DDL → exit non-zero (idempotency lint catches it)
  - [ ] Case: branch behind main (main has a migration not present locally) → fetches + applies in correct order
  - [ ] Case: multi-migration ordering (PR adds migration N+2 but missed N+1 from a peer) → exit non-zero with clear "missing migration" error
  - [ ] Case: live local supabase running on port 54322 → shadow-DB approach uses a random ephemeral port (49152-65535) and leaves the live DB completely untouched (assert by row-count before/after on the live DB)
  - [ ] Case: Docker not installed → exits with clear "install Docker, or set MIGRATION_VERIFY_SKIP=true" message
  - [ ] Case: `MIGRATION_VERIFY_SKIP=true` env var set → exits 0 with stderr warning ("migration verify skipped via MIGRATION_VERIFY_SKIP")
  - [ ] Case: Docker registry transient failure (pull fails) → exits with retry hint
  - [ ] Case: SIGINT during migration apply → trap fires, container is cleaned up (no orphan container)

**1c. Hook test harness**

- [ ] Shell test harness at `scripts/test-block-pr-create-without-gate.sh` (style: `scripts/test-bypass-safety-hooks.sh`)

  *Decision cases (deny / allow as expected):*
  - [ ] Case: migration-touching diff + no gate → deny
  - [ ] Case: migration-touching diff + valid gate → allow
  - [ ] Case: migration-touching diff + valid override → allow
  - [ ] Case: `--base production` + no gate → deny
  - [ ] Case: `--base production` + gate written by `/mainToProd` → allow (verifies /mainToProd integration)
  - [ ] Case: `--base main` + no migration + no gate → allow (Phase 1 only)
  - [ ] Case: `bash -c 'gh pr create'` → deny (substring match works)
  - [ ] Case: on `hotfix/x` branch → allow (regardless of gate state)
  - [ ] Case: `DISABLE_PR_GATE=true` → allow AND stderr emits audit line
  - [ ] Case: `gh api repos/foo/bar/pulls -X POST` + no gate → deny
  - [ ] Case: `gh api graphql -f query='mutation { createPullRequest ... }'` + no gate → deny (closer-to-hand REST/GraphQL bypass)
  - [ ] Case: `gh pr create --draft` + no gate (high-blast) → deny (drafts are still PRs)

  *False-positive prevention (all should ALLOW — the hook must not interfere with legitimate commands):*
  - [ ] Case: `gh pr view 123` → allow
  - [ ] Case: `gh pr list` → allow
  - [ ] Case: `gh pr edit 123 --add-label foo` → allow
  - [ ] Case: `gh pr checks` → allow
  - [ ] Case: `gh pr diff 123` → allow
  - [ ] Case: `gh pr comment 123 --body "x"` → allow
  - [ ] Case: `gh pr merge 123` → allow
  - [ ] Case: `gh pr ready --undo 123` → allow
  - [ ] Case: `gh api repos/foo/bar/pulls -X GET` → allow (read)
  - [ ] Case: `gh api repos/foo/bar/pulls/123` → allow (read)
  - [ ] Case: `git log | grep 'gh pr create'` → allow (substring in unrelated command)
  - [ ] Case: `gh pr comment 123 --body "remember to gh pr create next"` → allow (substring in body text)

  *Corrupt / malformed state (must deny on high-blast path, allow with warning on reactive path):*
  - [ ] Case: high-blast PR + malformed JSON in push-gate.json → deny (fail-closed)
  - [ ] Case: high-blast PR + missing `commit` field in push-gate.json → deny
  - [ ] Case: high-blast PR + push-gate.json SHA matches but for different branch → deny (push-gate is branch-agnostic by design, but worth confirming behavior)
  - [ ] Case: reactive path + malformed ci-gate.json → allow + stderr warning (fail-open)
  - [ ] Case: reactive path + missing ci-gate.json → trigger inline refresh; if `gh` succeeds, use result; if `gh` fails, allow + stderr warning
  - [ ] Case: reactive path + ci-gate.json `last_observed_at` > 10 min stale → inline refresh
  - [ ] Case: override with future-dated `approved_at` (clock skew or hand-edit) → deny (suspicious)
  - [ ] Case: override missing `commit` field → deny (malformed = deny)
  - [ ] Case: override `commit` matches HEAD but `branch` is different → deny

**1d. CI workflow validation for hooks (NEW)**

Add CI coverage for the hook scripts. Two jobs because one harness needs Docker for the shadow-DB postgres and the others don't.

- [ ] **Light job — `hook-tests`** (added to `.github/workflows/ci.yml`):
  - [ ] Triggers: `pull_request` to `main`, no path filter (the detect-changes pattern would skip docs-only PRs, which is fine — but we still want this job to run on every code PR)
  - [ ] `needs: detect-changes` (uses existing fast-path: skip if docs-only)
  - [ ] No service containers — pure shell tests
  - [ ] Executes: `bash scripts/test-bypass-safety-hooks.sh && bash scripts/test-block-pr-create-without-gate.sh && bash scripts/test-update-ci-gate.sh`
  - [ ] Fails build on any non-zero exit
  - [ ] Runs in parallel with existing lint/typecheck
- [ ] **Heavy job — `migration-verify-test`** (separate job, also added to `ci.yml`):
  - [ ] Triggers: when ANY of `supabase/migrations/**`, `scripts/verify-migrations-local.sh`, `scripts/lint-migrations-idempotent.ts`, `package.json` (the `migration:verify` script entry), or `.github/workflows/ci.yml` changes
  - [ ] Uses GitHub Actions' built-in `docker` (no extra setup needed — Ubuntu runners ship with Docker)
  - [ ] Adds a docker-pull-retry wrapper (1 retry with 5s backoff) to handle transient registry outages
  - [ ] Executes: `bash scripts/test-verify-migrations-local.sh`
  - [ ] Runs in parallel with other jobs (it's self-contained)
  - [ ] **NOT a required check for non-migration PRs** — uses GitHub's "only required when path changed" pattern (or status check is skipped via path filter). Branch protection must permit the conditional skip.
- [ ] Add `npm run test:hooks` wrapping `test-bypass-safety-hooks.sh + test-block-pr-create-without-gate.sh` (the light pair). Migration test stays separate as `npm run test:migration-verify`.
- [ ] **Two smoke tests for "are the hooks installed correctly"**:
  - [ ] In `test-block-pr-create-without-gate.sh`: parse `.claude/settings.json`, confirm `block-pr-create-without-gate.sh` is registered, confirm the script exists and is executable.
  - [ ] Same harness: confirm `update-ci-gate.sh` is registered as a separate Stop-hook entry (not inline-invoked from `enforce-ci-monitoring.sh`). Catches the iteration-2 bypass loophole regression if anyone reverts the split.

### Phase 2: Reactive CI-failure gate

Adds the everyday-iteration layer. The Stop hook becomes both an observer (existing behavior) AND a state writer (new).

**2a. State-writer split**

Mixing the read-only Stop blocker with state writes in a single hook risks one transient `gh` failure leaving the gate in a wrong state forever. Split the responsibilities — AND fix a bypass loophole found in iteration 2 review.

**Bypass loophole fix** (iteration-2 finding): `enforce-ci-monitoring.sh` currently early-returns on `hotfix|fix|docs|chore/` branches at line 9. If `update-ci-gate.sh` is invoked from there, it never runs for those branches — meaning the reactive gate is silently bypassed for `fix/`, `docs/`, `chore/` despite Phase 2c claiming they should be gated. Two-part fix:

- [ ] **Move the state writer to a separate Stop-hook entry in `.claude/settings.json`**, not inline-invoked from `enforce-ci-monitoring.sh`. Both hooks fire on Stop independently. The state writer applies the asymmetric bypass policy (only `hotfix/` exempt) while the Stop blocker keeps the existing broader bypass.
- [ ] **Document the asymmetry inline**: a comment in `update-ci-gate.sh` explains "we DON'T early-exit on fix|docs|chore — the whole point of Phase 2 is to gate those branches on the reactive path."

- [ ] Keep `.claude/hooks/enforce-ci-monitoring.sh` as the read-only Stop blocker (unchanged behavior, including its existing bypass list)
- [ ] Create `.claude/hooks/update-ci-gate.sh` as a parallel Stop-hook entry (not invoked from the other hook):
  - [ ] **Only `hotfix/` early-exits**, NOT `fix|docs|chore/`
  - [ ] Schema: `{branch, status: "open|closed|unknown", last_observed_at: ISO, last_observed_sha: HEAD-at-write-time, last_failure_commit: SHA, last_observation_source: "stop_hook"|"inline_refresh", schema_version: 1}`
  - [ ] Write `status: "closed"` on observed FAILURE
  - [ ] Write `status: "open"` only on observed all-SUCCESS (not on PENDING — pending stays at whatever the previous state was, with `last_observed_at` updated)
  - [ ] On `gh` failure or timeout: leave the file unchanged (do NOT clobber to "unknown"), but emit stderr line so the next inline-refresh path has a signal
  - [ ] **Atomic write**: always write to `.claude/ci-gate.json.tmp` then `mv` — matches `test-pass.json` convention. SIGINT trap deletes the `.tmp` file.
  - [ ] `schema_version` allows future migrations; the consumer hook treats unknown versions as untrusted (fail OPEN with warning on reactive path)
- [ ] Add a kill-switch: if `.claude/ci-gate.disabled` exists, both hooks no-op. Lets a user disable the reactive layer entirely without editing settings.json.
- [ ] **Dedicated test harness for `update-ci-gate.sh`** at `scripts/test-update-ci-gate.sh` (own harness because Stop-hook I/O contract differs from PreToolUse — no `tool_input.command`):
  - [ ] Case: observed FAILURE → file written with `status: "closed"` and matching SHA
  - [ ] Case: observed all-SUCCESS → file written with `status: "open"`
  - [ ] Case: observed PENDING → file unchanged (only `last_observed_at` updated)
  - [ ] Case: `gh` fails / times out → file unchanged, stderr emits warning (no clobber)
  - [ ] Case: on `fix/example` branch with CI failure → file written CLOSED (asymmetric bypass — only `hotfix/` exempt, regression test for the iter-2 loophole)
  - [ ] Case: on `hotfix/example` branch → script exits without writing
  - [ ] Case: `.claude/ci-gate.disabled` exists → script exits without writing
  - [ ] Case: SIGINT mid-write → trap fires, `.tmp` file deleted (no half-written state)
  - [ ] Case: schema_version field populated correctly in every write
  - [ ] Case: `last_observation_source: "stop_hook"` field populated correctly

**2b. Local test-pass tracker**

- [ ] Add `scripts/run-test-gate.sh` and `"test:gate": "bash scripts/run-test-gate.sh"` in `package.json`
- [ ] **Scope (pinned, stricter-than-CI)**: runs `lint`, `typecheck`, `test:esm`, `test` (unit full), `test:integration` (full), `test:e2e:critical`. This is a **stricter superset of CI-to-main**, not parity. Deltas, made explicit so future maintainers don't expect 1:1 parity:
  | Check | `test:gate` | CI to main | Local stricter? |
  |---|---|---|---|
  | Lint | full | full | same |
  | Typecheck | full | full | same |
  | ESM tests | full | full | same |
  | Unit tests | **full** | `--changedSince` (affected only) | **yes** |
  | Integration | **full** (31) | `:critical` (5) | **yes** |
  | E2E critical | `@critical` | `@critical` | same |
  | Build | — | — | (neither) |

  Rationale for stricter local: a CI failure caused by code that affects a test CI didn't run is exactly the failure mode the gate is reacting to. Running the full suite locally costs ~30s more but eliminates that class.

- [ ] **Run order and parallelism (pinned)**: default to **bash background-and-wait** with explicit exit-code aggregation (no extra deps required). `npm-run-all` is NOT currently a dev dep in this repo — confirmed by inspecting `package.json`. The plan does not add it.
  ```bash
  # Phase A — all independent, parallel
  npm run lint &        pid_lint=$!
  npm run typecheck &   pid_tc=$!
  npm run test:esm &    pid_esm=$!
  wait $pid_lint || exit 1
  wait $pid_tc   || exit 1
  wait $pid_esm  || exit 1
  # Phase B — unit + integration in parallel (different test DBs / mock layers)
  npm run test &              pid_unit=$!
  npm run test:integration &  pid_int=$!
  wait $pid_unit || exit 1
  wait $pid_int  || exit 1
  # Phase C — e2e:critical (requires running dev server; CI/local divergence)
  if [[ -z "$CI" ]]; then
    ./docs/planning/tmux_usage/ensure-server.sh
    npx tsx scripts/seed-admin-test-user.ts 2>/dev/null || true
  fi
  npm run test:e2e:critical || exit 1
  ```
- [ ] **Dev-server prerequisite**: Phase C calls `./docs/planning/tmux_usage/ensure-server.sh` (the project's canonical "ensure dev server up" entry point — per `CLAUDE.md`). The script is idempotent: starts a server if none, returns immediately if already running. **CI detection**: the script is invoked ONLY when `$CI` is unset (i.e., local). In CI, the workflow's existing `playwright.config.ts` `webServer` block handles server startup — no tmux available, and the existing pattern works. Without this CI check, `test:gate` would fail in CI environments because `ensure-server.sh` is tmux-backed.
- [ ] **Seed-user prerequisite**: `npx tsx scripts/seed-admin-test-user.ts` invoked locally (under same `$CI` check). In CI the test user is pre-seeded in the environment secrets. `|| true` defensively suppresses "already exists" errors. **The plan confirms `scripts/seed-admin-test-user.ts` exists** before relying on it — add to the implementation checklist as a verification step.
- [ ] **Port selection portability**: Phase 1b's shadow-DB port picker uses `shuf` which is GNU coreutils — present on Linux, absent on default macOS. The script must use a portable idiom:
  ```bash
  # Portable random port in 49152-65535 using $RANDOM + ephemeral-range modulo,
  # then probe-and-retry if the port is taken
  pick_port() {
    for _ in 1 2 3 4 5; do
      local p=$(( 49152 + RANDOM % 16384 ))
      if ! ss -tan 2>/dev/null | awk '{print $4}' | grep -q ":$p$"; then
        echo "$p"; return 0
      fi
    done
    echo "no free port found" >&2; return 1
  }
  SHADOW_PORT=$(pick_port) || exit 1
  ```
  On systems without `ss` (macOS), fall back to `lsof -iTCP:$p -sTCP:LISTEN` for the check. Document both.
- [ ] **Write timing — no Step 6.8, no re-run**: `test-pass.json` is written by two paths only:
  1. **Direct invocation** (`npm run test:gate`): writes at end of the script with current HEAD if all tests passed.
  2. **`/finalize` flow**: written at Step 7 alongside `push-gate.json`, using the in-memory results from Steps 4-5 (which already passed) and the post-Step-6.5-commit HEAD. **No re-run.** The working-tree contents that Steps 4-5 verified are bit-identical to what Step 6.5 committed — only the SHA changed — so a fresh test invocation would be wasteful and produce the same result. The Step-4-5-pass result + new HEAD = a valid `test-pass.json` with no Step 6.8 needed.

  This resolves the iteration-2/3 staleness concern without introducing duplicate test runs.
- [ ] Schema: `{commit: HEAD SHA, tests: [..canonical list..], passed_at: ISO, schema_version: 1}`. **Canonical `tests` list** (referenced by hook validation): `["lint", "typecheck", "test:esm", "test", "test:integration", "test:e2e:critical"]`. Missing any required test in the array → hook denies (catches partial-pass tampering).
- [ ] On failure: **atomically delete** any existing `.claude/test-pass.json` (write empty `.tmp`, then `mv` to remove; or `rm -f`)
- [ ] On interrupt (SIGINT): trap and delete the file (no orphaned "pass" state if user Ctrl-C's mid-run)

**2c. Hook integration**

- [ ] Extend `.claude/hooks/block-pr-create-without-gate.sh` with the reactive path (full pseudocode is in the Design Summary § "Hook logic" above; this just lists the test surface)
- [ ] Update `.claude/commands/finalize.md` **Step 7** (where push-gate.json is already written) to ALSO write `.claude/test-pass.json` in the same step. Both files use `$(git rev-parse HEAD)` for `commit`. The Step-4-5 test results carry over because no code changed between them and Step 6.5's commit. This is the canonical write site; Steps 4-5 do NOT write the file separately.
- [ ] Extend `.claude/hooks/block-push-without-gate.sh`:
  - [ ] After the existing main/production gate, add a feature-branch CLOSED-state check
  - [ ] **Branch-prefix bypass clarification**: the existing hook bypasses `hotfix|fix|docs|chore` BEFORE the gate check. For the new CLOSED-state check, ONLY `hotfix/` bypasses (this is intentional — the whole point of the project is that `fix/`, `docs/`, `chore/` should not be silent escape hatches). Document the asymmetry inline.

**2d. Test coverage**

- [ ] Add test cases to `scripts/test-block-pr-create-without-gate.sh`:
  - [ ] Case: ci-gate.json OPEN + no test-pass.json → allow
  - [ ] Case: ci-gate.json CLOSED + no test-pass.json → deny
  - [ ] Case: ci-gate.json CLOSED + test-pass.json matching HEAD → allow
  - [ ] Case: ci-gate.json CLOSED + test-pass.json stale (SHA mismatch) → deny
  - [ ] Case: ci-gate.json CLOSED + valid override → allow
  - [ ] Case: ci-gate.json CLOSED + `.claude/ci-gate.disabled` exists → allow (kill switch)
  - [ ] Case: ci-gate.json present but `schema_version: 99` (unknown) → fail OPEN + stderr warning
  - [ ] Case: ci-gate.json `last_observed_at` 11 min ago + branch CLOSED → triggers inline refresh
  - [ ] Case: inline refresh `gh` times out → fail OPEN + stderr warning
  - [ ] Case: test-pass.json with all expected `tests` array entries → allow; missing required tests → deny (catches partial-pass tampering)

### Phase 3: Escape hatch (`/approve-pr`)

Single user-explicit bypass for both layers. **Must ship before Phase 1 lands in production** — otherwise during the Phase 1→3 gap, migration PRs have no escape hatch and the only way out is `DISABLE_PR_GATE=true`. Practical rollout: Phase 1 + Phase 3 land in the same PR; Phase 2 can follow in a separate PR.

- [ ] Create `.claude/commands/approve-pr.md`
  - [ ] Frontmatter: `description`, `argument-hint: (none)`, `allowed-tools: Bash(git:*), Read, Write, AskUserQuestion`
  - [ ] Step 1: refuse on `main`/`production`; silent exit on `hotfix/*`
  - [ ] Step 2: check for existing valid override → display and exit
  - [ ] Step 3: AskUserQuestion with options "Skip verification — I accept the risk" / "Cancel, run /finalize instead"
  - [ ] Step 4: plain-chat prompt for one-line reason (ends turn, zero tool calls). Reject empty/whitespace-only reasons with a re-prompt.
  - [ ] Step 5: write `.claude/ci-gate-override.json` with `{branch, commit: HEAD SHA, reason, approved_at: ISO, approved_by: git config user.email, schema_version: 1}`
  - [ ] Step 6: auto-commit `chore: approve PR skip — <reason>` (the reason field in the commit message is the load-bearing audit trail)
  - [ ] Step 7: print next steps
- [ ] Override semantics in the hook: keyed by branch + HEAD SHA. New commits invalidate (the user only approved *that* SHA). SHA-keyed, not time-windowed (chosen — see resolved decision below).
- [ ] **Worktree caveat**: the override file is committed, so it propagates to any worktree that rebases/merges this branch. That's fine because the SHA-key still gates validity — the override only applies to the exact SHA the user approved. Document this in the deep-dive doc.
- [ ] **Naming consistency**: existing commands use `camelCase` for multi-word (`mainToProd`, `pushForLocalViewing`) and `lowercase` single-word (`finalize`). We choose `approve-pr` (kebab-case) consciously because (a) `gh pr create` is the action it's parallel to, and `gh` uses kebab-case; (b) `approvePR` reads worse than either alternative. Document in `project_workflow.md`.
- [ ] Test cases (added to the existing harness):
  - [ ] Case: override exists for branch + HEAD → allow regardless of other gates
  - [ ] Case: override exists for branch but HEAD changed → deny (stale override)
  - [ ] Case: override for different branch → deny
  - [ ] Case: override JSON malformed → deny (fail-closed for any path that depends on override validity)
  - [ ] Case: override missing `commit` field → deny
  - [ ] Case: override missing `branch` field → deny
  - [ ] Case: override missing `reason` field → deny (audit trail is the *point*; reject incomplete overrides)
  - [ ] Case: override `approved_at` parses as future date → deny (clock skew or hand-edit)
  - [ ] Case: override `schema_version: 99` (unknown future schema) → deny (treat unknown as untrusted)
  - [ ] Case: override with whitespace-only reason → deny (the slash command catches this earlier, but the hook validates defensively)

### Phase 4: Documentation

- [ ] Update `docs/docs_overall/project_workflow.md` § "Step 8: Push & PR" with the new gate model
- [ ] Update `CLAUDE.md` if any default-defaults reference the old behavior
- [ ] Add a brief reference section to `docs/docs_overall/testing_overview.md` near the existing "Check Parity" table, explaining the new `npm run test:gate` command
- [ ] Consider a new deep-dive doc at `docs/feature_deep_dives/pr_verification_gate.md` covering the full state machine + bypass mechanism (decide during Phase 4; may be over-documenting)

### Phase 5: Known gaps (deferred)

- [ ] **Document, do not build**: Playwright MCP can drive github.com to create a PR via the UI. The hook does not catch this. Accepted as out-of-scope for v1 (requires Claude *and* user to be careless simultaneously). Note in `pr_verification_gate.md` if that doc is added in Phase 4.

---

## Testing

### Unit Tests
- [ ] `scripts/test-block-pr-create-without-gate.sh` — table-driven shell tests covering all gate paths (~52 cases enumerated: ~32 in Phase 1c + ~10 in Phase 2d + ~10 in Phase 3 — decision cases, false-positive prevention, corrupt-state handling, bypass loophole regression test)
- [ ] `scripts/test-verify-migrations-local.sh` — table-driven shell tests for Phase 1b shadow-DB script (~10 cases listed in Phase 1b — clean apply, broken migration, non-idempotent, branch behind main, ordering, live-DB safety, Docker missing, MIGRATION_VERIFY_SKIP, registry failure, SIGINT)
- [ ] `scripts/test-update-ci-gate.sh` — dedicated harness for the Stop-hook state writer (~10 cases listed in Phase 2a — FAILURE/SUCCESS/PENDING writes, gh failure, asymmetric bypass regression, hotfix exit, kill switch, SIGINT, schema fields)
- [ ] `scripts/test-bypass-safety-hooks.sh` — existing harness, unchanged but newly run in CI

### Integration Tests
- [ ] End-to-end test in a scratch worktree:
  - [ ] Create a `feat/test-pr-gate` branch, modify a migration file, attempt `gh pr create` without `/finalize` → expect deny
  - [ ] Run `/finalize` (or stub out the heavy parts and just write a valid `push-gate.json`) → `gh pr create` allowed
  - [ ] Trigger a CI failure (push a deliberately-broken commit), wait for `enforce-ci-monitoring.sh` to write CLOSED state → `gh pr create` blocked again
  - [ ] Run `npm run test:gate` → re-allowed

### E2E Tests
- [ ] N/A — this is CLI/hook infrastructure, not user-facing UI. No Playwright spec needed.

### Manual Verification
- [ ] On a real feature branch with a small migration change, run `gh pr create` cold (no `/finalize`) and confirm clear deny message pointing at the right next step.
- [ ] On a real feature branch without a migration, push code that will fail CI, watch the Stop hook write CLOSED, confirm next `gh pr create` is blocked.
- [ ] Run `/approve-pr` with a sample flaky-test reason, confirm `gh pr create` is allowed and the override commit appears in `git log`.
- [ ] On `hotfix/test` branch, confirm all paths are allowed unconditionally.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI

### B) Automated Tests
- [ ] `bash scripts/test-block-pr-create-without-gate.sh` exits 0 with all cases passing
- [ ] `npm run lint` clean (no shell files lint-checked, but settings.json must parse)
- [ ] `npm run typecheck` clean
- [ ] `npm run build` clean (this work doesn't touch app code, but verify nothing is shadowed)

## Documentation Updates

- [ ] `docs/docs_overall/project_workflow.md` — Step 8 updated with new gate model
- [ ] `CLAUDE.md` — any references to the old push-gate-only behavior updated; add note about `npm run test:gate` and `/approve-pr`
- [ ] `docs/docs_overall/testing_overview.md` — add `test:gate` row to the Check Parity table with the "stricter than CI" framing
- [ ] `docs/feature_deep_dives/pr_verification_gate.md` — **required, not optional** (per resolved decision). Contains: the state machine diagram, the 4-file gate model, every kill switch, the worktree caveat, the bypass policy asymmetry, and the Playwright MCP known gap from Phase 5

## .gitignore Updates

- [ ] Add to `.gitignore`:
  - `.claude/ci-gate.json` (per-machine state; gitignored)
  - `.claude/test-pass.json` (per-machine; gitignored)
  - `.claude/ci-gate.disabled` (per-machine kill switch; gitignored)
- [ ] Do **NOT** gitignore `.claude/ci-gate-override.json` — that one IS committed (audit trail in git log)
- [ ] Do **NOT** gitignore `.claude/push-gate.json` — existing behavior (already gitignored per current state)

## Review & Discussion

_(populated by `/plan-review` with agent scores, reasoning, and gap resolutions)_

## Resolved Decisions

- [x] **Override semantics**: SHA-keyed, no time window. New commits invalidate; simpler, stricter, no clock-skew risk.
- [x] **`test:gate` scope**: lint + typecheck + ESM + unit (full) + integration (full) + E2E critical. **Stricter than CI-to-main**, not parity — local runs full unit/integration where CI uses `--changedSince`/`:critical`. Costs ~30s more but eliminates the "CI ran a subset, missed a regression" failure mode the gate is reacting to. Excludes `build` (CI to main also skips it; the heavier `/finalize` flow runs build).
- [x] **Phase 4 dedicated doc**: write `docs/feature_deep_dives/pr_verification_gate.md`. The state machine spans 4 gate files, 3 hooks, 2 slash commands — too much for a `project_workflow.md` aside. Future maintainers need the map in one place.
- [x] **Phase 1 + 3 ship together**: Phase 1's hook denies migration PRs without `push-gate.json`; without Phase 3, the only bypass is `DISABLE_PR_GATE=true`, which is too blunt. Land Phases 1 + 3 in the same PR. Phase 2 can follow.
- [x] **Branch-prefix bypass policy**: only `hotfix/` bypasses the new hook. `fix/`, `docs/`, `chore/` are gated. This is asymmetric vs `block-push-without-gate.sh` (which bypasses all four). Asymmetry is intentional — closes a real loophole.
- [x] **migration:verify uses shadow DB**, never `db reset` on live local container. Prevents silent data loss for users with seeded fixtures.
