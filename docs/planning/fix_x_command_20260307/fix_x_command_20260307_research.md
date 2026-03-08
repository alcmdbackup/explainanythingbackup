# Fix X Command Research

## Problem Statement
Add a `-d` flag to the `s` tmux helper command that starts Claude Code with `--dangerously-skip-permissions` mode. Currently the `s` command (from `claude-tmux.sh`) auto-detects the worktree and creates/reattaches a tmux session running `claude -c`. This fix adds an optional `-d` flag so users can run `s -d` to start with permissions skipped.

## Requirements (from GH Issue #671)
- Add `-d` flag to the `s` command in `claude-tmux.sh` that passes `--dangerously-skip-permissions` to `claude`

## High Level Summary
The `s` function in `claude-tmux.sh` is a simple 22-line bash function. It detects the worktree number from `$PWD`, maps it to a tmux session name (`s0`, `s1`, etc.), and either reattaches to an existing session or creates a new one running `claude -c`. The fix requires:
1. Parsing a `-d` flag before the worktree detection logic
2. Conditionally appending `--dangerously-skip-permissions` to the `claude -c` command
3. When reattaching to an existing session, the flag has no effect (session already running) — this is expected behavior and should be documented

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/debugging.md - Documents the `s` function at line 152-159, will need updating to mention `-d` flag

## Code Files Read
- `docs/planning/tmux_usage/claude-tmux.sh` - The entire `s` function implementation (22 lines). Key observations:
  - Line 4: `s()` function definition, no args currently
  - Lines 8-15: Worktree detection via `case` on `basename "$dir"`
  - Lines 17-21: tmux session create/reattach logic
  - Line 20: The `claude -c` command string that needs the flag appended

## Key Findings
1. The function takes no arguments currently — adding `-d` flag parsing at the top is clean
2. When a session already exists (line 17-18), `tmux attach-session` just reattaches — the `-d` flag would be ignored since claude is already running. This is fine and expected.
3. The `claude` CLI accepts `--dangerously-skip-permissions` as a flag (confirmed by Claude Code docs)
4. The debugging doc at `docs/docs_overall/debugging.md` line 152-159 documents the `s` function and will need a note about the `-d` flag

## Open Questions
None — the implementation path is clear.
