# New Safe-to-Close Command Plan

## Background
Two related chores: (1) create a new `/safe_to_close` slash command that aggregates four close-readiness signals (no open GH PRs across worktrees; no unchecked items in active plans; no `/finalize` outstanding items; no un-promoted post-deploy migrations or backports) and writes the closing discussion back into research/planning/progress docs before returning GREEN or RED; and (2) update `/initialize` so it unconditionally reads `environments.md`, `testing_overview.md`, `docs/feature_deep_dives/testing_setup.md`, and `docs/docs_overall/debugging.md` on every run, without auto-discovery or asking.

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

## Problem
The current process for deciding "is this work actually done?" is implicit and lives in the user's head — open PRs in other worktrees get forgotten, plan checkboxes go un-ticked, `/finalize` artifacts get out of sync, and (most consequentially) migrations that land on `main` can sit un-promoted to `production` for weeks (see the 62-day silent prod-schema drift in `environments.md`). Separately, `/initialize` currently asks the user to confirm common docs every run, when four of them (env/testing/debugging) are needed on every project regardless — wasting attention and inviting "Skip" answers.

## Options Considered

- [ ] **Option A: Single command, single pass** — `/safe_to_close` runs all checks inline, prints one verdict block, exits. Simplest, matches `/finalize` style. Trade-off: linear runtime (~30-60s for `gh pr list` + worktree scan + migration diff). Recommended.
- [ ] **Option B: Sub-commands** — `/safe_to_close prs`, `/safe_to_close migrations`, `/safe_to_close docs` for targeted checks. More flexible but adds surface area and command-doc maintenance. Reject — premature subdivision.
- [ ] **Option C: Read-only verdict + separate `/safe_to_close --update-docs`** — split the verdict from the doc-update mutation. Cleaner but the user asked for both in one command. Reject.

**Selected: Option A** with a `--dry-run` flag to skip the doc-update mutation when the user just wants the verdict.

## Phased Execution Plan

### Phase 1: `/safe_to_close` command spec
- [ ] Create `.claude/commands/safe_to_close.md` with frontmatter (`description`, `argument-hint`, `allowed-tools: Bash(git:*), Bash(gh:*), Read, Edit, Write, AskUserQuestion, Task`)
- [ ] Define the four-section verdict block (PRs / Plan items / Finalize artifacts / Migrations & backports) modeled on `/finalize` Step 0d display
- [ ] Define GREEN vs RED rules: GREEN = all four sections clear; RED = any section has open items; YELLOW (display only — still counts as RED) = sections with items needing user decision

### Phase 2: PR scan across worktrees
- [ ] `git worktree list --porcelain` to enumerate worktrees + their branches
- [ ] `gh pr list --author @me --state open --json number,title,headRefName,baseRefName,url` once (per-worktree calls are wasteful — single query covers all)
- [ ] For each worktree branch, mark as RED if it has an open PR; YELLOW if branch is merged to `main` but not promoted to `production`
- [ ] Special-case the current worktree (the one running the command) — its branch's open PR is expected and flagged differently

### Phase 3: Plan + finalize-artifact scan
- [ ] Reuse `/finalize` Step 1b.5 code-fence-aware checkbox scanner against the current branch's `_planning.md` (resolve via the three-path lookup in `/finalize` Step 0)
- [ ] Check `.claude/push-gate.json` exists and its `sha` field matches current HEAD — if not, RED ("`/finalize` not run on this commit")
- [ ] Check `.claude/test-pass.json` similarly
- [ ] Glob `docs/planning/*/`: for any project folder whose `_status.json.branch` matches an open PR, treat its planning doc as in-scope for the checkbox scan too — covers stale projects from other worktrees

### Phase 4: Post-deploy migrations + backports
- [ ] `git fetch origin main production`
- [ ] Migrations diff: `git diff --name-only origin/production..origin/main -- 'supabase/migrations/*.sql'` — non-empty means un-promoted migrations → RED with explicit file list
- [ ] Backport diff: `git log origin/main ^origin/production --oneline` — non-empty count → YELLOW with "Last release: N commits ago, oldest unpromoted: $SHA $SUBJECT"; if oldest > 14 days, escalate to RED per the 2-week cadence in `environments.md`
- [ ] Surface the most-recent `/mainToProd` PR state via `gh pr list --base production --state all --limit 1` so the user knows whether a release is in-flight

### Phase 5: Doc-update step
- [ ] Identify the current project's research/planning/progress docs via `_status.json` and the three-path lookup
- [ ] Use **AskUserQuestion** to confirm appending a "Closing discussions / Final state" section to `_progress.md` (default: yes)
- [ ] Append a dated block summarizing: verdict color, any items flagged for the user's decision, and a short "Last conversation summary" derived from the current session context
- [ ] If `--dry-run`, skip the mutation but still print what would be appended

### Phase 6: `/initialize` default-doc update
- [ ] Edit `.claude/commands/initialize.md` Step 2.5 to add the four named docs to the unconditional Read list (after the three existing core docs)
- [ ] Edit Step 2.7's Explore-agent prompt to add the four docs to the exclude list (so auto-discovery doesn't re-suggest them)
- [ ] Edit Step 3.5's `_status.json.relevantDocs` template note so the four defaults are guaranteed to land in every new project's status file
- [ ] Edit Step 4's "Documents Read → Core Docs" pre-population list in the research-doc template to include the four
- [ ] Verify the path is `docs/feature_deep_dives/testing_setup.md` (NOT `docs/docs_overall/testing_setup.md` — common mistake; testing_setup.md lives under feature_deep_dives)

### Phase 7: Self-validation
- [ ] Run the new `/safe_to_close` against THIS branch (chore/new_safe_to_close_command_20260531) — expect RED because the PR is not yet created
- [ ] After /finalize + PR creation, re-run — expect RED on "branch has open PR for current worktree" only
- [ ] After PR merge + branch checkout to main, re-run — expect GREEN (or whatever YELLOW signals are appropriate for the global state at that moment)

## Testing

### Unit Tests
- [ ] N/A — slash commands are markdown specs, not TypeScript modules. No unit tests required (consistent with how `finalize.md`, `mainToProd.md`, etc. are tested — i.e., not).

### Integration Tests
- [ ] N/A — same reason.

### E2E Tests
- [ ] N/A — same reason.

### Manual Verification
- [ ] Run `/safe_to_close` from `worktree_37_7` (this worktree) with an open PR — verify RED + PR is flagged
- [ ] Run `/safe_to_close --dry-run` — verify no `_progress.md` mutation occurs
- [ ] Run `/safe_to_close` from a worktree on `main` with no open PRs — verify GREEN (or correct YELLOW)
- [ ] Manually plant a fake `supabase/migrations/9999_test.sql` on a local branch, push to a fake `main` (in a scratch repo), verify the migration-drift RED path fires correctly
- [ ] After Phase 6, run `/initialize chore/test_init` in a scratch worktree — verify all four default docs are read without prompting and appear in `_status.json.relevantDocs`

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes.

### B) Automated Tests
- [ ] None required. Slash commands are validated by manual run (see Manual Verification above).

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/project_workflow.md` — add a "Step 9: Verify safe-to-close" section pointing at the new command
- [ ] `docs/docs_overall/getting_started.md` — add `safe_to_close.md` to the slash-commands index if one exists
- [ ] `docs/docs_overall/environments.md` — cross-reference the migration-drift check from `/safe_to_close` in the Release Cadence section
- [ ] `docs/docs_overall/testing_overview.md` — no updates expected (read for context only)
- [ ] `docs/feature_deep_dives/testing_setup.md` — no updates expected (read for context only)
- [ ] `docs/docs_overall/debugging.md` — no updates expected (read for context only)
- [ ] `docs/feature_deep_dives/pr_verification_gate.md` — add a note that `/safe_to_close` reads `push-gate.json` and `test-pass.json` for its finalize-artifact check
- [ ] `docs/feature_deep_dives/maintenance_skills.md` — no updates expected (read for worktree-scanning patterns)
- [ ] `docs/feature_deep_dives/iterative_planning_agent.md` — no updates expected
- [ ] `docs/docs_overall/managing_claude_settings.md` — no updates expected
- [ ] `docs/docs_overall/instructions_for_updating.md` — no updates expected

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
