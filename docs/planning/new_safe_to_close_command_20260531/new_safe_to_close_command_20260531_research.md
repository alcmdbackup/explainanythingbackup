# New Safe-to-Close Command Research

## Problem Statement
Help me do two things:
1. Create a new command called `/safe_to_close` which verifies that no open PRs exist on GitHub across all worktrees, no outstanding items remain from plan or `/finalize` (especially post-deploy migrations or backports), updates research/planning/progress docs with all discussions, and returns GREEN (good to close) or RED (open items) — flagging items requiring user decision.
2. Update `/initialize` so that by default it always reads `environments.md`, `testing_overview.md`, `testing_setup.md`, and `docs/docs_overall/debugging.md` — without being asked.

## Requirements (from GH Issue #1148)
Help me do two things

1. Create a new command called "safe_to_close" which does the following:
   - Verify no more open PRs on GH, across all worktrees
   - Verify no more outstanding items from plan or /finalize
     - Especially post deploy migrations or backports
   - Update research, planning, progress docs with all discussions
   - Give Green for good to close, or Red for open items
   - Flag what open items if any, if user needs to decide

2. Add so that for /initialize, it always reads environments.md, testing_overview.md, testing_setup.md, and @docs/docs_overall/debugging.md by default, without being asked

## High Level Summary

The `/safe_to_close` command will codify the "is the work actually done?" question that currently lives in the user's head into a deterministic checklist. The four signals it must aggregate:

1. **GitHub PR state across worktrees** — `git worktree list` exposes ~16 worktrees in `~/Documents/ac/`. Each may have a branch with an associated GH PR. `gh pr list --author @me --state open --json ...` returns the authoritative set. Cross-reference each worktree's `HEAD` branch against the open-PR list and flag any branch that still has an open PR, or any worktree whose branch was merged to `main` but not yet promoted to `production` (the latter is the backport case).

2. **Plan checkbox completeness** — `/finalize` Step 1b.5 already implements code-fence-aware checkbox scanning across `_planning.md` files. The safe-to-close command should run the same scan against every active project's planning doc (or at minimum the current branch's plan), flagging any `- [ ]` items. It should also confirm `_progress.md` exists and was updated.

3. **`/finalize` artifacts** — `finalize` writes `.claude/push-gate.json` and `.claude/test-pass.json` (per `pr_verification_gate.md`). Their presence + a matching HEAD SHA confirms finalize ran on the current commit. Absence means the branch was never finalized → RED.

4. **Post-deploy migrations + backports** — two distinct concerns:
   - **Post-deploy migrations**: `environments.md` documents that production migrations deploy only when the `production` branch is pushed (via `/mainToProd`). A migration that landed on `main` but did not get promoted to `production` is silently drifting. The check is: any `supabase/migrations/*.sql` file present on `origin/main` but not on `origin/production`. The 62-day silent drift documented in `environments.md` is the cautionary tale.
   - **Backports**: branches whose PRs merged to `main` but were not yet merged to `production` (i.e., `git log origin/main ^origin/production --oneline` non-empty). These accumulate between releases. Long gaps compound migration-failure risk (5-vs-56-migration queue argument in `environments.md`).

5. **Doc updates** — the command's name says "safe to close" — the contract is also that any open discussions or decisions made during this session get written back into the project's research/planning/progress docs before closing. This is the part most likely to be forgotten; the command should grep its own conversation context (or at minimum prompt the user) and append a "Closing discussions" section to `_progress.md`.

### `/initialize` default-doc change (task 2)

Currently `/initialize` reads three core docs unconditionally (getting_started, architecture, project_workflow) and then auto-discovers + asks. The change is small: add the four named docs (`environments.md`, `testing_overview.md`, `docs/feature_deep_dives/testing_setup.md`, `debugging.md`) to the unconditional read list in Step 2.5. They should still appear in `_status.json.relevantDocs` so `/finalize`'s doc-update pass picks them up. Also pre-populate the auto-discovery exclusion list so the Explore agent doesn't re-suggest them.

### Existing slash commands modeled

Nine commands already exist in `.claude/commands/`: `debug.md`, `finalize.md`, `initialize.md`, `mainToProd.md`, `plan-review.md`, `plan-update.md`, `research.md`, `summarize-plan.md`, `user-test.md`. The closest structural model for `safe_to_close` is `finalize.md` — both aggregate multiple verification signals and produce a final verdict. The closest model for the new "doc-update" sub-step is `mainToProd.md` Step 7 (verify + cleanup).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### User-Tagged Default Docs (to be added to `/initialize` defaults — task 2)
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (discovered for `/safe_to_close` design — task 1)
- docs/feature_deep_dives/pr_verification_gate.md
- docs/feature_deep_dives/maintenance_skills.md
- docs/feature_deep_dives/iterative_planning_agent.md
- docs/docs_overall/managing_claude_settings.md
- docs/docs_overall/instructions_for_updating.md

### Postmortem Docs Mined (R2D forensic round)
- docs/planning/smoke_test_and_nightly_e2e_failing_20260523/ — primary 62-day prod drift postmortem; 73-migration backlog blocked by single non-idempotent `ADD CONSTRAINT` in `20260322000003`; Phases 1-8 with 3-iteration plan-review
- docs/planning/nightly_e2e_still_failing_20260530/ — 5-night Firefox NS_BINDING_ABORTED streak postmortem; introduced `.claude/nightly-red-override.json` schema (the model for our `.claude/safe-to-close-verdict.json`), auto-filed release-health issues, `/mainToProd` nightly-red precheck

## Code Files Read

- .claude/commands/initialize.md — the file being modified in task 2 (precise line-by-line edits documented in plan Phase 8)
- .claude/commands/finalize.md — pattern source for verification-gate aggregation; verbatim source for code-fence-aware checkbox scan (Step 1b.5)
- .claude/commands/mainToProd.md — pattern source for backport/post-deploy reasoning; release-PR query
- .claude/hooks/block-push-without-gate.sh (via `git show origin/main:...`) — confirmed `push-gate.json`, `test-pass.json`, `ci-gate.json` schemas + the `(hotfix|fix|docs|chore)/` bypass regex

## Key Round-1 / Round-2 Findings (load-bearing for the plan)

- **Worktree topology** — 15 worktrees total, 7 are placeholder slots (`git_worktree_37_9..15` on `c02f9cfd`); filter via regex on branch name.
- **`gh pr list` semantics** — `--author @me --state open` returns all worktree-relevant PRs in one call; `isDraft` field exists; PR age via `updatedAt`. 30-day age cutoff distinguishes active from stale.
- **Gate JSON schemas (verified):**
  - `push-gate.json`: `{commit, skill, timestamp}` — commit must match HEAD exactly
  - `test-pass.json`: `{commit, tests[], passed_at, schema_version}` — tests array ≥6 required
  - `ci-gate.json`: `{branch, status: open|closed|unknown|pending, last_observed_sha, schema_version}` — explicit color map needed (R2A #5)
- **Planning-doc resolution** — `grep -Frl "\"branch\": \"$BRANCH\"" docs/planning/*/_status.json | sort -V | tail -1` is more reliable than the /finalize three-path lookup; falls back to it only on zero matches.
- **Template-placeholder checkboxes** — `_planning.md` template contains `- [ ] [Actionable item ...]` literal-bracket placeholders; must filter `^- \[ \] \[.*\]$` from unchecked count (R2A #9).
- **Migration drift check** — `git diff --name-only origin/production..origin/main -- 'supabase/migrations/*.sql'` is correct (file-presence, not schema-aware; documented as known limitation). Verified empty on this fresh-off-main branch.
- **Release cadence** — environments.md documents 2-week cadence as the rule; observed actual cadence in May 2026 is median 2 days, mean 5.1 days, max 17 days. RED threshold calibrated to observed max (17 days), not documented (14 days).
- **Post-merge verification banner** — referenced in environments.md but NOT actually implemented in `/finalize` or `/mainToProd`. `/safe_to_close` does not depend on it; writes its own state file (`.claude/safe-to-close-verdict.json`) modeled on the existing `.claude/nightly-red-override.json` schema.
- **Slash-command auto-discovery** — no `.claude/settings.json` change needed; commands are picked up from `.claude/commands/*.md` automatically (R1D §5).
- **Transcript files** — persisted at `~/.claude/projects/<project>/*.jsonl` but the harness does NOT expose them. The doc-update step in Phase 7 derives "discussions" from git log + planning-doc "Review & Discussion" + one AskUserQuestion, not from transcripts.
- **Hotfix carve-out** — `(hotfix|fix|docs|chore)/` branches bypass the push gate (per `block-push-without-gate.sh`), but hotfixes still go through main before production. No need for an inverse `git log production ^main` check.

## Known Limitations (Documented Inline in the Command)

- File-presence migration check (not schema-aware) — false positives possible on add-then-delete; tradeoff: prefers safety over precision.
- Reused branch names — when multiple `_status.json` files reference the same branch, picks the most recently created folder via `sort -V | tail -1`.
- Transcript-based discussion capture is impossible (harness limitation) — Phase 7 uses git log + plan section + one user prompt instead.
- /safe_to_close does not gate on Claude Code presence — runs as plain bash + gh + git so users on other harnesses can invoke the same checks.
