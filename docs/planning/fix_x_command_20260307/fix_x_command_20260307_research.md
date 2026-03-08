# Fix X Command Research

## Problem Statement
Add a `-d` flag to the `s` tmux helper command that starts Claude Code with `--dangerously-skip-permissions` mode. Currently the `s` command (from `claude-tmux.sh`) auto-detects the worktree and creates/reattaches a tmux session running `claude -c`. This fix adds an optional `-d` flag so users can run `s -d` to start with permissions skipped.

## Requirements (from GH Issue #NNN)
- Add `-d` flag to the `s` command in `claude-tmux.sh` that passes `--dangerously-skip-permissions` to `claude`

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/debugging.md
- docs/docs_overall/testing_overview.md

## Code Files Read
- [list of code files reviewed]
