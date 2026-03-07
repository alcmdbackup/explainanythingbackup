# Fix Tmux S Command Research

## Problem Statement
The `s` command (defined in `docs/planning/tmux_usage/claude-tmux.sh`) is supposed to spin up a tmux session and launch Claude Code within it, but it's not working. It needs investigation and fixing so that users can reliably create/reattach named tmux sessions running `claude -c` from any worktree directory.

## Requirements (from GH Issue #652)
- Fix the `s` command in `docs/planning/tmux_usage/claude-tmux.sh` so it correctly creates/reattaches tmux sessions running `claude -c`
- Investigate why the command fails (no specific error details available)
- Ensure worktree auto-detection works correctly

## High Level Summary

The `s` function has one root issue:

1. **Not sourced in any shell RC file** - The function is defined in `docs/planning/tmux_usage/claude-tmux.sh` but is NOT sourced in `~/.bashrc`, `~/.zshrc`, or `~/.profile`. The `s` command simply doesn't exist in the user's shell. The docs reference sourcing from a hardcoded path (`~/Documents/ac/worktree_37_1/...`) but that line was never added to the user's RC.

The pattern matching logic is actually correct:
- `*worktree0)` matches `explainanything-worktree0` (the main repo) -> `s0`
- `*worktree*_[0-9])` matches `worktree_37_2` etc. -> `sN`

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/debugging.md - References the `s` function at line 152-159, shows sourcing from hardcoded worktree_37_1 path
- docs/docs_overall/testing_overview.md - References tmux server management but not the `s` function
- docs/feature_deep_dives/testing_setup.md - Testing infrastructure, not directly related
- docs/planning/tmux_usage/using_tmux_recommendations.md - On-demand server docs, no mention of `s` function

## Code Files Read
- `docs/planning/tmux_usage/claude-tmux.sh` - The `s` function definition (22 lines)
- `docs/planning/tmux_usage/start-dev-tmux.sh` - Dev server startup script (separate from `s`)
- `docs/planning/tmux_usage/ensure-server.sh` - Server management (separate from `s`)
- `reset_worktrees` - Worktree creation script; creates `worktree_${COUNTER}_${i}` directories from `origin/main`

## Key Findings

1. **`s` function not available** - Not sourced in any shell RC file (`~/.bashrc`, `~/.zshrc`, `~/.profile`). Running `type s` returns "not found". This is the primary reason the command doesn't work.

2. **Main repo directory is `explainanything-worktree0`** (not `explainanything-feature0` as previously assumed). Verified on disk. The `*worktree0` case pattern correctly matches this directory.

3. **Existing worktree directories**: `worktree_37_1` through `worktree_37_5`. The pattern `*worktree*_[0-9]` correctly matches these.

4. **Session naming works**: `worktree_37_2` -> extracts `2` via `${dir##*_}` -> session name `s2`. Correct.

5. **`*worktree0` pattern is NOT dead code** - It correctly matches `explainanything-worktree0` -> `s0`. Previous research incorrectly claimed this was dead.

6. **Documentation references hardcoded path** - `debugging.md` line 155 says to source from `~/Documents/ac/worktree_37_1/...` which is fragile across worktree resets (counter increments). Should use `explainanything-worktree0` instead.

7. **`explainanything-worktree0` is stable** - It's the main git repo, not a worktree. It persists across `reset_worktrees` runs and always has the latest `main` code.

## Resolved Questions

1. Source path: Use `~/Documents/ac/explainanything-worktree0/docs/planning/tmux_usage/claude-tmux.sh` (stable path via main repo)
2. Pattern matching: No changes needed — existing patterns are correct
3. Session naming: Keep `s0`-`s5` scheme (simple, matches worktree index)
