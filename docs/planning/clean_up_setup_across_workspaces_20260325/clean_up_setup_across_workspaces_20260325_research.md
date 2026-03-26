# Clean Up Setup Across Workspaces Research

## Problem Statement
MCPs and env files are not consistently available across all worktrees. The user wants identical setup in every worktree for both MCP servers and environment files (including prod env files).

## Requirements (from GH Issue #821)
1. Same MCPs available in all worktrees
2. Same env files (including prod env files) in all worktrees

## High Level Summary

Two distinct problems with the current setup:

**Problem 1: Env files** — The `reset_worktrees` script only copies `.env.local`, `.env.test`, `.env.stage`, `.env.prod`. It does NOT copy `.env.prod.readonly` or `.env.evolution-prod`. These files are missing from most worktrees.

**Problem 2: MCPs** — The git-tracked MCP configs (`.mcp.json` and `.claude/settings.json`) DO propagate to worktrees. However, any MCP added via `claude mcp add` (default scope = "local") goes into `~/.claude.json` keyed by the project path. Since each worktree has a different filesystem path, locally-scoped MCPs only work in the worktree where they were added.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/managing_claude_settings.md — Settings persistence, worktree reset behavior
- docs/docs_overall/environments.md — Env file types and purposes
- docs/docs_overall/testing_overview.md — Test configuration
- docs/docs_overall/debugging.md — Tmux/server setup

### Claude Code Docs (code.claude.com)
- /docs/en/mcp — MCP server scopes (local, project, user)
- /docs/en/settings — Settings file locations and precedence

## Code Files Read
- `reset_worktrees` — Main worktree reset script
- `.claude/settings.json` — Project-level settings (git-tracked)
- `.mcp.json` — Project-level MCP config (git-tracked)
- `~/.claude.json` — User-level config (per-project MCP entries all empty `{}`)
- `~/.claude/settings.json` — User-level settings (only has skill-creator plugin)

## Key Findings

### 1. Env Files Not Fully Copied
The `reset_worktrees` script (line 144) copies:
- ✅ `.env.local`
- ✅ `.env.test`
- ✅ `.env.stage`
- ✅ `.env.prod`

But does NOT copy:
- ❌ `.env.prod.readonly` (exists in worktree0, only manually in worktree_37_3)
- ❌ `.env.evolution-prod` (only exists in worktree0)

### 2. Current Env File Distribution
| File | worktree0 | 37_1 | 37_2 | 37_3 | 37_4 | 37_5 |
|------|-----------|------|------|------|------|------|
| `.env.local` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `.env.prod.readonly` | ✅ | ❌ | ❌ | ✅* | ❌ | ❌ |
| `.env.evolution-prod` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

*manually copied

### 3. MCP Scoping in Claude Code
Per Claude Code docs, MCP servers have 3 scopes:
- **local** (default for `claude mcp add`): Stored in `~/.claude.json` per-project PATH → path-specific, won't transfer between worktrees
- **project**: Stored in `.mcp.json` at project root → git-tracked, available everywhere
- **user**: Stored in `~/.claude.json` globally → available everywhere

### 4. Current MCP Setup
| MCP | Config Location | Git-tracked? | Available in all worktrees? |
|-----|----------------|-------------|---------------------------|
| Supabase | `.claude/settings.json` mcpServers | ✅ Yes | ✅ Yes |
| Honeycomb | `.mcp.json` | ✅ Yes | ✅ Yes |
| Any locally-added | `~/.claude.json` per-path | N/A | ❌ No |

### 5. `explainanything-feature0` Reference is Stale
The `reset_worktrees` script (line 152) references `explainanything-feature0/.claude/` for copying settings, but this directory does not exist. The main repo is at `explainanything-worktree0`.

### 6. File Copies vs Symlinks
Current approach copies files, creating N independent copies that can drift. Symlinks would keep a single source of truth but git worktrees may not support symlinks to files outside the worktree.

### 7. Env File Permissions
worktree0 env files have secure permissions (600), but copied files in worktrees have 664 (world-readable). This is a security issue for credential files.

## Open Questions

1. **What specific MCPs are not appearing?** The git-tracked MCPs (supabase, honeycomb) are present in all worktrees. Is the user adding MCPs via `claude mcp add` that only work locally?
2. **Should we use symlinks or copies for env files?** Symlinks avoid drift but add complexity.
3. **Should `reset_worktrees` be updated to use worktree0 as the source** (since feature0 doesn't exist)?
4. **Should permissions be preserved** when copying env files? (Currently copied as 664 instead of 600)
