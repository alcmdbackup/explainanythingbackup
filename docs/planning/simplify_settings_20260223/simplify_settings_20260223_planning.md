# Simplify Settings Plan

## Background
The project `.claude/settings.json` has accumulated 146 allow-list entries over time, including 57 granular `Bash(...)` patterns and 32 stale MCP tool permissions from servers no longer configured. With sandbox mode + `autoAllowBashIfSandboxed`, all Bash commands are auto-approved (the sandbox itself is the safety net), making individual Bash allow entries redundant. Settings are also split across 3 tiers (global, project, project-local) when only project-level is needed.

## Requirements (from GH Issue #TBD)
- Always use sandbox with auto-approval of bash
- Only maintain settings at project level (`.claude/settings.json`) for simplicity — goes into git
- Disable write/edit access to global (`~/.claude/settings.json`) and local (`.claude/settings.local.json`) settings
- Always be prompted before project-level settings updates (`.claude/settings.json` must NOT be in the allow list)
- Forbid file modifications outside `~/Documents/ac/` (scoped Edit/Write allows)
- Delete as many redundant permissions as possible

## Problem
The current settings file is bloated with 146 allow-list entries, many redundant. 57 are individual `Bash(command:*)` patterns that sandbox auto-approval makes unnecessary. 32 are MCP tool permissions for servers no longer configured (puppeteer, browser-tools, filesystem, sequential-thinking, context7, shadcn, vercel, old standalone playwright). Settings are fragmented across 3 files when only one is needed.

## Options Considered

### Option A: Remove only Bash entries (minimal)
- Remove 57 `Bash(...)` allow entries, keep everything else
- Pro: Safest, smallest change
- Con: Leaves 32 stale MCP entries, doesn't consolidate settings files

### Option B: Remove Bash + stale MCP + consolidate with wildcards (recommended)
- Remove 57 Bash entries + 32 stale MCP entries + consolidate 35 active MCP entries into 2 wildcards
- Net: 146 → 17 allow entries (88% reduction)
- Consolidate settings.local.json into settings.json
- Add sandbox config to project settings
- Add deny rules for global/local settings, ask rules for project settings
- Pro: Clean, consistent, single source of truth, easy to read
- Con: Slightly larger change, but all removals are clearly dead/redundant entries

### Option C: Aggressive — also remove plugin MCP entries entirely
- Same as B, but remove `mcp__plugin_*` entries and rely on plugins to auto-approve
- Con: Plugin tools do NOT auto-approve — they still need allow-list entries. Would break workflow.

**Decision: Option B**

## Phased Execution Plan

### Phase 1: Enable sandbox in project settings
**File: `.claude/settings.json`**
- Move `"enableAllProjectMcpServers": true` from settings.local.json to settings.json
- Move `"enabledMcpjsonServers": ["honeycomb"]` from settings.local.json to settings.json
- Add full sandbox config:

```json
"sandbox": {
  "enabled": true,
  "autoAllowBashIfSandboxed": true,
  "excludedCommands": ["git", "gh", "docker", "tmux"],
  "network": {
    "allowedDomains": [
      "registry.npmjs.org",
      "*.npmjs.org",
      "*.supabase.co",
      "api.openai.com",
      "api.anthropic.com",
      "api.deepseek.com",
      "*.pinecone.io",
      "api.honeycomb.io",
      "*.sentry.io",
      "*.grafana.net",
      "playwright.azureedge.net",
      "playwright-akamai.azureedge.net",
      "api.github.com",
      "localhost",
      "127.0.0.1"
    ]
  }
}
```

**Excluded commands** (run OUTSIDE sandbox, go through normal permission flow):
- `git` — needs SSH/HTTPS auth, credential helpers, global config access
- `gh` — needs GitHub API auth, credential helpers
- `docker` — incompatible with bubblewrap sandboxing
- `tmux` — needs access to tmux sockets and session state

**Network domains by purpose:**
| Domain | Why |
|--------|-----|
| `registry.npmjs.org`, `*.npmjs.org` | npm install / npx |
| `*.supabase.co` | Supabase API (DB, auth) during tests |
| `api.openai.com` | OpenAI API calls |
| `api.anthropic.com` | Anthropic API calls |
| `api.deepseek.com` | DeepSeek API calls |
| `*.pinecone.io` | Pinecone vector search |
| `api.honeycomb.io` | OpenTelemetry export |
| `*.sentry.io` | Sentry error reporting |
| `*.grafana.net` | Grafana Cloud observability |
| `playwright.azureedge.net`, `playwright-akamai.azureedge.net` | Playwright browser downloads |
| `api.github.com` | GitHub API (backup for gh CLI) |
| `localhost`, `127.0.0.1` | Local dev servers during tests |

### Phase 2: Remove redundant Bash allow entries
**File: `.claude/settings.json`**
Remove all 57 `Bash(...)` entries from the allow list:
```
Bash(npm run:*)          Bash(npm test:*)         Bash(npm install:*)
Bash(npm uninstall:*)    Bash(npx tsc:*)          Bash(npx tsx:*)
Bash(npx eslint:*)       Bash(npx jest:*)         Bash(npx shadcn@latest:*)
Bash(npx playwright test:*)  Bash(timeout:*)      Bash(E2E_TEST_MODE=true npx playwright test:*)
Bash(E2E_TEST_MODE=true timeout:*)
Bash(git log:*)          Bash(git status:*)       Bash(git show:*)
Bash(git diff:*)         Bash(git ls-tree:*)      Bash(git worktree:*)
Bash(git add:*)          Bash(git commit:*)       Bash(git push:*)
Bash(git fetch:*)        Bash(git checkout:*)     Bash(git rebase:*)
Bash(git cherry-pick:*)  Bash(git stash:*)
Bash(gh repo view:*)     Bash(gh pr checks:*)     Bash(gh pr create:*)
Bash(gh run view:*)      Bash(gh run list:*)      Bash(gh run rerun:*)
Bash(gh run download:*)  Bash(gh issue create:*)  Bash(gh pr list:*)
Bash(ls:*)               Bash(cat:*)              Bash(grep:*)
Bash(logcli:*)           Bash(find:*)             Bash(tree:*)
Bash(tail:*)             Bash(comm:*)             Bash(du -sh:*)
Bash(lsof:*)             Bash(mkdir:*)            Bash(mv:*)
Bash(echo:*)             Bash(tee:*)              Bash(sed:*)
Bash(kill:*)             Bash(pkill:*)            Bash(xargs kill:*)
Bash(xargs ls:*)         Bash(bash reset_worktrees:*)
```

### Phase 3: Remove stale MCP + consolidate active MCP with wildcards
**File: `.claude/settings.json`**

**Remove** 32 stale MCP entries for servers/plugins no longer configured:
```
mcp__playwright__*           (10 entries — replaced by plugin version)
mcp__puppeteer__*            (5 entries — no puppeteer server)
mcp__browser-tools__*        (2 entries — no browser-tools server)
mcp__filesystem__*           (6 entries — no filesystem server)
mcp__sequential-thinking__*  (1 entry — no sequential-thinking server)
mcp__context7__*             (2 entries — no context7 server)
mcp__shadcn__*               (2 entries — no shadcn server)
mcp__vercel-explainanything__* (3 entries — no vercel-explainanything server)
mcp__vercel__*               (1 entry — no vercel server)
```

**Consolidate** active MCP plugin entries using server-level wildcards (per docs: `mcp__<server>` matches all tools from that server):
```
22 mcp__plugin_playwright_playwright__* entries → mcp__plugin_playwright_playwright
13 mcp__plugin_sentry_sentry__* entries         → mcp__plugin_sentry_sentry
```
This collapses 35 individual entries into 2.

### Phase 4: Protect all settings files
**File: `.claude/settings.json`**

Per the official docs, permission rules support three arrays evaluated in order: **deny → ask → allow** (first match wins).

Three protection levels:
1. **Global settings** (`~/.claude/settings.json`) — **deny** (blocked entirely, cannot be overridden)
2. **Local settings** (`.claude/settings.local.json`) — **deny** (blocked entirely)
3. **Project settings** (`.claude/settings.json`) — **ask** (always prompts user for approval)

Add to **deny** list:
```json
"Edit(~/.claude/settings.json)",
"Write(~/.claude/settings.json)",
"Edit(.claude/settings.local.json)",
"Write(.claude/settings.local.json)"
```

Add new **ask** list:
```json
"ask": [
  "Edit(.claude/settings.json)",
  "Write(.claude/settings.json)"
]
```

Using `ask` instead of relying on absence from allow list because:
- It's explicit and self-documenting (intent is clear)
- Won't be accidentally bypassed if someone later adds a broad `Edit` allow rule
- The `ask` array is evaluated before `allow`, so it takes precedence

Path syntax per docs:
- `~/path` = home directory (for global settings)
- `./path` or `path` = relative to current directory (for project files)

### Phase 5: Minimize settings.local.json
**File: `.claude/settings.local.json`**
After moving everything to project settings, reduce to empty or minimal:
```json
{}
```
(Or delete entirely if empty is valid.)

### Final state of allow list (17 entries, down from 146 — 88% reduction)
```
# File operations — scoped to ~/Documents/ac/ (2)
# deny/ask rules for settings files take precedence (deny → ask → allow)
# Anything outside ~/Documents/ac/ will prompt (fail-closed default)
Edit(~/Documents/ac/**)
Write(~/Documents/ac/**)

# Generic tools (2)
Playwright
WebSearch

# WebFetch domains (6)
WebFetch(domain:lexical.dev)
WebFetch(domain:github.com)
WebFetch(domain:code.claude.com)
WebFetch(domain:stackoverflow.com)
WebFetch(domain:supabase.com)
WebFetch(domain:grafana.com)

# MCP tools — wildcards match all tools from each server (4)
mcp__supabase__list_tables
mcp__plugin_superpowers-chrome_chrome__use_browser
mcp__plugin_playwright_playwright
mcp__plugin_sentry_sentry

# Skills (3)
Skill(frontend-design)
Skill(superpowers:systematic-debugging)
Skill(superpowers:verification-before-completion)
```

Note: `Read` is not listed because read-only tools never require approval.

**Edit/Write evaluation order for different paths:**
1. `~/.claude/settings.json` → **deny** (blocked)
2. `.claude/settings.local.json` → **deny** (blocked)
3. `.claude/settings.json` → **ask** (always prompts)
4. `~/Documents/ac/**` → **allow** (auto-approved)
5. Anything else → **prompt** (fail-closed default, no matching rule)

### Deny list (unchanged + new entries)
```
# Shell interpreters — prevent nested shells and code execution
Bash(bash:*)
Bash(sh:*)
Bash(zsh:*)
Bash(env:*)

# Script interpreters — prevent arbitrary code execution
Bash(node:*)
Bash(python:*)
Bash(python3:*)
Bash(perl:*)
Bash(ruby:*)
Bash(php:*)
Bash(lua:*)

# Network tools — prevent bypassing WebFetch domain controls
Bash(curl:*)
Bash(wget:*)
Bash(ssh:*)
Bash(nc:*)
Bash(netcat:*)

# Dangerous project-specific commands
Bash(supabase link --project-ref qbxhivoezkfbjbsctdzo:*)
Bash(supabase db push:*)

# Existing — dangerous MCP operations
mcp__supabase__apply_migration
mcp__supabase__execute_sql

# New — protect global and local settings from ANY modification
Edit(~/.claude/settings.json)
Write(~/.claude/settings.json)
Edit(.claude/settings.local.json)
Write(.claude/settings.local.json)
```

### Ask list (new)
```
# Always prompt before modifying project settings
Edit(.claude/settings.json)
Write(.claude/settings.json)
```

## Testing
- Verify sandbox runs by executing a simple bash command (e.g., `ls`)
- Verify deny list still blocks: `bash`, `curl`, `node`, `gh api`
- Verify MCP tools from active plugins still work (playwright, sentry)
- Verify stale MCP tools don't cause errors (they simply won't exist)
- Verify Edit/Write to `~/.claude/settings.json` and `.claude/settings.local.json` are denied
- Verify Edit/Write to `.claude/settings.json` prompts for user approval (not auto-allowed)
- Verify Edit/Write within `~/Documents/ac/` is auto-approved
- Verify Edit/Write outside `~/Documents/ac/` prompts for approval

## Documentation Updates
- `docs/docs_overall/managing_claude_settings.md` — may need update to reflect sandbox-first approach and single-tier strategy
