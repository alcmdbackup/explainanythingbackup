# New Safe-to-Close Command Progress

## Phase 1: `/safe_to_close` command spec — file + frontmatter
### Work Done
- Drafted complete `safe_to_close.md` spec covering Phases 1.5-7 (15.2KB, 312 lines)
- Frontmatter includes correct `description`, `argument-hint: [--update-docs] [--dry-run]`, and minimum-privilege `allowed-tools` (Glob/Grep deliberately omitted per iter-2 review)
- Staged at `docs/planning/new_safe_to_close_command_20260531/deliverables/safe_to_close.md`

### Issues Encountered
- **Blocker: `.claude/commands/` is OS-level read-only** in this Claude session (bind mount confirmed via `mount | grep claude`). Cannot write directly. Drafted to `deliverables/` for out-of-session install via the one-shot command in `INSTALL.md`.
- This is a harness defense-in-depth measure (pinning slash-command runtime), not a bug. `dangerouslyDisableSandbox` does not help — the read-only flag is below the Claude sandbox layer.

### User Clarifications
- User confirmed (via "Please try again now") that re-attempt was desired; second `touch` test still confirmed read-only

## Phase 1.5: Pre-flight (encoded inside safe_to_close.md spec)
### Work Done
- Spec includes 4 pre-flight sub-steps (1.5a workflow file → 1.5b refs → 1.5c gh auth → 1.5d label) with explicit ordering (local first, auth gates network)
- Each failure sets a shell variable (`NIGHTLY_OK`, `REFS_OK`, `GH_AUTH_OK`, `LABEL_OK`) consumed by downstream phases; no crash

## Phase 2: Worktree + PR scan (encoded in spec)
### Work Done
- Spec includes single `gh pr list --author @me --state open --json ...` call
- Placeholder worktree filter regex (`^refs/heads/git_worktree_[0-9_]+$`)
- 6-row classification table covering current vs other worktree, draft handling, stale annotation
- ALL open PRs surfaced — no age suppression (per user feedback override of R2A #1)

## Phase 3: Plan + finalize-artifact scan (encoded in spec)
### Work Done
- `_status.json` reverse-index lookup with `sort -V | tail -1` for reused branch names
- Code-fence-aware checkbox scan with template-placeholder filter (`^- \[ \] \[.*\]$`)
- Three-state schema_version validation for push-gate / test-pass / ci-gate JSONs
- Push-gate commit-mismatch path shows intervening commits inline
- Explicit ci-gate status enum color map (open→GREEN, pending→YELLOW, closed→RED, unknown→YELLOW)
- jq parse failure → YELLOW, never crash

## Phase 4: Post-deploy migrations + backports (encoded in spec)
### Work Done
- Pre-check defers to Phase 1.5b `REFS_OK`; ⊘ skipped row if refs missing
- Un-promoted migration check via `git diff --name-only origin/production..origin/main -- 'supabase/migrations/*.sql'`
- Un-released commits with 14d/17d thresholds calibrated to observed cadence
- Symmetric Active-PRs-in-flight covering both `--base main` and `--base production`
- Abandoned-worktree PR detection (my PR with `headRefName` not matching any worktree)

## Phase 5: Release-health signals (encoded in spec)
### Work Done
- Nightly E2E with 1-vs-2 night transitions
- Open release-health issues with 12h boundary
- All `gh` calls wrapped to YELLOW on failure

## Phase 6: Verdict display + state file (encoded in spec)
### Work Done
- Verdict block with `✓ / ⚠ / ✗ / ⊘` symbol set; `⊘` excluded from aggregation
- Next-action hints per RED/YELLOW signal
- `.claude/safe-to-close-verdict.json` schema with `status: ok|warn|fail|skipped` enum
- Exit code mapping: GREEN/YELLOW → 0, RED → 1, crash → 2

## Phase 7: Doc-update step (encoded in spec)
### Work Done
- Opt-in via `--update-docs`; combined with `--dry-run` prints diff but mutates nothing
- Pre-flight guards: detached HEAD, no project folder, read-only docs, missing docs
- Markdown safety check (odd ``` count detection) applied to merged result
- Three-source derivation (git log + planning Review & Discussion + one AskUserQuestion)
- Append targets: `_progress.md` ("Phase N+1: Closeout"), `_planning.md` ("### Closeout Notes"), `_research.md` ("## Post-Execution Findings" conditional)

## Phase 8: `/initialize` default-doc update
### Work Done
- **Phase 8b strict execution order followed (step 1 of 5):**
  - ✓ Pre-flight integrity check on all 5 anchors — all matched exactly once in live `.claude/commands/initialize.md`
- **Steps 2-5 staged but not yet committed live** due to bind-mount blocker
  - All 5 edits applied to a staged copy at `deliverables/initialize.md`
  - Post-edit verification passed: 7 new strings present, headings split correctly, balanced fences (% 2 == 0)
- INSTALL.md provides one-shot install command for out-of-session execution
- `feature_deep_dives/testing_setup.md` path verified twice (in Step 2.5 and in Step 4 research template)

### Issues Encountered
- Same bind-mount blocker as Phase 1. Workaround: stage to `deliverables/`, install out-of-session.

## Phase 8b: Rollback plan
### Work Done
- INSTALL.md documents `git revert HEAD` (post-commit) and `git checkout HEAD -- ...` (pre-commit) recovery paths
- Phase 9 IN-3 scenario (revert + restore) deferred to post-install (requires the install commit to exist)

## Phase 9: Self-validation (manual)
### Work Done — Scenarios runnable BEFORE install (in current session)
- ✓ **Phase 8b pre-flight integrity check** — all 5 anchors present in live initialize.md (passed)
- ✓ **Phase 8b post-edit verification** — all 7 expected new strings in staged file; balanced fences; testing_setup.md path correct

### Scenarios deferred to POST-INSTALL (require the command to be live)
- HP-1 through HP-6: require `.claude/commands/safe_to_close.md` to be installed
- TB-1 through TB-4: same
- PF-1 through PF-4: same
- GF-1 through GF-3: same
- DU-1 through DU-3: same
- WT-1 through WT-3: same
- IN-1 (run `/initialize` against throwaway project): can be run after Phase 8 install; documented in INSTALL.md
- IN-2 (anchor drift detection): tested implicitly by the install process — `grep` checks in INSTALL.md
- IN-3 (revert + restore): requires the install commit to exist

### User Clarifications
- User: "Please try again now" → confirmed second attempt; bind-mount persisted
- User: prefers a clean install path (single commit) over partial work-around
