# Fix Tmux S Command Plan

## Background
The `s` command (defined in `docs/planning/tmux_usage/claude-tmux.sh`) is supposed to spin up a tmux session and launch Claude Code within it, but it's not working. It needs investigation and fixing so that users can reliably create/reattach named tmux sessions running `claude -c` from any worktree directory.

## Requirements (from GH Issue #NNN)
- Fix the `s` command in `docs/planning/tmux_usage/claude-tmux.sh` so it correctly creates/reattaches tmux sessions running `claude -c`
- Investigate why the command fails (no specific error details available)
- Ensure worktree auto-detection works correctly

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/debugging.md` - May need to update `s` command usage instructions
- `docs/docs_overall/testing_overview.md` - May need to update server management references
- `docs/feature_deep_dives/testing_setup.md` - May need to update tmux-related setup info
