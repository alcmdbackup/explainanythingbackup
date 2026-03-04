# Tmux Helper Commands Research

## Problem Statement
Claude Code sessions are lost when a terminal closes. Users need a zero-argument way to exit claude, then resume the same conversation inside a tmux session for persistence. The session name should auto-detect from the current worktree directory — no manual naming, no chance of typo.

## Requirements (from user request)
- Exit claude, then continue the same conversation inside tmux via `claude -c`
- Auto-detect session name from current working directory (e.g. `worktree_37_1` → `s1`)
- Reattach to existing tmux session if already running
- Zero arguments — just type `s`
- Simple, minimal implementation

## High Level Summary

### Approach: Exit + Continue in tmux
Claude Code's `--continue` (`-c`) flag resumes the most recent conversation. Combined with tmux:
1. User exits claude normally (`/exit`)
2. Runs `s` (shell function)
3. Function detects worktree number from `pwd`, creates/attaches tmux session running `claude -c`

### Options Explored
1. **Explicit wrapper script (`claude-tmux <name>`)** — requires manual naming, error-prone
2. **Shell function overriding `claude`** — too magical, surprising behavior
3. **tmux popup via keybinding** — only works if already in tmux
4. **Smart alias with auto-naming** — sweet spot, but `cc` name conflicts with C compiler
5. **Zero-arg `s` with cwd detection** — **chosen approach**, simplest possible UX

### Key tmux Patterns (from research)
- `tmux has-session -t NAME` — check if session exists (exit 0 = yes)
- `tmux attach-session -t NAME` — reattach from outside tmux
- `tmux new-session -s NAME -c DIR "cmd"` — create session with working dir and command
- `$TMUX` env var — set when inside tmux (detect nesting)

### Worktree Directory Mapping
| Directory | Session |
|-----------|---------|
| `explainanything-worktree0` | `s0` |
| `worktree_37_1` | `s1` |
| `worktree_37_2` | `s2` |
| `worktree_37_3` | `s3` |
| `worktree_37_4` | `s4` |
| `worktree_37_5` | `s5` |

Detection logic: basename ending in `worktree0` → `s0`, basename ending in `_N` → `sN`.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### External Research
- Claude Code CLI reference (flags: -c, -r, --continue, --resume)
- tmux man page (new-session, has-session, attach-session, switch-client)
- Community patterns: tmux-sessionizer (ThePrimeagen), claude-tmux popup (Takuya Matsuyama)
- Best practices for tmux session naming and sanitization

## Code Files Read
- docs/planning/tmux_usage/ensure-server.sh - on-demand server startup patterns
- docs/planning/tmux_usage/start-dev-tmux.sh - session creation with naming conventions
- .claude/hooks/cleanup-tmux.sh - session cleanup on exit
