# Fix X Command Plan

## Background
Add a `-d` flag to the `s` tmux helper command that starts Claude Code with `--dangerously-skip-permissions` mode. Currently the `s` command (from `claude-tmux.sh`) auto-detects the worktree and creates/reattaches a tmux session running `claude -c`. This fix adds an optional `-d` flag so users can run `s -d` to start with permissions skipped.

## Requirements (from GH Issue #NNN)
- Add `-d` flag to the `s` command in `claude-tmux.sh` that passes `--dangerously-skip-permissions` to `claude`

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
- `docs/docs_overall/debugging.md` - May need to document the -d flag usage
- `docs/docs_overall/testing_overview.md` - Unlikely to need changes
