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

## Code Files Read

- .claude/commands/initialize.md — the file being modified in task 2
- .claude/commands/finalize.md — pattern source for verification-gate aggregation, checkbox scan (Step 1b.5)
- .claude/commands/mainToProd.md — pattern source for backport/post-deploy reasoning
