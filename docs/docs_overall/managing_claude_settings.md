# Managing Claude Code Settings

This document explains how Claude Code permissions are stored, how they persist across worktree resets, and best practices for managing them.

## Settings File Locations

| File | Scope | Persists? | Git Tracked? |
|------|-------|-----------|--------------|
| `~/.claude/settings.json` | User (global) | ✅ Always | No (outside repo) |
| `.claude/settings.json` | Project (shared) | ✅ Yes | Yes |
| `.claude/settings.local.json` | Project (personal) | ✅ Yes* | No (globally gitignored) |
| `.claude/doc-mapping.json` | Project (shared) | ✅ Yes | Yes |
| `.mcp.json` | Project MCP servers | ✅ Yes | Yes |

*Project-local settings persist in `explainanything-feature0/` but are destroyed in worktrees during reset.

## MCP Server Configuration

MCP servers and settings use **separate file locations**. Do NOT define MCP servers in `.claude/settings.json` — they will not load reliably across worktrees.

### MCP File Locations

| File | Scope | Purpose |
|------|-------|---------|
| `.mcp.json` | Project | **The only project-level location for MCP servers.** Git-tracked, works in all worktrees. |
| `~/.claude.json` (global `mcpServers`) | User | Personal MCPs available across all projects and worktrees |
| `~/.claude.json` (per-project path) | Local | MCPs scoped to one specific directory path — does NOT transfer between worktrees |

### Common Pitfall: `mcpServers` in `.claude/settings.json`

**Do NOT put MCP servers in `.claude/settings.json` `mcpServers`.** While the key exists and may appear to work in one worktree, Claude Code discovers project MCP servers from `.mcp.json`, not from settings files. Servers defined in `.claude/settings.json` will silently fail to load in other worktrees.

**Correct** — define MCPs in `.mcp.json`:
```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=..."
    },
    "honeycomb": {
      "type": "http",
      "url": "https://mcp.honeycomb.io/mcp"
    }
  }
}
```

**Wrong** — defining MCPs in `.claude/settings.json`:
```json
{
  "mcpServers": {
    "supabase": { "type": "http", "url": "..." }
  }
}
```

### Auto-Approving Project MCPs

To skip approval prompts for `.mcp.json` servers, add to `.claude/settings.json`:
```json
{
  "enableAllProjectMcpServers": true,
  "enabledMcpjsonServers": ["honeycomb", "supabase"]
}
```

### Adding MCPs via CLI

When using `claude mcp add`, the `--scope` flag controls where the server is stored:

| Scope | Storage | Available across worktrees? |
|-------|---------|---------------------------|
| `--scope local` (default) | `~/.claude.json` per-project path | ❌ No — path-specific |
| `--scope project` | `.mcp.json` | ✅ Yes — git-tracked |
| `--scope user` | `~/.claude.json` global | ✅ Yes — all projects |

**For worktree compatibility, always use `--scope project` or `--scope user`.**

## Permission Resolution Order

Settings are merged with higher precedence overriding lower:

```
1. Managed settings (enterprise)     ← Highest precedence
2. Command line arguments
3. Local project (.claude/settings.local.json)
4. Shared project (.claude/settings.json)
5. User settings (~/.claude/settings.json)  ← Lowest precedence
```

## How Worktree Resets Affect Settings

The `reset_worktrees` script:

1. **Destroys** all `worktree_*` directories
2. **Creates** fresh worktrees from `origin/main`
3. **Copies** settings from `explainanything-feature0/.claude/` to new worktrees

```
explainanything-feature0/.claude/settings.local.json
        ↓ (copied with path substitution)
worktree_X_Y/.claude/settings.local.json
```

### What Survives Reset

| Location | Survives? | Notes |
|----------|-----------|-------|
| `~/.claude/settings.json` | ✅ Yes | User home directory, never touched |
| `feature0/.claude/settings.local.json` | ✅ Yes | Template source, never destroyed |
| `worktree_X_Y/.claude/settings.local.json` | ❌ No | Recreated from feature0 template |

## Best Practices

### 1. Put common permissions in user settings

`~/.claude/settings.json` should contain permissions you want across all projects:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run:*)",
      "Bash(git log:*)",
      "mcp__playwright__browser_navigate"
    ],
    "deny": [
      "Bash(bash:*)",
      "Bash(curl:*)"
    ]
  }
}
```

### 2. Keep project-local minimal

`.claude/settings.local.json` should only contain project-specific additions:

```json
{
  "permissions": {
    "allow": [
      "Bash(psql:*)"
    ]
  }
}
```

### 3. Update the template, not worktrees

To change project-specific permissions persistently, edit:
```
explainanything-feature0/.claude/settings.local.json
```

Not the worktree copy (which gets destroyed on reset).

## Permission Syntax

Use `:*` for prefix matching (not `*` alone):

| Syntax | Valid? | Matches |
|--------|--------|---------|
| `Bash(npm run:*)` | ✅ Yes | `npm run dev`, `npm run build`, etc. |
| `Bash(timeout:*)` | ✅ Yes | `timeout 10s npm run build`, etc. |
| `Bash(timeout *s npm:*)` | ❌ No | Invalid - causes file to be skipped |

## Risk Levels

### Safe (read-only, scoped)
- `Bash(ls:*)`, `Bash(cat:*)`, `Bash(git log:*)`
- `WebFetch(domain:github.com)`
- `mcp__playwright__browser_snapshot`

### Moderate (can modify files/state)
- `Bash(git add:*)`, `Bash(git commit:*)`
- `Bash(npm install:*)`
- `Bash(sed:*)`

### High Risk (should deny or scope)
- `Bash(bash:*)` - executes anything, bypasses all restrictions
- `Bash(curl:*)` - can download/exfiltrate data
- `Bash(python3:*)`, `Bash(node:*)` - arbitrary code execution
- `Bash(gh api:*)` - raw GitHub API access

## Viewing Current Permissions

In Claude Code CLI:
- `/permissions` - Opens permission viewer
- `/config` - Opens full settings interface

## Gitignore Setup

The global gitignore at `~/.config/git/ignore` contains:
```
**/.claude/settings.local.json
```

This ensures personal settings are never accidentally committed.

## Sandbox Troubleshooting

### `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`

**Affected systems**: Ubuntu 24.04+ (and derivatives) with `kernel.apparmor_restrict_unprivileged_userns=1` (enabled by default).

**What happens**: Claude Code uses bubblewrap (bwrap) for OS-level sandboxing of bash commands. Ubuntu 24.04+ blocks bwrap from configuring a loopback interface in network namespaces via AppArmor. Commands fall back to unsandboxed execution — effectively disabling filesystem write restrictions and network domain filtering while producing spurious errors.

**Fix (recommended)**: Create an AppArmor profile granting bwrap the `userns` capability:

```bash
echo 'abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}' | sudo tee /etc/apparmor.d/bwrap

sudo systemctl reload apparmor
```

This is a one-time system configuration. It only grants bwrap the specific capability it needs — all other applications remain restricted.

**Alternative (less secure)**: Disable the kernel restriction system-wide:
```bash
sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0
# Persist: echo "kernel.apparmor_restrict_unprivileged_userns=0" | sudo tee /etc/sysctl.d/99-bwrap.conf
```

**References**: [sandbox-runtime#74](https://github.com/anthropic-experimental/sandbox-runtime/issues/74), [bubblewrap#632](https://github.com/containers/bubblewrap/issues/632), [Launchpad#2069526](https://bugs.launchpad.net/ubuntu/+source/apparmor/+bug/2069526)

## Status Line Configuration

Claude Code supports a customizable status bar at the bottom of the terminal via the `statusLine` settings key. It runs a shell script on each assistant message, piping JSON session data to stdin.

### Setup

The status line script lives at `~/.claude/statusline.sh` (user-level, survives worktree resets). It's configured in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh"
  }
}
```

### What It Shows

The current script displays: **worktree name**, **git branch**, **project name** (derived from branch — e.g. `feat/my_project` → `my_project`), **context window %**, and **session cost**.

Example output:
```
worktree_37_5 feat/add_branch_worktree_to_claude_code_UI_20260224 add_branch_worktree_to_claude_code_UI_20260224 | 42% $1.23
```

### Caching

Git branch lookups are cached per-worktree in `~/.claude/cache/statusline-git-<worktree>` with a 5-second TTL. Cache writes use atomic `.tmp` + `mv` to avoid partial reads.

### State Persistence

The script persists last-known-good values for all displayed fields in a per-session state file (`~/.claude/cache/statusline-state-<session_id>`). When Claude Code sends null/empty fields during context compaction or session reconnect, the script falls back to the most recent valid values instead of showing degraded output (`0%`, `$0.00`, etc.).

- **Session-scoped**: Each session gets its own state file, keyed by `session_id` from the JSON input. The `session_id` is sanitized (alphanumeric, dash, underscore only) to prevent path traversal.
- **Numeric guards**: Corrupt state file values are detected via regex and reset to `0`.
- **Stale cleanup**: State files older than 24 hours are automatically deleted (checked at most once per hour via a sentinel file).

### Edge Cases

| Scenario | Display |
|----------|---------|
| Branch has prefix (`feat/name`) | Project = `name` |
| No prefix (`main`) | Project = `-` |
| Detached HEAD | Branch = `detached`, Project = `-` |
| Not a git repo | Branch = `no-repo`, Project = `-` |
| Empty/invalid directory | Falls back to cached directory; `[no workspace]` if no cache |
| Null context %/cost (compaction) | Falls back to last-known-good values |
| `jq` not installed | `[statusline: jq not found]` |
| Missing `session_id` | Uses `default` state file |
| Corrupt state file | Numeric guards reset to `0` |

### Disabling

Remove the `statusLine` key from `~/.claude/settings.json`, or run `/statusline delete` in Claude Code.

### Official Docs

See the full statusline API reference at: https://code.claude.com/docs/en/statusline.md

## Bypass-Permissions Safety Hooks

When running Claude Code with `--dangerously-skip-permissions`, all permission prompts are auto-approved. The project includes conditional safety hooks that activate **only** in bypass mode, adding zero friction in normal interactive mode.

### How It Works

The `.claude/hooks/enforce-bypass-safety.sh` hook fires as a matcherless `PreToolUse` hook (applies to ALL tool types). It reads `permission_mode` from hook stdin JSON:

- `"default"` → exits immediately (no-op)
- `"bypassPermissions"` → enforces safety rules, blocking dangerous operations

### What It Blocks (bypass mode only)

| Category | Examples |
|----------|----------|
| **Protected file writes** | Edit/Write to `CLAUDE.md`, `settings.json`, `.claude/hooks/`, `.claude/commands/`, `.env*` |
| **Secret reads** | Read of `.env.local`, `.env.production`, `.env.development` |
| **MCP filesystem writes** | `write_text_file`, `move_file`, `create_directory` |
| **Force push** | `--force`, `--force-with-lease`, `-f`, `+refspec` |
| **Destructive git** | `clean -f`, `checkout -- .`, `restore -- .`, `stash drop/clear`, `branch -D`, `apply`, `add -A/.`, `commit --amend` |
| **Docker/permissions** | `docker run/exec`, `chmod`, `chown` |
| **Data exfiltration** | `gh gist create`, `gh issue/pr create` with `$()` or backticks |
| **Directory deletion** | `rm -rf src/docs/.claude/node_modules/public` |
| **Symlink attacks** | `ln -s` targeting protected files |

### What It Allows (bypass mode)

Normal development operations remain unrestricted: `git push origin HEAD`, `npm run build`, `git commit -m`, `git add <specific-file>`, `git reset --hard` (backup hook ensures recovery).

### Backup Hook

The `.claude/hooks/backup-on-bypass.sh` fires on `SessionStart` in bypass mode only. It pushes the current branch and creates a backup tag (`backup/pre-bypass-YYYYMMDDTHHMMSSZ`) before the session begins, ensuring recovery from `git reset --hard`.

### Test Harness

Run `scripts/test-bypass-safety-hooks.sh` to verify all 80 test cases (normal mode allows, bypass mode denials, whitespace evasion, compound commands, allowed operations).

### OS-Level File Protection (optional)

For additional hardening, run `sudo bash scripts/protect-files.sh` to set `chmod 444` + `chattr +i` on critical files (`CLAUDE.md`, `settings.json`, `.claude/hooks/`, `.claude/commands/`). Reverse with `sudo bash scripts/unprotect-files.sh`.

## Documentation Mapping

The `.claude/doc-mapping.json` file maps code patterns to documentation files for automatic updates during `/finalize`.

### Structure

```json
{
  "version": "1.0",
  "mappings": [
    {
      "pattern": "src/lib/services/tags*.ts",
      "docs": ["docs/feature_deep_dives/tag_system.md"]
    }
  ],
  "alwaysConsider": [
    "docs/docs_overall/architecture.md"
  ]
}
```

### How It Works

1. When `/finalize` runs, it checks changed files against patterns in `mappings`
2. Matched files queue their associated docs for AI-driven updates
3. Docs in `alwaysConsider` are always evaluated for updates
4. New mappings can be added during `/initialize` or when `/finalize` detects unmapped files

### Adding New Mappings

Via `/initialize`:
- When creating a new feature deep dive doc, you'll be prompted for code patterns

Via `/finalize`:
- If unmapped files with doc-worthy changes are detected, you can add rules

### Pattern Syntax

Patterns use glob syntax:
- `src/lib/services/tags*.ts` - matches `tags.ts`, `tagsParser.ts`, etc.
- `src/editorFiles/**` - matches all files recursively
- `{tests,e2e}/**` - matches both `tests/` and `e2e/` directories
