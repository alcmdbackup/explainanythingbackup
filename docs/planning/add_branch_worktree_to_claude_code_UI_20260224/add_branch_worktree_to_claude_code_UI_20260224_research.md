# Add Branch Worktree To Claude Code UI Research

## Problem Statement
The Claude Code CLI UI currently doesn't display key context about the working environment. We need to customize it to show the current worktree/working directory, current git branch, and project file name so developers can quickly see which environment they're working in without running separate commands.

## Requirements (from GH Issue #NNN)
- A) Show current worktree or working directory
- B) Show current git branch
- C) Show project file name

Additional context: Use Claude Code's built-in UI customization features (status line) to implement this.

## High Level Summary
Claude Code provides a **status line** feature that displays at the bottom of the terminal. This is configured via `~/.claude/settings.json` and powered by a custom shell script that receives JSON data via stdin.

### Key Findings
- **Status line** is the primary UI customization mechanism in Claude Code
- Configured in `~/.claude/settings.json` under `statusLine` key
- Script receives JSON with fields like `workspace.current_dir`, `workspace.project_dir`, `model.display_name`, etc.
- Git branch must be fetched via shell commands (e.g., `git rev-parse --abbrev-ref HEAD`)
- Project file name can be derived from `_status.json` in the project planning folder
- `/statusline` slash command can generate configurations from natural language descriptions
- Scripts can be written in bash (with jq), Python, or Node.js

### Status Line JSON Data Available
| Field | Description |
|-------|-------------|
| `workspace.current_dir` | Current working directory |
| `workspace.project_dir` | Project launch directory |
| `model.display_name` | Current model name |
| `context_window.used_percentage` | Context usage % |
| `cost.total_cost_usd` | Session cost |
| `session_id` | Unique session ID |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/managing_claude_settings.md

## Code Files Read
- (to be populated during /research phase)
