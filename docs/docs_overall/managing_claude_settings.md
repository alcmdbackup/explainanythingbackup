# Managing Claude Code Settings

This document explains how Claude Code permissions are stored, how they persist across worktree resets, and best practices for managing them.

## Settings File Locations

| File | Scope | Persists? | Git Tracked? |
|------|-------|-----------|--------------|
| `~/.claude/settings.json` | User (global) | ✅ Always | No (outside repo) |
| `.claude/settings.json` | Project (shared) | ✅ Yes | Yes |
| `.claude/settings.local.json` | Project (personal) | ✅ Yes* | No (globally gitignored) |
| `.claude/doc-mapping.json` | Project (shared) | ✅ Yes | Yes |

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
