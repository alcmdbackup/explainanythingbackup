# Simplify Settings Research

## Problem Statement
Simplify the Claude Code project settings by removing redundant granular Bash permission entries that are unnecessary when sandbox mode with `autoAllowBashIfSandboxed: true` is enabled. The current settings have 146+ allow-list entries, many of which are individual Bash command patterns that the sandbox auto-approval already covers. This will make the settings cleaner, easier to maintain, and consistently rely on the sandbox as the safety mechanism.

## Requirements (from GH Issue #TBD)
- Always use sandbox with auto-approval of bash
- Only maintain settings at project level (`.claude/settings.json`) for simplicity — goes into git
- Disable write/edit access to global (`~/.claude/settings.json`) and local (`.claude/settings.local.json`) settings
- Always be prompted before project-level settings updates
- Delete as many redundant permissions as possible

## High Level Summary

With sandbox + `autoAllowBashIfSandboxed`, all 57 `Bash(...)` allow entries are redundant. 32 MCP entries reference servers no longer configured. Using the `ask` permission array (evaluated before `allow`), we can explicitly force prompting for project settings edits. The deny list blocks dangerous commands even with sandbox auto-approval. Total reduction: 146 → 57 allow entries (61%).

## Key Findings from Official Docs

### Permission System (from code.claude.com/docs/en/permissions)

**Three permission arrays**, evaluated in order (first match wins):
1. **deny** — checked first, blocks entirely
2. **ask** — checked second, always prompts user
3. **allow** — checked last, auto-approves

**Settings precedence** (highest wins):
1. Managed settings (system-level, can't be overridden)
2. Command line arguments
3. Local project settings (`.claude/settings.local.json`)
4. Shared project settings (`.claude/settings.json`)
5. User settings (`~/.claude/settings.json`)

**Important**: More specific scopes completely override lower scopes for each array — they do NOT merge. If project settings define a `deny` array, it replaces (not appends to) the user settings' `deny` array.

**Path syntax for Read/Edit rules** (gitignore-style):
| Pattern | Meaning | Example |
|---------|---------|---------|
| `//path` | Absolute from filesystem root | `Edit(//Users/alice/secrets/**)` |
| `~/path` | From home directory | `Edit(~/.claude/settings.json)` |
| `/path` | Relative to settings file | `Edit(/src/**/*.ts)` |
| `./path` or `path` | Relative to current directory | `Edit(.claude/settings.json)` |

**Glob patterns**: `*` matches within a single directory; `**` matches recursively across directories.

### Sandbox System (from code.claude.com/docs/en/sandboxing)

**`autoAllowBashIfSandboxed` behavior:**

| Tool | Affected by sandbox auto-approval? |
|------|-------------------------------------|
| Bash | Yes — auto-approved when sandboxed |
| Edit | No — still requires permission rules |
| Read | No — still requires permission rules |
| Write | No — still requires permission rules |
| WebFetch | No — still requires permission rules |
| MCP tools | No — still requires permission rules |

**Sandbox + deny interaction**: Deny rules ALWAYS take precedence. Even with `autoAllowBashIfSandboxed: true`, commands matching deny rules are blocked.

**Key sandbox settings:**
```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["docker"],
    "allowUnsandboxedCommands": true,
    "network": {
      "allowedDomains": ["github.com", "*.npmjs.org"]
    }
  }
}
```

**OS enforcement**: Linux uses bubblewrap (bwrap), macOS uses Seatbelt. All child processes inherit sandbox restrictions.

**Escape hatch**: When `allowUnsandboxedCommands: true` (default), commands that fail due to sandbox restrictions can retry with `dangerouslyDisableSandbox` — but that goes through normal permission flow (user prompted). Can be disabled with `allowUnsandboxedCommands: false`.

### The `ask` Permission Array (from code.claude.com/docs/en/permissions)

The `ask` array is the right tool for "always prompt for settings edits":
- Evaluated BEFORE allow rules (deny → ask → allow, first match wins)
- Explicit and self-documenting — intent is clear
- Can't be accidentally bypassed by a broad allow rule added later
- Unlike relying on "not in allow list", `ask` is a positive declaration

## Current Settings Audit

### Active MCP Sources
| Source | Config Location | Tool Prefix |
|--------|----------------|-------------|
| Supabase | `.claude/settings.json` mcpServers | `mcp__supabase__` |
| Honeycomb | `.mcp.json` | `mcp__honeycomb__` |
| Playwright plugin | enabledPlugins | `mcp__plugin_playwright_playwright__` |
| Sentry plugin | enabledPlugins | `mcp__plugin_sentry_sentry__` |
| Superpowers Chrome plugin | enabledPlugins | `mcp__plugin_superpowers-chrome_chrome__` |

### Stale MCP Entries (32 total — servers no longer configured)
| Old Prefix | Count | Why stale |
|-----------|-------|-----------|
| `mcp__playwright__` | 10 | Replaced by plugin version (`mcp__plugin_playwright_playwright__`) |
| `mcp__puppeteer__` | 5 | No puppeteer server configured anywhere |
| `mcp__browser-tools__` | 2 | No browser-tools server configured |
| `mcp__filesystem__` | 6 | No filesystem server configured |
| `mcp__sequential-thinking__` | 1 | No sequential-thinking server configured |
| `mcp__context7__` | 2 | No context7 server configured |
| `mcp__shadcn__` | 2 | No shadcn server configured |
| `mcp__vercel-explainanything__` | 3 | No vercel-explainanything server configured |
| `mcp__vercel__` | 1 | No vercel server configured |

### Bash Entries (57 total — all redundant with sandbox)
All `Bash(command:*)` entries in the allow list are auto-approved by sandbox mode. The deny list continues to block dangerous commands (`bash`, `curl`, `node`, `gh api`, supabase writes) regardless.

### Settings Tier Analysis
| File | Current State | Target State |
|------|--------------|--------------|
| `~/.claude/settings.json` (global) | `{}` (empty) | Deny Edit/Write |
| `.claude/settings.json` (project) | 146 allow, 8 deny, hooks, plugins, MCP | 57 allow, 12 deny, 2 ask, hooks, plugins, MCP, sandbox |
| `.claude/settings.local.json` (local) | sandbox config, enableAllProjectMcpServers, honeycomb | `{}` (empty, deny Edit/Write) |

## Recommended Setup

The recommended configuration is safe, practical, and maintainable:

1. **Sandbox as primary safety net** — OS-level isolation for all Bash commands
2. **Deny list as hard blocks** — dangerous commands blocked regardless of sandbox
3. **Ask list for settings self-protection** — Claude always prompts before editing its own config
4. **Allow list only for non-Bash tools** — MCP, WebFetch, file patterns, skills that can't be sandboxed
5. **Single settings file** — everything in `.claude/settings.json`, committed to git

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Web Docs (Claude Code official documentation)
- https://code.claude.com/docs/en/security — Security safeguards, permission architecture, prompt injection protection
- https://code.claude.com/docs/en/settings — Settings hierarchy, precedence, sandbox config, permission merging
- https://code.claude.com/docs/en/permissions — Permission rule syntax, deny/ask/allow evaluation, path patterns, tool-specific rules
- https://code.claude.com/docs/en/sandboxing — Sandbox behavior, autoAllowBashIfSandboxed scope, OS enforcement, escape hatches

## Code Files Read
- .claude/settings.json (146 allow entries, 8 deny entries, hooks, plugins, MCP servers)
- .claude/settings.local.json (sandbox config, enableAllProjectMcpServers, honeycomb)
- .mcp.json (honeycomb HTTP MCP server)
