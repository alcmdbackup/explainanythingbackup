# Fix Sandbox Settings Research

## Problem Statement
Getting `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` errors when Claude Code runs bash commands in sandbox mode. Commands fail with exit code 1 even for simple operations like `git status` and `mkdir`. Need to understand what causes this error and how to fix the sandbox configuration.

## Requirements (from GH Issue #547)
- Understand the `bwrap` (bubblewrap) loopback error and what triggers it
- Fix the sandbox settings so commands run reliably without needing `dangerouslyDisableSandbox`

## High Level Summary

The error is caused by **Ubuntu 24.04+'s AppArmor restriction on unprivileged user namespaces** (`kernel.apparmor_restrict_unprivileged_userns=1`), NOT a Claude Code configuration issue. When bubblewrap tries to create a network namespace with `--unshare-net` and configure the loopback interface, AppArmor blocks the `RTM_NEWADDR` netlink message. The fix is to create an AppArmor profile granting bwrap the `userns` capability — this preserves full sandbox security while allowing bwrap to function.

## Root Cause Analysis

### What is bwrap?
- **Bubblewrap (bwrap)** is a low-level unprivileged sandboxing tool using Linux kernel namespaces
- Claude Code uses it on Linux/WSL2 for filesystem and network isolation (macOS uses Apple's Seatbelt)
- It creates sandboxes via `clone(2)` with `CLONE_NEWNET` (network namespace) and `CLONE_NEWPID` (PID namespace)
- Network isolation works by creating a new namespace and routing traffic through a `socat`-based proxy for domain filtering
- Open source: [anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)

### Why the error occurs
1. Ubuntu 24.04 LTS introduced `kernel.apparmor_restrict_unprivileged_userns=1` **enabled by default**
2. When bwrap runs with `--unshare-net`, it creates a new network namespace
3. It then tries to configure loopback by sending `RTM_NEWADDR` netlink message (assign 127.0.0.1)
4. AppArmor blocks this operation for unprivileged processes
5. Result: `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`

### This is a kernel/OS issue, NOT a Claude Code bug
- The project's sandbox configuration is correct
- bwrap code itself is correct
- Ubuntu's new AppArmor policy is blocking a previously-allowed kernel operation
- Tracked upstream: [bubblewrap#632](https://github.com/containers/bubblewrap/issues/632), [Launchpad#2069526](https://bugs.launchpad.net/ubuntu/+source/apparmor/+bug/2069526)
- Affects all bwrap users: Flatpak, OPAM, Claude Code, etc.

## Impact of the Error

The error is **non-fatal but has significant security and usability consequences**:

### What happens when bwrap fails
1. Sandbox setup fails (can't create network namespace)
2. The command **still runs** — Claude Code falls back to executing outside the sandbox
3. stderr shows the bwrap error and `Exit code 1`, but the command output is usually still there
4. Sometimes the fallback works silently; sometimes (e.g. `git status --porcelain`) it appears to produce no output

### Security impact
- **Every bash command runs unsandboxed** — no filesystem write restrictions, no network domain filtering
- Effectively operating in `dangerouslyDisableSandbox` mode for all commands, just with extra error noise
- The `autoAllowBashIfSandboxed: true` setting becomes useless — nothing is actually sandboxed, so commands go through the normal permission flow instead of being auto-approved

### Usability impact
- **Some commands appear to fail** when they actually succeeded (bwrap's exit code 1 masks the real exit code)
- Spurious error messages clutter output
- Claude sometimes retries with `dangerouslyDisableSandbox: true`, adding unnecessary permission prompts

### What still works regardless
- Built-in tools (Read, Write, Edit, Glob, Grep) — never go through bwrap
- Permission deny lists — enforced by Claude Code itself, not the sandbox
- The `excludedCommands` list — irrelevant since nothing is sandboxed anyway

### Summary
The sandbox is configured but **not actually running**. Commands work but without any OS-level isolation.

## Fixes (ordered by security preservation)

### Fix 1: AppArmor profile for bwrap (RECOMMENDED)
Create `/etc/apparmor.d/bwrap`:
```
abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
```
Then: `sudo systemctl reload apparmor`

- Most targeted fix — only grants bwrap the `userns` capability
- Keeps AppArmor restrictions for all other applications
- One-time system configuration

### Fix 2: AppArmor SRU from PPA
```bash
sudo add-apt-repository ppa:apparmor-dev/apparmor-sru
sudo apt update && sudo apt install apparmor
```
- Installs AppArmor 4.0.1+ with proper bwrap profiles built-in

### Fix 3: Disable kernel restriction (less secure)
```bash
sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0
# Persist: echo "kernel.apparmor_restrict_unprivileged_userns=0" | sudo tee /etc/sysctl.d/99-bwrap.conf
```
- Disables AppArmor userns restrictions system-wide — reduces security

### Fix 4: `enableWeakerNestedSandbox` (for Docker environments)
In settings.json: `"sandbox": { "enableWeakerNestedSandbox": true }`
- Only for Docker containers where the container itself enforces isolation

### Fix 5: Disable sandbox entirely (NOT recommended)
- Use `dangerouslyDisableSandbox: true` per-command or `/sandbox` to disable globally
- Eliminates all sandbox protection

## Current Project Sandbox Configuration

### .claude/settings.json (project-level)
```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["git", "gh", "docker", "tmux"],
    "network": {
      "allowedDomains": [
        "registry.npmjs.org", "*.npmjs.org", "*.supabase.co",
        "api.openai.com", "api.anthropic.com", "api.deepseek.com",
        "*.pinecone.io", "api.honeycomb.io", "*.sentry.io",
        "*.grafana.net", "playwright.azureedge.net",
        "playwright-akamai.azureedge.net", "api.github.com",
        "localhost", "127.0.0.1"
      ]
    }
  }
}
```

**Configuration is correct** — the issue is at the OS level, not in these settings.

### Settings hierarchy
1. Managed settings (enterprise) — not present
2. Command line arguments
3. `.claude/settings.local.json` — MCP server config only
4. `.claude/settings.json` — main config (permissions, sandbox, hooks, plugins)
5. `~/.claude/settings.json` — user global

### How sandbox works in Claude Code
- All bash commands run inside bwrap when `enabled: true`
- `excludedCommands` bypass sandbox (use normal permission flow)
- `autoAllowBashIfSandboxed: true` auto-approves bash commands IF sandboxed
- Deny list always enforced even for sandboxed commands
- Built-in tools (Glob, Read, Write, Grep) run at host level, NOT sandboxed
- Only Bash commands and child processes are sandboxed by bwrap

### System context
- Kernel: 6.17.0-14-generic
- OS: Ubuntu (likely 24.04+ based on kernel version)
- `kernel.apparmor_restrict_unprivileged_userns` is likely enabled (default on Ubuntu 24.04+)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — documentation structure
- docs/docs_overall/architecture.md — system design, not directly relevant
- docs/docs_overall/project_workflow.md — workflow process

### Relevant Docs
- docs/docs_overall/managing_claude_settings.md — settings hierarchy, permission syntax, worktree reset behavior
- docs/docs_overall/environments.md — environment configs, CI/CD workflows
- docs/docs_overall/testing_overview.md — testing tiers, CI workflows
- docs/feature_deep_dives/testing_setup.md — test configuration, mocking patterns

## Code Files Read
- .claude/settings.json — main project config with sandbox settings
- .claude/settings.local.json — local MCP config only

## Key Findings

1. **Root cause is Ubuntu AppArmor**, not Claude Code config — `kernel.apparmor_restrict_unprivileged_userns=1` blocks bwrap's network namespace setup
2. **Fix 1 (AppArmor profile) is the recommended solution** — targeted, preserves security, one-time setup
3. **Project sandbox config is correct** — `enabled: true`, `autoAllowBashIfSandboxed: true`, proper network allowlist
4. **Related project exists** — `simplify_settings_20260223` plans to reduce 146 allow-list entries to 17 (57 redundant Bash entries covered by `autoAllowBashIfSandboxed`)
5. **Built-in tools are NOT sandboxed** — only Bash commands go through bwrap; Glob/Read/Write/Grep run at host level

## Open Questions

1. Is the AppArmor profile fix sufficient for our kernel version (6.17.0-14-generic)?
2. Should we document this fix in `managing_claude_settings.md` for other developers on the team?
3. Does the `simplify_settings_20260223` project need to coordinate with this fix?

## Sources

- [sandbox-runtime Issue #74](https://github.com/anthropic-experimental/sandbox-runtime/issues/74) — bwrap fails on Ubuntu 24.04+
- [Claude Code Sandboxing Docs](https://code.claude.com/docs/en/sandboxing)
- [bubblewrap Issue #632](https://github.com/containers/bubblewrap/issues/632) — Ubuntu 24.04 breakage
- [Launchpad Bug #2069526](https://bugs.launchpad.net/ubuntu/+source/apparmor/+bug/2069526) — AppArmor userns restriction
- [Russell Coker's blog](https://etbe.coker.com.au/2024/04/24/ubuntu-24-04-bubblewrap/) — AppArmor profile fix
- [Anthropic Engineering — Claude Code Sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)
