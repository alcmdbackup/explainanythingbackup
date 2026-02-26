# Manage Sandbox Whitelist Research

## Problem Statement
Build tooling to manage the Claude Code sandbox filesystem/network whitelist configuration, making it easier to add/remove allowed paths and hosts.

## Requirements (from GH Issue #565)
Help me understand how to maintain and update the whitelist for things allowed through sandbox.

## High Level Summary

Claude Code's sandbox has **two independent restriction layers** that together define what a session can do:

1. **Permission rules** (`deny` → `ask` → `allow` arrays) — enforced by Claude Code itself, apply to all tools
2. **OS-level sandbox** (bwrap on Linux, Seatbelt on macOS) — enforced by the kernel, applies only to Bash commands

The **session whitelist** visible in the system prompt is computed from settings merged across scopes. Making session-level allowances permanent means editing the right `settings.json` file.

---

## How the Session Whitelist is Constructed

### What you see in the system prompt

Every Claude Code session displays sandbox restrictions like:
```
Filesystem: {"read":{"denyOnly":[]},"write":{"allowOnly":["/tmp/claude",".","/home/ac/Documents/ac/..."],"denyWithinAllow":[...]}}
Network: {"allowedHosts":["registry.npmjs.org","*.supabase.co",...]}
```

These are **computed at session start** from merged settings:

| Source | Filesystem writes | Network domains |
|--------|------------------|-----------------|
| Current working directory | Auto-included in `write.allowOnly` | — |
| `additionalDirectories` in settings | Added to `write.allowOnly` | — |
| `sandbox.network.allowedDomains` | — | Becomes `allowedHosts` |
| `Edit` deny rules | Becomes `write.denyWithinAllow` | — |
| Session-granted permissions | Temporarily added | Temporarily added |

### Key insight: Filesystem vs Network are configured differently

- **Filesystem write paths**: Derived from the CWD + `additionalDirectories` + `Edit` allow/deny rules (NOT a dedicated sandbox setting)
- **Network domains**: Explicitly listed in `sandbox.network.allowedDomains` (a dedicated sandbox setting)

---

## How to Evaluate Current Session Restrictions

### Method 1: Read the system prompt
The sandbox restrictions are printed at the top of every session in the system prompt. Look for the `Filesystem` and `Network` JSON blocks.

### Method 2: `/permissions` command
Run `/permissions` in Claude Code to see all current permission rules and their source files.

### Method 3: `/sandbox` command
Run `/sandbox` to see sandbox mode status and toggle between modes.

### Method 4: `/config` command
Opens the full settings interface for viewing/editing configuration.

### Method 5: Inspect settings files directly
```bash
# Project-level (shared, git-tracked)
cat .claude/settings.json | jq '.sandbox'
cat .claude/settings.json | jq '.permissions'

# Project-local (personal, gitignored)
cat .claude/settings.local.json | jq '.sandbox'

# User-level (global)
cat ~/.claude/settings.json | jq '.sandbox'
```

---

## How to Make Session Allowances Permanent

### Adding a network domain permanently

When Claude Code attempts to access a domain not in `allowedDomains`, the sandbox blocks it and prompts:
1. **Deny** — blocks the request
2. **Allow once** — grants access for this session only
3. **Update configuration** — adds to `allowedDomains` permanently

To manually add a domain, edit the `sandbox.network.allowedDomains` array:

```json
// In .claude/settings.json (project-level, shared with team)
{
  "sandbox": {
    "network": {
      "allowedDomains": [
        "registry.npmjs.org",
        "*.supabase.co",
        "new-domain.example.com"  // ← add here
      ]
    }
  }
}
```

Wildcards supported: `*.example.com` matches all subdomains.

### Adding a filesystem write path permanently

Filesystem write access is controlled via **Edit/Write permission rules** and **additionalDirectories**, NOT sandbox settings:

```json
// In .claude/settings.json
{
  "permissions": {
    "allow": [
      "Edit(~/Documents/ac/**)",      // allow writes to this tree
      "Edit(//tmp/my-tool/**)"         // allow writes to absolute path
    ],
    "deny": [
      "Edit(~/.claude/settings.json)", // block writes to settings
      "Read(~/.aws/**)"                // block reads of AWS creds
    ]
  },
  "additionalDirectories": [
    "../other-repo/"                   // adds to sandbox write allowlist + readable
  ]
}
```

**Path pattern syntax (gitignore-style):**
| Pattern | Meaning | Example |
|---------|---------|---------|
| `//path` | Absolute from filesystem root | `Edit(//Users/alice/secrets/**)` |
| `~/path` | From home directory | `Edit(~/.config/**)` |
| `/path` | Relative to project root | `Edit(/src/**/*.ts)` |
| `path` | Relative to current directory | `Edit(.env)` |

### Adding excluded commands (bypass sandbox)

Commands in `excludedCommands` run outside the sandbox entirely:

```json
{
  "sandbox": {
    "excludedCommands": ["git", "gh", "docker", "tmux"]
  }
}
```

Use sparingly — these commands get NO filesystem/network restrictions.

---

## Settings File Hierarchy & Persistence

### Where to edit (and what persists)

| File | Scope | Persists across sessions? | Survives worktree reset? | Git tracked? |
|------|-------|--------------------------|--------------------------|-------------|
| `~/.claude/settings.json` | User global | ✅ Yes | ✅ Yes (outside repo) | No |
| `.claude/settings.json` | Project shared | ✅ Yes | ✅ Yes (in feature0) | Yes |
| `.claude/settings.local.json` | Project personal | ✅ Yes* | ❌ Recreated from template | No |

*Worktree copies destroyed on reset; edit the template in `explainanything-feature0/.claude/` to persist.

### Settings precedence (highest wins)

1. **Managed settings** (enterprise) — cannot override
2. **Command line arguments** — session-only
3. **`.claude/settings.local.json`** — personal project overrides
4. **`.claude/settings.json`** — shared project config
5. **`~/.claude/settings.json`** — user defaults

### Merge behavior

- **Arrays merge** across scopes (domains from user + project are combined)
- **Booleans override** (more specific scope wins)
- **Objects merge deeply** (nested keys combine)

---

## Current Project Configuration

### Network whitelist (`.claude/settings.json`)
```
registry.npmjs.org, *.npmjs.org, *.supabase.co,
api.openai.com, api.anthropic.com, api.deepseek.com,
*.pinecone.io, api.honeycomb.io, *.sentry.io,
*.grafana.net, playwright.azureedge.net,
playwright-akamai.azureedge.net, api.github.com,
localhost, 127.0.0.1
```

### Filesystem write paths (from session prompt)
- `.` (current working directory)
- `/tmp/claude`, `/private/tmp/claude`, `/tmp/claude-1000/`
- `/home/ac/.npm/_logs`, `/home/ac/.claude/debug`
- `/home/ac/Documents/ac/explainanything-worktree0`
- `~/Documents/ac`

### Excluded commands (bypass sandbox)
`git`, `gh`, `docker`, `tmux`

### Permission deny list (blocks even with sandbox)
`bash`, `sh`, `zsh`, `env`, `node`, `python`, `python3`, `perl`, `ruby`, `php`, `lua`, `curl`, `wget`, `ssh`, `nc`, `netcat`, plus Supabase prod writes

---

## The Two Security Layers Explained

### Layer 1: Permission rules (Claude Code enforced)

| Array | Evaluation order | Effect |
|-------|-----------------|--------|
| `deny` | First | Blocks tool use entirely |
| `ask` | Second | Always prompts user |
| `allow` | Third | Auto-approves tool use |

Applies to ALL tools: Bash, Edit, Read, Write, WebFetch, MCP, Task, Skill.

### Layer 2: OS sandbox (kernel enforced)

| Component | What it restricts | Mechanism |
|-----------|------------------|-----------|
| Filesystem | Write paths for Bash commands | bwrap namespace (Linux) / Seatbelt (macOS) |
| Network | Domains for Bash commands | socat proxy filtering |

Applies ONLY to Bash commands and their child processes. Built-in tools (Read, Write, Edit, Glob, Grep) are NOT sandboxed.

### How they interact

```
Bash command requested
  → Check deny list → BLOCKED if matched
  → Check ask list → PROMPT if matched
  → Check allow list → auto-approve if matched
  → If sandbox enabled + autoAllowBashIfSandboxed:
      → Run inside bwrap with filesystem + network restrictions
      → If sandbox setup fails (bwrap error), fallback to unsandboxed
      → If unsandboxed fallback + allowUnsandboxedCommands: true → permission prompt
```

---

## Practical Workflows

### Workflow 1: New npm package needs a domain

1. `npm install some-package` fails with network sandbox error
2. Claude prompts: allow once or permanently?
3. If "permanently": adds domain to `sandbox.network.allowedDomains` in `.claude/settings.json`
4. To do it manually: edit `.claude/settings.json` → `sandbox.network.allowedDomains` array

### Workflow 2: Tool needs write access outside CWD

1. Command tries to write to `/some/other/path`
2. Sandbox blocks the write
3. Fix: Add `"Edit(//some/other/path/**)"` to `permissions.allow` in `.claude/settings.json`
4. Or: Add `"/some/other/path"` to `additionalDirectories`

### Workflow 3: Evaluating what's currently allowed

```bash
# See all sandbox + permission config
cat .claude/settings.json | jq '{sandbox, permissions}'

# See what the session actually got (look at system prompt)
# Or use /permissions command in Claude Code

# Compare across files
diff <(cat .claude/settings.json | jq '.sandbox') <(cat ~/.claude/settings.json | jq '.sandbox')
```

### Workflow 4: Making changes persist across worktree resets

Edit the template in `explainanything-feature0/.claude/settings.json` (or `.local.json`). The `reset_worktrees` script copies settings from feature0 to all new worktrees, with path substitution for `.local.json`.

---

## Related Projects

| Project | Relevance |
|---------|-----------|
| `simplify_settings_20260223` | Reducing 146 allow entries to 57 (removes redundant Bash entries covered by sandbox auto-approval) |
| `fix_sandbox_settings_20260224` | Fixed bwrap/AppArmor issue on Ubuntu 24.04+ that was preventing sandbox from actually running |

---

## Open Questions

1. Should we create a script/hook that audits the current sandbox config and suggests cleanup?
2. Should `additionalDirectories` be used more instead of broad `Edit()` allow rules?
3. Is the current `allowedDomains` list minimal enough, or are there stale entries?
4. Should we document the session whitelist evaluation process in `managing_claude_settings.md`?

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered during initialization)
- docs/docs_overall/managing_claude_settings.md
- docs/feature_deep_dives/admin_panel.md
- docs/feature_deep_dives/link_whitelist_system.md
- docs/docs_overall/environments.md

### Related Planning Docs
- docs/planning/fix_sandbox_settings_20260224/fix_sandbox_settings_20260224_research.md
- docs/planning/simplify_settings_20260223/simplify_settings_20260223_research.md

### Official Claude Code Documentation (web)
- https://code.claude.com/docs/en/settings — Settings hierarchy, sandbox config keys, precedence
- https://code.claude.com/docs/en/permissions — Permission rule syntax, deny/ask/allow evaluation, tool-specific rules
- https://code.claude.com/docs/en/sandboxing — Sandbox architecture, /sandbox command, OS enforcement, escape hatches

## Code Files Read
- .claude/settings.json — project settings (permissions, sandbox, hooks, plugins, MCP)
- .claude/settings.local.json — local overrides (font domains, MCP)
- ~/.claude/settings.json — user global settings (currently empty `{}`)
- reset_worktrees — worktree reset script (copies settings from feature0 template)
