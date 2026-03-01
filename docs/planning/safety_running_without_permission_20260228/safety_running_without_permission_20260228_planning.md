# Safety Running Without Permission Plan

## Background
I want safeguards so when I run in --dangerously-skip-permissions, nothing is permanently lost and I have Github backup and settings are not changed.

## Requirements (from GH Issue #593)
- Safeguards when running Claude Code with --dangerously-skip-permissions
- Nothing is permanently lost (code, files, data)
- GitHub backup exists before dangerous operations
- Settings files are not changed by Claude Code in skip-permissions mode

## Problem

When running Claude Code with `--dangerously-skip-permissions`, all permission prompts are skipped — any tool call that would normally ask the user is auto-approved. While deny rules, hooks, and sandbox still enforce (verified via SDK docs), the current configuration has 18 identified threat vectors (5 CRITICAL, 9 HIGH, 4 MEDIUM). The root cause is overly broad wildcard allow rules in `settings.json` that auto-approve destructive commands like `sed -i`, `echo >`, `tee`, `git push --force`, and `gh issue create` with command substitution. Additionally, critical files (CLAUDE.md, hooks, root settings.json) have no OS-level write protection, making them modifiable via any allowed bash command.

## Pre-Execution Prerequisite: Verify `permission_mode` Field

**MUST be completed before any Phase 2/3 work begins.**

The entire conditional hook architecture depends on the `permission_mode` field existing in hook stdin JSON. This was documented in the SDK but is unverified for our Claude Code version (2.1.63).

**Verification steps:**
1. Create a temporary test hook that dumps stdin to a file:
   ```bash
   #!/bin/bash
   cat > /tmp/claude-hook-debug.json
   exit 0
   ```
2. Wire it as a PreToolUse hook in `.claude/settings.json`
3. Run Claude in normal mode, trigger any Bash command, inspect `/tmp/claude-hook-debug.json`
4. Run Claude with `--dangerously-skip-permissions`, trigger any Bash command, inspect again
5. Verify: field exists, value is `"default"` in normal mode, `"bypassPermissions"` in bypass mode

**If field does NOT exist:** Fall back to environment variable detection via a wrapper alias (`CLAUDE_UNSAFE=true claude --dangerously-skip-permissions`) as documented in the research doc's Alternative Detection section.

**If field exists:** Proceed with Phases 2-3 as designed.

## Design Principle: Conditional-First

Most restrictions should **only activate in bypass mode** to avoid friction in normal interactive mode where the user reviews every action. The `permission_mode` field in hook stdin JSON (`"bypassPermissions"` when flag is active) enables this.

**Split:**
- **Always-on (deny rules)**: Only for commands that are truly never wanted even interactively — docker escape, chmod/chown, rm -rf .git, reading secrets, Edit/Write to critical files
- **Bypass-mode only (hooks)**: Everything else — force push, destructive git, file writes via Bash to protected paths, data exfiltration, backup push
- **Always-on (OS-level)**: chmod/chattr on critical files — zero UX impact since these files rarely change

## Options Considered

### Option A: Always-On Hardening Only
Add deny rules and chmod/chattr to all critical files regardless of mode. Tighten allow list wildcards.
- **Pros**: Simplest, protects in all modes, no conditional logic
- **Cons**: Over-restricts normal interactive mode, forces prompts for legitimate operations

### Option B: Conditional Hooks Only
Use `permission_mode` field in hook stdin JSON to detect bypass mode and enforce all extra rules.
- **Pros**: Zero friction in normal mode, all enforcement conditional
- **Cons**: Hooks can be bypassed if hook files are modified (mitigated by chmod/chattr)

### Option C: Conditional-First Layered Defense (Recommended)
Minimal always-on deny rules + comprehensive conditional hooks + OS-level file protection.
- **Pros**: Zero friction in normal mode, defense in depth, OS-level protections cover hook bypass gaps
- **Cons**: More setup, but each layer is independently valuable

**Decision: Option C — Conditional-First Layered Defense**

## Phased Execution Plan

### Phase 1: Minimal Always-On Deny Rules
**Goal**: Block the truly never-wanted commands at the deny-rule level. These are commands that even in normal interactive mode you'd never intentionally run.

Add to `permissions.deny` in `.claude/settings.json`:

```json
"deny": [
  // --- Existing deny rules (keep all) ---
  "Bash(bash:*)",
  "Bash(curl:*)",
  "Bash(node:*)",
  "Bash(gh api:*)",
  "Bash(supabase link --project-ref qbxhivoezkfbjbsctdzo:*)",
  "Bash(supabase db push:*)",
  "mcp__supabase__apply_migration",
  "mcp__supabase__execute_sql",

  // --- NEW: Docker escape (full sandbox bypass, never wanted) ---
  "Bash(docker run:*)",
  "Bash(docker exec:*)",
  "Bash(docker-compose:*)",

  // --- NEW: Permission manipulation (never wanted) ---
  "Bash(chmod:*)",
  "Bash(chown:*)",

  // --- NEW: Git internals destruction (never wanted) ---
  "Bash(rm -rf .git:*)",

  // --- NEW: Secret protection (Claude never needs API keys) ---
  "Read(.env.local)",
  "Read(.env.production)",
  "Read(.env.development)",

  // --- NEW: Protect critical files from Edit/Write tools ---
  // (In bypass mode, Edit/Write auto-approve without Bash — must deny at rule level)
  // Uses /path syntax = relative to project root (per gitignore spec)
  "Edit(/CLAUDE.md)",
  "Write(/CLAUDE.md)",
  "Edit(.claude/hooks/**)",
  "Write(.claude/hooks/**)",
  "Edit(.claude/doc-mapping.json)",
  "Write(.claude/doc-mapping.json)",
  "Edit(.claude/commands/**)",
  "Write(.claude/commands/**)",
  "Edit(/settings.json)",
  "Write(/settings.json)",

  // --- NEW: Block MCP filesystem write tools (bypass Bash protections entirely) ---
  "mcp__filesystem__write_text_file",
  "mcp__filesystem__move_file",
  "mcp__filesystem__create_directory"
]
```

**Changes from previous versions (addressing review feedback):**
- **Read(.env\*)** replaced with specific filenames to avoid blocking `.env.example` and similar committed templates
- **Edit/Write deny rules added** with `/path` syntax (relative to project root per gitignore spec) — `Edit(/CLAUDE.md)` matches only the root CLAUDE.md, not files with that name in subdirectories. `Edit(/settings.json)` matches only the root settings.json, NOT `.claude/settings.json` (which keeps its existing ask rule)
- **`.claude/commands/**` added** to Edit/Write deny rules (was missing in previous version despite being in hook's PROTECTED pattern)
- **MCP filesystem write tools denied** — these bypass all Bash-level protections entirely

**Why Edit/Write denies are always-on**: Unlike force-push or git reset, there's no legitimate reason for Claude to edit CLAUDE.md, hook scripts, or settings files autonomously. In normal mode, the deny rule prevents accidental modifications. The user can still edit these files manually or temporarily remove the deny rule.

**Stdin handling note**: Each hook in a matcher array is spawned as a separate process by Claude Code. Stdin is provided independently to each hook — no consumption conflicts. The existing Bash PreToolUse hooks (`block-manual-server.sh`, `block-supabase-writes.sh`) use the `$TOOL_INPUT` env var and don't read stdin at all.

### Phase 2: Conditional Bypass-Mode Safety Hook (PreToolUse)
**Goal**: Block dangerous Bash operations that are only risky in bypass mode (where you're not reviewing each command).

**Prerequisite**: `permission_mode` field verified (see Pre-Execution Prerequisite above).

Create `.claude/hooks/enforce-bypass-safety.sh`:

```bash
#!/bin/bash
# Conditional safety enforcer: only active in --dangerously-skip-permissions mode.
# In normal interactive mode, exits immediately with zero overhead.

INPUT=$(cat)
PERMISSION_MODE=$(echo "$INPUT" | jq -r '.permission_mode // empty')

# Fast path: do nothing in normal mode
if [ "$PERMISSION_MODE" != "bypassPermissions" ]; then
  exit 0
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only inspect Bash commands (Edit/Write protected by always-on deny rules in Phase 1)
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Normalize extra whitespace (prevents "git  push  --force" evasion)
COMMAND=$(printf '%s' "$COMMAND" | tr -s ' ')

deny() {
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"[BYPASS SAFETY] $1\"}}"
  exit 0
}

# --- Protected file patterns ---
PROTECTED="CLAUDE\.md|/settings\.json|\.claude/hooks/|\.claude/doc-mapping|\.claude/commands/|\.env\."

# Normalize command: replace && || ; with newlines, then check each line
# This catches "echo x && echo y > CLAUDE.md" where the dangerous part is a later sub-command
# Uses sed for string-level splitting (not tr which does character-level)
NORMALIZED=$(printf '%s' "$COMMAND" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g')

# File writes to protected paths (via redirect, tee, sed -i, cp, mv, dd, truncate, rm)
if printf '%s' "$NORMALIZED" | grep -qE "(>|tee |sed -i|cp |mv |dd |truncate |rm ).*($PROTECTED)"; then
  deny "Blocked: write to protected file in bypass mode"
fi

# Echo/cat/printf redirect to protected files
if printf '%s' "$NORMALIZED" | grep -qE "(echo|cat|printf).*>.*($PROTECTED)"; then
  deny "Blocked: redirect to protected file in bypass mode"
fi

# Force push (any variant, any flag position, including +refspec syntax)
# Uses [+] instead of \+ because ERE treats \+ as one-or-more quantifier
if printf '%s' "$COMMAND" | grep -qE "git push.*(--force|--force-with-lease|-f( |$))|git push [^ ]+ [+]"; then
  deny "Blocked: force push in bypass mode"
fi

# Destructive git operations (reset --hard allowed — backup hook ensures recovery)
# Covers combined flags (-xfd, -dfx, etc.) and long (--force) forms of git clean
if printf '%s' "$COMMAND" | grep -qE "git (clean (-[a-zA-Z]*f[a-zA-Z]*|--force)|checkout -- \.|restore -- \.|stash (drop|clear)|branch -D)"; then
  deny "Blocked: destructive git operation in bypass mode"
fi

# git apply (patch content not inspectable)
if printf '%s' "$COMMAND" | grep -qE "git apply"; then
  deny "Blocked: git apply in bypass mode (patch content not inspectable)"
fi

# git add -A / git add . (bulk staging)
if printf '%s' "$COMMAND" | grep -qE "git add (-A|\.( |$))"; then
  deny "Blocked: bulk git staging in bypass mode"
fi

# git commit --amend (rewrites last commit)
if printf '%s' "$COMMAND" | grep -qE "git commit.*--amend"; then
  deny "Blocked: commit amend in bypass mode"
fi

# Data exfiltration via gh (block command substitution via $() or backticks in body/title args)
if printf '%s' "$COMMAND" | grep -qE "gh (gist create|issue create.*(\\$\\(|\`)|pr create.*(\\$\\(|\`))"; then
  deny "Blocked: potential data exfiltration in bypass mode"
fi

# Mass process kill
if printf '%s' "$COMMAND" | grep -qE "(kill -[0-9]+ -1|pkill -f \"\\.\\*\")"; then
  deny "Blocked: mass process kill in bypass mode"
fi

# rm -rf on project directories
if printf '%s' "$COMMAND" | grep -qE "rm -rf (src|docs|\.claude|node_modules|public)"; then
  deny "Blocked: recursive delete of project directory in bypass mode"
fi

# ln -s targeting protected files (symlink attack vector)
if printf '%s' "$COMMAND" | grep -qE "ln -s.*($PROTECTED)"; then
  deny "Blocked: symlink to protected file in bypass mode"
fi

# timeout wrapping denied commands (bypass vector)
if printf '%s' "$COMMAND" | grep -qE "timeout [0-9]+s? (docker|chmod|chown|rm -rf \.git)"; then
  deny "Blocked: timeout wrapping denied command in bypass mode"
fi

exit 0
```

Wire into `.claude/settings.json` as first PreToolUse hook for Bash matcher. Hooks in the same matcher array run sequentially; a deny from any hook stops execution.

### Phase 3: Conditional Backup Hook (SessionStart)
**Goal**: Automatically push branch and tag state to GitHub before bypass-mode sessions, ensuring recovery is always possible.

**Prerequisite**: `permission_mode` field verified (see Pre-Execution Prerequisite above).

Create `.claude/hooks/backup-on-bypass.sh`:

```bash
#!/bin/bash
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

REMOTE="origin"
LOGFILE="$CWD/.claude/logs/backup-audit.log"
mkdir -p "$(dirname "$LOGFILE")" 2>/dev/null

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" >> "$LOGFILE" 2>/dev/null
  echo "$1" >&2
}

# Push branch to remote for backup
if timeout 15s git push "$REMOTE" "$BRANCH" 2>/dev/null; then
  log "[BYPASS SAFETY] Pushed $BRANCH to $REMOTE"
else
  log "[BYPASS SAFETY] WARNING: Failed to push $BRANCH to $REMOTE — backup may not exist!"
fi

# Tag the pre-session state
TAG="backup/pre-bypass-$(date -u +%Y%m%dT%H%M%SZ)"
if git tag "$TAG" HEAD 2>/dev/null; then
  if timeout 10s git push "$REMOTE" "$TAG" 2>/dev/null; then
    log "[BYPASS SAFETY] Tagged and pushed $TAG"
  else
    log "[BYPASS SAFETY] WARNING: Tagged $TAG locally but failed to push to remote!"
  fi
else
  log "[BYPASS SAFETY] WARNING: Failed to create tag $TAG (may already exist from rapid restart)"
fi

exit 0
```

**Changes from previous version (addressing review feedback):**
- Uses hardcoded `"origin"` instead of `git remote | head -1` (consistent with existing hooks)
- Logs success/failure to `.claude/logs/backup-audit.log` instead of silently swallowing errors
- Emits WARNING messages to stderr when backup fails, so user sees the failure
- Handles tag collision from rapid restarts gracefully

Wire as first SessionStart hook entry (before `fresh-branch-on-startup.sh`). No matcher needed — should fire on all session start events (startup, resume, clear, compact).

**Note**: Add `.claude/logs/` to `.gitignore` to prevent accidental commits of audit logs.

### Phase 4: OS-Level File Protection
**Goal**: Make critical files immutable as defense-in-depth. This catches what hooks can't — variable indirection, symlinks, subshell escapes. Zero UX impact since these files rarely change.

**Explicit file list** (full paths from project root):

```bash
# Read-only permissions
chmod 444 CLAUDE.md
chmod 444 settings.json
chmod 444 .claude/doc-mapping.json
chmod 444 .claude/hooks/*.sh

# Directory permissions (prevent new file creation)
chmod 555 .claude/hooks
chmod 555 .claude/commands

# Immutable flag (strongest — requires sudo chattr -i to undo)
# NOTE: Requires sudo. Local-dev only, not applicable in CI.
sudo chattr +i CLAUDE.md
sudo chattr +i settings.json
sudo chattr +i .claude/doc-mapping.json
sudo chattr +i .claude/hooks/*.sh
```

Create convenience scripts:

**`scripts/protect-files.sh`** — applies chmod 444 + chattr +i to all critical files. Idempotent (safe to run twice).
**`scripts/unprotect-files.sh`** — removes chattr -i + restores chmod 644/755. Idempotent.

**Important**: These scripts use `chmod` which is denied by Phase 1 deny rules. They must be run **outside Claude Code** (directly in your terminal). The scripts themselves should also be protected (chmod 444 + chattr +i) to prevent Claude from running `scripts/unprotect-files.sh` in bypass mode.

**Workflow for legitimate edits**:
1. In your terminal (not Claude): `sudo bash scripts/unprotect-files.sh`
2. Make your edits (manually or via Claude in normal mode with deny rule temporarily removed)
3. In your terminal: `sudo bash scripts/protect-files.sh`

### Phase 5: Automated Hook Test Harness
**Goal**: Ensure hook correctness survives Claude Code version upgrades, hook modifications, and regex edge cases.

Create `scripts/test-bypass-safety-hooks.sh`:

```bash
#!/bin/bash
# Automated test harness for enforce-bypass-safety.sh
# Pipes mock JSON into the hook and asserts exit codes + stdout content

HOOK=".claude/hooks/enforce-bypass-safety.sh"
PASS=0
FAIL=0

test_hook() {
  local description="$1"
  local mode="$2"
  local tool="$3"
  local command="$4"
  local expect_deny="$5"  # "deny" or "allow"

  INPUT=$(jq -n --arg pm "$mode" --arg tn "$tool" --arg cmd "$command" \
    '{permission_mode: $pm, tool_name: $tn, tool_input: {command: $cmd}}')

  OUTPUT=$(echo "$INPUT" | bash "$HOOK" 2>/dev/null)

  if [ "$expect_deny" = "deny" ]; then
    if echo "$OUTPUT" | grep -q "permissionDecision.*deny"; then
      echo "  PASS: $description"
      ((PASS++))
    else
      echo "  FAIL: $description (expected deny, got allow)"
      ((FAIL++))
    fi
  else
    if [ -z "$OUTPUT" ] || ! echo "$OUTPUT" | grep -q "permissionDecision.*deny"; then
      echo "  PASS: $description"
      ((PASS++))
    else
      echo "  FAIL: $description (expected allow, got deny)"
      ((FAIL++))
    fi
  fi
}

echo "=== Normal mode (should allow everything) ==="
test_hook "force push in normal mode" "default" "Bash" "git push --force origin feat/test" "allow"
test_hook "echo to CLAUDE.md in normal mode" "default" "Bash" "echo x > CLAUDE.md" "allow"
test_hook "rm -rf src in normal mode" "default" "Bash" "rm -rf src" "allow"

echo ""
echo "=== Bypass mode: should DENY ==="
test_hook "force push" "bypassPermissions" "Bash" "git push --force origin feat/test" "deny"
test_hook "force push -f" "bypassPermissions" "Bash" "git push -f origin feat/test" "deny"
test_hook "force-with-lease" "bypassPermissions" "Bash" "git push --force-with-lease origin feat/test" "deny"
test_hook "force push +refspec" "bypassPermissions" "Bash" "git push origin +HEAD:main" "deny"
test_hook "force push +refspec branch" "bypassPermissions" "Bash" "git push origin +main" "deny"
test_hook "echo redirect to CLAUDE.md" "bypassPermissions" "Bash" "echo x > CLAUDE.md" "deny"
test_hook "tee to CLAUDE.md" "bypassPermissions" "Bash" "echo x | tee CLAUDE.md" "deny"
test_hook "sed -i on settings.json" "bypassPermissions" "Bash" "sed -i 's/old/new/' settings.json" "deny"
test_hook "cp to hook" "bypassPermissions" "Bash" "cp /tmp/evil .claude/hooks/enforce-bypass-safety.sh" "deny"
test_hook "rm -rf src" "bypassPermissions" "Bash" "rm -rf src" "deny"
test_hook "git clean -fd" "bypassPermissions" "Bash" "git clean -fd" "deny"
test_hook "git checkout -- ." "bypassPermissions" "Bash" "git checkout -- ." "deny"
test_hook "git branch -D" "bypassPermissions" "Bash" "git branch -D feat/test" "deny"
test_hook "git apply" "bypassPermissions" "Bash" "git apply patch.diff" "deny"
test_hook "git add -A" "bypassPermissions" "Bash" "git add -A" "deny"
test_hook "git commit --amend" "bypassPermissions" "Bash" "git commit --amend -m test" "deny"
test_hook "gh issue exfil" "bypassPermissions" "Bash" 'gh issue create --body "$(cat .env)"' "deny"
test_hook "gh gist create" "bypassPermissions" "Bash" "gh gist create .env.local" "deny"
test_hook "ln -s to CLAUDE.md" "bypassPermissions" "Bash" "ln -s CLAUDE.md /tmp/x" "deny"
test_hook "timeout wrapping docker" "bypassPermissions" "Bash" "timeout 999 docker run alpine" "deny"
test_hook "git clean --force (long form)" "bypassPermissions" "Bash" "git clean --force" "deny"
test_hook "git clean combined flags -xfd" "bypassPermissions" "Bash" "git clean -xfd" "deny"
test_hook "git clean combined flags -dfx" "bypassPermissions" "Bash" "git clean -dfx" "deny"
test_hook "gh issue backtick exfil" "bypassPermissions" "Bash" 'gh issue create --body "`cat .env`"' "deny"
test_hook "gh pr backtick exfil" "bypassPermissions" "Bash" 'gh pr create --body "`cat .env`"' "deny"

echo ""
echo "=== Bypass mode: whitespace evasion (should DENY) ==="
test_hook "force push extra spaces" "bypassPermissions" "Bash" "git  push  --force  origin feat/test" "deny"
test_hook "git clean extra spaces" "bypassPermissions" "Bash" "git  clean  -fd" "deny"

echo ""
echo "=== Bypass mode: multi-command chains (should DENY) ==="
test_hook "chained echo > CLAUDE.md" "bypassPermissions" "Bash" "echo x && echo y > CLAUDE.md" "deny"
test_hook "semicolon echo > CLAUDE.md" "bypassPermissions" "Bash" "ls; echo y > CLAUDE.md" "deny"

echo ""
echo "=== Bypass mode: should ALLOW ==="
test_hook "git push origin HEAD" "bypassPermissions" "Bash" "git push origin HEAD" "allow"
test_hook "npm run build" "bypassPermissions" "Bash" "npm run build" "allow"
test_hook "git commit -m" "bypassPermissions" "Bash" "git commit -m 'test'" "allow"
test_hook "git add specific file" "bypassPermissions" "Bash" "git add src/file.ts" "allow"
test_hook "git stash push" "bypassPermissions" "Bash" "git stash push" "allow"
test_hook "git reset --hard" "bypassPermissions" "Bash" "git reset --hard HEAD" "allow"
test_hook "git add .dotfile (not bulk)" "bypassPermissions" "Bash" "git add .eslintrc.json" "allow"
test_hook "non-Bash tool" "bypassPermissions" "Edit" "" "allow"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
```

Run after any hook modification to catch regressions.

### Phase 6: Tighten Allow List in `settings.json` (root)
**Goal**: Reduce wildcard attack surface for normal (non-sandboxed) mode. Lower priority than phases 1-5 since the hook already catches most abuse in bypass mode.

**Important caveat**: With `autoAllowBashIfSandboxed: true` in the current config, sandboxed Bash commands are auto-approved regardless of the allow list. This means allow-list tightening primarily helps in non-sandboxed scenarios (e.g., commands excluded from sandbox like `git`, `gh`). The primary defenses in bypass mode remain deny rules (Phase 1), hooks (Phase 2), and OS-level protection (Phase 4).

| Current Rule | Action | Replacement |
|-------------|--------|-------------|
| `Bash(sed:*)` | REMOVE | Use Edit tool instead |
| `Bash(tee:*)` | REMOVE | Use Write tool instead |
| `Bash(mv:*)` | REMOVE | Ask per-use |
| `Bash(find:*)` | SCOPE | `Bash(find .:*)` |
| `Bash(git push:*)` | SCOPE | `Bash(git push origin:*)` |
| `Bash(git checkout:*)` | SCOPE | `Bash(git checkout -b:*)`, `Bash(git checkout -t:*)`, `Bash(git checkout -:*)` |
| `Bash(git stash:*)` | SCOPE | `Bash(git stash push:*)`, `Bash(git stash pop:*)`, `Bash(git stash list:*)`, `Bash(git stash show:*)` |
| `Bash(git rebase:*)` | SCOPE | `Bash(git rebase origin/:*)` |
| `Bash(timeout:*)` | SCOPE | `Bash(timeout 60 npx playwright:*)`, `Bash(timeout 300 npm:*)` |
| `Bash(kill:*)` | SCOPE | `Bash(kill %:*)` (job control only) |
| `Bash(pkill:*)` | REMOVE | Ask per-use |
| `Bash(xargs kill:*)` | REMOVE | Ask per-use |
| `Bash(gh issue create:*)` | MOVE | Move to ask rules |

**NOT removing** (addressing review feedback):
- `Bash(cat:*)` — used in CLAUDE.md debugging workflow (`tmux capture-pane ... | cat`) and hook JSON output
- `Bash(echo:*)` — used extensively in existing hooks for JSON output and logging

**Rollback strategy**: Keep a backup copy of the original `settings.json` before changes. Each change tested individually in a dev session. If disruptive, revert that single change immediately. Settings are git-tracked so `git checkout -- settings.json` restores the original.

**Note**: Each change should be tested individually. If a scoped rule proves too restrictive, widen minimally.

### Phase 7: Cleanup and Hardening
**Goal**: Remove remaining vulnerabilities.

1. **Remove `skipDangerousModePermissionPrompt`** from `~/.claude/settings.json`
2. **Remove `CLAUDE_global_backup.md`** from git tracking (contains credentials)
   - Note: `git rm` only removes from HEAD; credentials remain in git history. Full scrub requires `git filter-repo` (optional, separate task)
3. **Consider removing `docker` from sandbox `excludedCommands`**
4. **Scope `npm run:*`** to specific scripts: `npm run lint:*`, `npm run build:*`, `npm run test:*`, `npm run dev:*`
5. **Add secret scanning** to `.githooks/pre-commit`

### Phase 8 (Optional): Create Managed Settings
**Goal**: System-level deny rules that cannot be overridden. Highest precedence in settings hierarchy.

Create `/etc/claude-code/managed-settings.json`:
```json
{
  "permissions": {
    "deny": [
      "Bash(docker run:*)",
      "Bash(docker exec:*)",
      "Bash(chmod:*)",
      "Bash(rm -rf .git:*)"
    ]
  }
}
```

## Testing

### Pre-Execution: Verify permission_mode Field
1. Create temp debug hook, wire it, run in normal mode → verify `permission_mode: "default"`
2. Run in bypass mode → verify `permission_mode: "bypassPermissions"`
3. If field missing → switch to env var detection fallback

### Phase 1 Testing (Always-On Deny Rules)
Verify in both normal and bypass mode:
- `docker run alpine sh` → DENIED in both modes
- `chmod 777 CLAUDE.md` → DENIED in both modes
- `rm -rf .git` → DENIED in both modes
- `Read(.env.local)` → DENIED in both modes
- `Edit(/CLAUDE.md)` → DENIED in both modes
- `Edit(.claude/commands/test.md)` → DENIED in both modes
- `Write(.claude/hooks/test.sh)` → DENIED in both modes
- `Edit(/settings.json)` → DENIED in both modes (root settings.json)
- `Edit(.claude/settings.json)` → still uses ask rule (NOT denied)
- `mcp__filesystem__write_text_file` → DENIED in both modes
- `git push --force origin main` → ALLOWED in normal mode (user prompted)

### Phase 2 Testing (Conditional Hook)
**Run automated test harness first**: `bash scripts/test-bypass-safety-hooks.sh`

Then manual verification:
1. **Normal mode**: `git push --force origin feat/test` → NOT blocked by hook (user prompted as usual)
2. **Normal mode**: `echo "x" > CLAUDE.md` → NOT blocked by hook (user prompted as usual)
3. **Bypass mode**: `git push --force origin feat/test` → BLOCKED by hook
4. **Bypass mode**: `echo "x" > CLAUDE.md` → BLOCKED by hook
5. **Bypass mode**: `git push origin HEAD` → ALLOWED (non-destructive)
6. **Bypass mode**: `npm run build` → ALLOWED (normal dev command)
7. **Bypass mode**: `gh issue create --body "$(cat .env)"` → BLOCKED by hook
8. **Bypass mode**: `rm -rf src/` → BLOCKED by hook

**Adversarial edge cases** (from review feedback):
9. **Bypass mode**: `echo x && echo y > CLAUDE.md` → should be BLOCKED
10. **Bypass mode**: `git  push  --force` (extra spaces) → BLOCKED (whitespace normalized by `tr -s ' '`)
11. **Bypass mode**: `timeout 999 docker run alpine` → should be BLOCKED

### Phase 3 Testing (Backup Hook)
1. **Normal mode**: Start session → verify NO backup tag created, NO push, NO log entries
2. **Bypass mode**: Start session → verify branch pushed and tag created
3. **Bypass mode**: Check `.claude/logs/backup-audit.log` for success message
4. **Bypass mode on main**: Start session → verify NO push (main excluded)
5. **Failure mode**: Disconnect network, start bypass session → verify WARNING in log and stderr
6. **Rapid restart**: Start two bypass sessions quickly → verify second tag has different timestamp (no collision)

### Phase 4 Testing (File Protection)
1. `ls -la CLAUDE.md settings.json .claude/hooks/` → mode 444
2. `lsattr CLAUDE.md settings.json` → immutable flag set
3. In bypass mode: `echo "x" >> CLAUDE.md` → permission denied (OS-level)
4. `scripts/unprotect-files.sh` → files writable
5. `scripts/protect-files.sh` → files read-only again
6. Run protect twice → no errors (idempotent)
7. Verify `scripts/protect-files.sh` itself is protected (chattr +i)

### Phase 5 Testing (Automated Hook Tests)
1. `bash scripts/test-bypass-safety-hooks.sh` → all tests pass
2. Add to CI or pre-commit hook for regression detection

### Phase 6 Testing (Allow List)
1. Back up `settings.json` before changes
2. Remove one rule at a time, run a dev session, note new prompts
3. If too disruptive, `git checkout -- settings.json` to revert
4. Verify Claude still has Read/Edit/Write tools as alternatives
5. Verify `cat` and `echo` still work (NOT removed)

### Manual Verification Checklist
- [ ] Normal interactive mode works with ZERO extra friction
- [ ] Bypass mode blocks all 5 CRITICAL threats
- [ ] Bypass mode blocks all 9 HIGH threats
- [ ] Backup tag + push happens only in bypass mode
- [ ] Backup failure produces visible WARNING
- [ ] Critical files are immutable via chattr
- [ ] Hook is a no-op in normal mode (check with `time` on hook execution)
- [ ] Automated hook tests pass
- [ ] No credentials in git-tracked files
- [ ] Convenience scripts work for protect/unprotect
- [ ] Convenience scripts are themselves protected

## Known Limitations

These vectors cannot be fully mitigated at the hook level:
1. **Variable indirection**: `F="CLAUDE.md"; echo > "$F"` — mitigated by chmod/chattr (Phase 4)
2. **Symlink attacks**: `ln -s CLAUDE.md /tmp/x && echo > /tmp/x` — mitigated by chmod/chattr (Phase 4)
3. **git apply**: Patch content not visible in command string — blocked by hook pattern match on `git apply`
4. **npm script injection**: Child processes of `npm run` can run anything — mitigated by scoping npm allows (Phase 6)
5. **Subshell escapes**: `$(echo "rm -rf src")` — mitigated by chmod/chattr on critical files
6. **Deny rule pattern bugs**: Issues #18200, #11662, #15499 — mitigated by using hooks instead of deny rules for most blocking
7. **Regex limitations**: Multi-line commands, quoted strings, and encoded characters may evade grep patterns — mitigated by chmod/chattr as last resort
8. **chattr requires sudo**: Not applicable in CI environments — chmod 444 is the fallback

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/architecture.md` - Add section on safety hooks and bypass-mode enforcement
- `docs/docs_overall/getting_started.md` - Add safety setup instructions for new developers
