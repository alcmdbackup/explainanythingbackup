# Add Branch Worktree To Claude Code UI Research

## Problem Statement
The Claude Code CLI UI currently doesn't display key context about the working environment. We need to customize it to show the current worktree/working directory, current git branch, and project file name so developers can quickly see which environment they're working in without running separate commands.

## Requirements (from GH Issue #553)
- A) Show current worktree or working directory
- B) Show current git branch
- C) Show project file name

Additional context: Use Claude Code's built-in UI customization features (status line) to implement this.

## High Level Summary

Claude Code provides a **status line** feature — a customizable bar at the bottom of the terminal that runs a shell script and displays its output. This is the correct mechanism for all three requirements.

### How It Works
1. Configure `statusLine` in `~/.claude/settings.json` (user-level) or `.claude/settings.json` (project-level)
2. Claude Code pipes JSON session data to the script via **stdin**
3. Script reads JSON, extracts fields, runs any additional commands (e.g., `git branch`), and prints output to **stdout**
4. Claude Code displays the script's output at the bottom of the interface

### Configuration Format
```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 2
  }
}
```

### When It Updates
- After each assistant message
- When permission mode changes
- When vim mode toggles
- Debounced at 300ms (rapid changes batch together)
- If new update triggers while script running, in-flight execution is cancelled

### What Scripts Can Output
- **Multiple lines**: each `echo` creates a separate row
- **Colors**: ANSI escape codes (e.g., `\033[32m` for green)
- **Links**: OSC 8 escape sequences for clickable text (terminal-dependent)

## Key Findings

### 1. Available JSON Data (stdin)
| Field | Description |
|-------|-------------|
| `workspace.current_dir` | Current working directory (same as `cwd`) |
| `workspace.project_dir` | Directory where Claude Code was launched |
| `model.id`, `model.display_name` | Model identifier and display name |
| `context_window.used_percentage` | Pre-calculated context usage % |
| `context_window.remaining_percentage` | Pre-calculated remaining % |
| `context_window.context_window_size` | Max tokens (200k or 1M) |
| `cost.total_cost_usd` | Total session cost |
| `cost.total_duration_ms` | Total wall-clock time |
| `cost.total_api_duration_ms` | Time waiting for API responses |
| `cost.total_lines_added/removed` | Lines changed |
| `session_id` | Unique session identifier |
| `transcript_path` | Path to conversation transcript |
| `version` | Claude Code version |
| `output_style.name` | Current output style name |
| `vim.mode` | Vim mode (NORMAL/INSERT) — absent when vim disabled |
| `agent.name` | Agent name — absent when not using --agent |
| `exceeds_200k_tokens` | Whether latest response exceeded 200k tokens |

### 2. How to Get Each Required Field

**A) Worktree/Working Directory:**
- Available directly from JSON: `workspace.current_dir`
- Extract basename: `${DIR##*/}` gives e.g. `worktree_37_5`

**B) Git Branch:**
- NOT in JSON data — must be fetched via shell command
- `git branch --show-current` or `git rev-parse --abbrev-ref HEAD`
- Should cache this (5s) since the script runs frequently

**C) Project File Name:**
- NOT in JSON data — must be derived
- Derivation: strip prefix from branch name: `${BRANCH#*/}` → project name
- E.g., `feat/add_branch_worktree_to_claude_code_UI_20260224` → `add_branch_worktree_to_claude_code_UI_20260224`
- Can optionally verify with: `docs/planning/${PROJECT_NAME}/_status.json`

### 3. Performance Considerations
- Script runs frequently during active sessions
- Git commands can be slow in large repos
- **Must cache** expensive operations (recommended: 5s cache via temp file)
- Use a stable filename like `/tmp/statusline-git-cache` (not `$$` which changes per invocation)
- `stat -c %Y` on Linux, `stat -f %m` on macOS for checking cache age

### 4. Configuration Location Decision
- **User-level** (`~/.claude/settings.json`): Survives worktree resets, applies to all projects
- **Project-level** (`.claude/settings.json`): Project-specific, tracked in git
- Per `managing_claude_settings.md`: worktree copies of `.claude/settings.local.json` are destroyed on reset
- **Recommendation**: Use user-level settings for the statusLine config (since it's a personal UI preference), but store the script in the repo so it's shared

### 5. Existing Project Infrastructure
- `~/.claude/settings.json` currently contains `{}` (empty)
- `.claude/settings.json` has hooks, permissions, sandbox rules — no statusLine yet
- No existing statusline scripts anywhere in the repo or home directory
- Project has existing hooks infrastructure in `.claude/hooks/`

### 6. Available Tooling
- A `statusline-setup` agent type exists in Claude Code for configuring status lines
- The `/statusline` slash command auto-generates scripts from natural language
- `jq` is available for JSON parsing in bash scripts

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — doc structure and reading order
- docs/docs_overall/architecture.md — system design, tech stack, data flow
- docs/docs_overall/project_workflow.md — project lifecycle steps

### Relevant Docs
- docs/docs_overall/managing_claude_settings.md — settings file locations, worktree persistence, permission resolution

### Web Docs
- https://code.claude.com/docs/en/statusline.md — complete status line API, examples, troubleshooting
- https://code.claude.com/docs/en/settings.md — all Claude Code settings including UI customization

## Code Files Read
- `.claude/settings.json` — existing project settings (hooks, permissions, no statusLine)
- `~/.claude/settings.json` — empty user settings
- `docs/planning/add_branch_worktree_to_claude_code_UI_20260224/_status.json` — project status with branch info

## Open Questions
1. Should the status line be single-line or multi-line? (recommend single for simplicity)
2. Should we include context % and cost alongside the 3 required fields? (nice-to-have)
3. Should the script go in `~/.claude/statusline.sh` or in the repo at `.claude/statusline.sh`?
