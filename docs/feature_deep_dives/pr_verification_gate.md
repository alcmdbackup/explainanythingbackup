# PR Verification Gate

The PR-creation gate prevents Claude from opening PRs with unverified code, while preserving a deliberate user-controlled escape hatch. It supplements (not replaces) the existing push gate (`block-push-without-gate.sh`) which guards `git push` to `main`/`production`.

## Quick reference

| File | Written by | Read by | Committed |
|---|---|---|---|
| `.claude/push-gate.json` | `/finalize` Step 7, `/mainToProd` Step 6 | `block-push-without-gate.sh`, `block-pr-create-without-gate.sh` (high-blast path) | No (gitignored) |
| `.claude/test-pass.json` | `/finalize` Step 7 | `block-pr-create-without-gate.sh` (reactive path) | No (gitignored) |
| `.claude/ci-gate.json` | `update-ci-gate.sh` Stop hook | `block-pr-create-without-gate.sh` + `block-push-without-gate.sh` (reactive path) | No (gitignored) |
| `.claude/ci-gate-override.json` | `/approve-pr` | `block-pr-create-without-gate.sh` (both paths) | **Yes** (audit trail) |
| `.claude/ci-gate.disabled` | User (manual touch) | `block-pr-create-without-gate.sh` (reactive path only) | No (gitignored) |
| `.claude/safe-to-close-verdict.json` | `/safe_to_close` Phase 6 | (audit only — no hook consumes it) | No (gitignored) |

`/safe_to_close` reads `push-gate.json`, `test-pass.json`, and `ci-gate.json` (per its Phase 3) to verify that `/finalize` has run on the current commit before declaring a branch safe to close.

## Two enforcement paths

### High-blast (always-on)

Triggers when a PR creation command:
- Diff includes `supabase/migrations/**` files, OR
- Command contains `--base production` (any quoting form)

**Behavior**: fail CLOSED. Requires `.claude/push-gate.json` matching HEAD (written by `/finalize`/`/mainToProd` after all checks passed) OR `.claude/ci-gate-override.json` matching branch+HEAD (written by `/approve-pr`). Any parse error, missing file, SHA mismatch → deny.

**Rationale**: a broken migration breaks staging schema and poisons unrelated authors' CI runs. A regression in a production-targeting PR ships to users. The first failure is too expensive to absorb, so we always require local verification.

### Reactive (fail-open by default)

Triggers when a PR creation command does NOT meet high-blast conditions (i.e., normal feature → main PRs).

**Behavior**: fail OPEN. Only denies when `.claude/ci-gate.json` says the branch is `CLOSED` (set by the Stop-hook observer when it sees a CI failure). Unlocked by `.claude/test-pass.json` matching HEAD OR a matching override.

**Rationale**: 95% of PRs aren't migration- or prod-related. For those, CI is a sufficient safety net for the *first* failure (the cost is some wasted CI minutes, recoverable on the next push). What we want to prevent is the push-fail-push-fail cycle of carelessness — that's what the reactive gate catches.

## Matcher: what's intercepted

The hook intercepts these commands (substring match on `tool_input.command`):

| Command shape | Intercepted? | Notes |
|---|---|---|
| `gh pr create` | Yes | Direct match |
| `gh pr ready` | Yes (unless `--undo` present) | `gh pr ready --undo` is reverting, not creating |
| `gh api repos/.../pulls -X POST` | Yes | REST API bypass |
| `gh api graphql` + `createPullRequest` in payload | Yes | GraphQL mutation bypass |
| `bash -c "gh pr create ..."` | Yes | The wrapped command is detected even though it's quoted |
| `gh pr view` / `list` / `edit` / `checks` / `diff` / `comment` / `merge` | No | Read-only or post-create operations |
| `gh api repos/.../pulls` (no `-X POST`) | No | GET request, read-only |
| `gh pr comment --body "remember to gh pr create"` | No | Quote-stripped before match (avoids false-positives on body text) |
| `git log \| grep 'gh pr create'` | No | Same — quoted argument is data, not a command |

## Bypass mechanisms

In escalating order of "deliberateness":

1. **`hotfix/*` branches** — bypass all paths automatically. Emergency carve-out for production incidents.
2. **`/approve-pr` slash command** — writes `.claude/ci-gate-override.json` keyed by branch + HEAD SHA, with a captured reason, auto-committed. Audit trail in `git log` forever. Override invalidates as soon as HEAD changes (any new commit).
3. **`DISABLE_PR_GATE=true gh pr create ...`** — one-shot env var, emits `PR gate bypassed via DISABLE_PR_GATE` to stderr. Works as both an exported var and as an inline command-line var.
4. **`.claude/ci-gate.disabled` file** — disables only the reactive layer (high-blast still enforced). Touch the file to enable, delete to re-enable enforcement.

## Threat model

These hooks defend against **Claude/user carelessness**, NOT against an adversarial actor. The gate files are plain JSON in the working tree; any of them can be hand-edited via `Write` to forge an unlock. The override file is deliberately editable and committed precisely so its reason field lives in git log.

The authoritative defenses against bad code reaching prod live elsewhere:
- CI (`ci.yml`) — runs lint, typecheck, integration, E2E critical
- Branch protection — requires green CI before merge
- DB `readonly_local` role — prevents accidental DB writes from tests
- Staging migration deploy (`supabase-migrations.yml`) — catches schema errors

What this gate adds is a **friction layer** that catches the "I forgot to run /finalize" failure mode earlier in the cycle, before it wastes CI minutes or breaks staging.

## Worktree behavior

Each git worktree has its own `.claude/` directory inside its working tree, so gate files don't bleed across worktrees:
- `.claude/push-gate.json`, `.claude/test-pass.json`, `.claude/ci-gate.json` — per-worktree, gitignored, never shared
- `.claude/ci-gate-override.json` — **committed**, so it follows the branch. If you merge a branch carrying an override into another, the override travels with it. But the SHA key still gates validity — the override only applies to its exact original commit.

## Known gap (Phase 5 — accepted)

The Playwright MCP can drive `github.com` directly via browser automation to create a PR through the web UI. The Bash matcher can't intercept that. This is accepted as a permanent gap: the gap only opens when BOTH (a) Claude is operating the browser without the user noticing, AND (b) the user explicitly instructed it to "go to github and make a PR." Both conditions are required, so the gap is small in practice. If a real exploit surfaces, revisit.

## How to recover from each blocked state

| You hit | Recovery |
|---|---|
| "PR creation blocked: migration-touching" | Run `/finalize` (it now includes Step 5.5 migration verification). If migration verify fails, fix the SQL, re-run `/finalize` from Step 5.5. |
| "PR creation blocked: production target" | Run `/mainToProd` (writes push-gate as part of its flow). |
| "PR creation blocked: known CI failure" | Either `npm run test:gate` (Phase 2 — runs the local check trio) or `/approve-pr` with a reason explaining why you're shipping despite the CI red. |
| Docker not installed (migration verify) | See CLAUDE.md install commands. Last resort: `MIGRATION_VERIFY_SKIP=true npm run migration:verify`. |
| Hook is broken (denies everything) | `DISABLE_PR_GATE=true gh pr create ...` for one-shot. Or comment out the hook line in `.claude/settings.json`. |

## Implementation files

**Hooks:**
- `.claude/hooks/block-pr-create-without-gate.sh` — the PR-creation gate (PreToolUse Bash matcher)
- `.claude/hooks/update-ci-gate.sh` — Stop hook that observes CI state and writes `ci-gate.json`. **Asymmetric bypass**: only `hotfix/` exempt (NOT `fix|docs|chore`) — this closes the loophole flagged in plan-review iteration 2.
- `.claude/hooks/block-push-without-gate.sh` — extended to gate feature-branch pushes when `ci-gate.json` is CLOSED (same asymmetric bypass)

**Slash commands:**
- `.claude/commands/approve-pr.md` — escape hatch (writes audit-trail override)
- `.claude/commands/finalize.md` — Step 5.5 (migration verify) + Step 7 also writes test-pass.json

**Scripts:**
- `scripts/verify-migrations-local.sh` — Docker postgres shadow-DB migration runner (`npm run migration:verify`)
- `scripts/run-test-gate.sh` — `npm run test:gate` — runs the local check trio + writes test-pass.json
- `scripts/test-block-pr-create-without-gate.sh` — 49 cases
- `scripts/test-verify-migrations-local.sh` — ~10 cases (Docker-skip if absent)
- `scripts/test-update-ci-gate.sh` — 19 cases (stubs `gh` via PATH override)

**CI:**
- `.github/workflows/ci.yml` — `hook-tests` (light) + `migration-verify-test` (Docker) jobs

## Related

- `block-push-without-gate.sh` — the original push gate (this hook's sibling)
- `enforce-ci-monitoring.sh` — Stop-hook that blocks Claude from ending sessions while PR CI is failing
- [project_workflow.md](../docs_overall/project_workflow.md) § Step 8
- [testing_overview.md](../docs_overall/testing_overview.md) § Check Parity
