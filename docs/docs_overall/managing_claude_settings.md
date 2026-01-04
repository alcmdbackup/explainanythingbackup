# Managing Claude Code Settings

This document explains how Claude Code permissions are stored, how they persist across worktree resets, and best practices for managing them.

## Settings File Locations

| File | Scope | Persists? | Git Tracked? |
|------|-------|-----------|--------------|
| `~/.claude/settings.json` | User (global) | ✅ Always | No (outside repo) |
| `.claude/settings.json` | Project (shared) | ✅ Yes | Yes |
| `.claude/settings.local.json` | Project (personal) | ✅ Yes* | No (globally gitignored) |

*Project-local settings persist in `explainanything-feature0/` but are destroyed in worktrees during reset.

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
